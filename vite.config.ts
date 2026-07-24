// @ts-nocheck
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { buildSummaryPrompt } from './src/prompts/summaryPrompts'
import { buildTaskExtractionPrompt, buildProjectMatchingPrompt, buildSmartTaskExtractionPrompt, buildTaskEdgeGenerationPrompt } from './src/prompts/taskPrompts'
import * as http from 'node:http';
import * as https from 'node:https';

// undici (Node 18 native fetch) のデフォルト5分タイムアウトを回避するための専用カスタムfetch
function customFetch(urlStr, options) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const client = url.protocol === 'https:' ? https : http;
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 0, // Node.js Socketのタイムアウトを完全に無効化
    };

    const req = client.request(url, reqOptions, (res) => {
      const response = {
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        headers: {
          get: (name) => res.headers[name.toLowerCase()] || null,
        },
        body: options.stream ? {
          getReader: () => {
            const queue = [];
            let resolveNext = null;
            let isEnded = false;

            res.on('data', chunk => {
              queue.push(chunk);
              if (resolveNext) {
                resolveNext({ done: false, value: queue.shift() });
                resolveNext = null;
              }
            });

            res.on('end', () => {
              isEnded = true;
              if (resolveNext) {
                resolveNext({ done: true });
                resolveNext = null;
              }
            });

            res.on('error', (err) => {
              if (resolveNext) {
                resolveNext(Promise.reject(err));
                resolveNext = null;
              }
            });

            return {
              read: () => {
                if (queue.length > 0) return Promise.resolve({ done: false, value: queue.shift() });
                if (isEnded) return Promise.resolve({ done: true });
                return new Promise((r) => { resolveNext = r; });
              }
            };
          }
        } : null,
        json: () => new Promise((resJson, rejJson) => {
          let buf = '';
          res.on('data', c => buf += c.toString());
          res.on('end', () => {
            try { resJson(JSON.parse(buf)); } catch(e) { rejJson(e); }
          });
          res.on('error', rejJson);
        })
      };
      resolve(response);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

// ====== バックエンド状態管理 ======
const state = {
  isProcessing: false,
  currentFile: null,
  logs: [],
  createdTasks: [],
  createdMinutes: [],
  sseClients: new Set(),
  processedCount: 0,
  totalCount: 0,
  pendingFileContexts: new Map(), // minuteId -> { file, title, content, llmEndpoint, streamOption }
};

function genId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of state.sseClients) {
    try { c.write(msg); } catch (e) { /* disconnected */ }
  }
}

// ====== Thinking Model パーサー ======
function parseThinking(text) {
  const m = text.match(/<think>([\s\S]*?)<\/think>/);
  if (m) return { thinking: m[1].trim(), output: text.replace(/<think>[\s\S]*?<\/think>/, '').trim() };
  return { thinking: '', output: text };
}

// ====== VTTパーサー ======
function parseVttToPlainText(vttContent) {
  const lines = vttContent.split('\n');
  const entries = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    // タイムスタンプ行を検出 (例: 00:37:58.016 --> 00:37:59.088)
    const timeMatch = line.match(/^(\d{2}:\d{2}:\d{2}\.\d+)\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d+)/);
    if (timeMatch) {
      const startTime = timeMatch[1].substring(0, 8); // HH:MM:SS
      // 次の行がテキスト
      i++;
      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i].trim());
        i++;
      }
      const rawText = textLines.join(' ');
      // <v Name>text</v> 形式のパース
      const speakerMatch = rawText.match(/^<v\s+([^>]+)>(.+)<\/v>$/);
      if (speakerMatch) {
        const speakerFull = speakerMatch[1].trim();
        const text = speakerMatch[2].trim();
        entries.push(`[${startTime}] ${speakerFull}: ${text}`);
      } else {
        // 話者タグなしの場合
        entries.push(`[${startTime}] ${rawText}`);
      }
    }
    i++;
  }
  return entries.join('\n');
}

// ====== 括弧内の名前を抽出 ======
function resolveParenthesizedName(name) {
  const match = name.match(/[(（]([^)）]+)[)）]/);
  if (match) {
    return match[1].trim();
  }
  return name.trim();
}

// ====== VTTからメンバー名を抽出 ======
function extractMembersFromVtt(vttContent) {
  const names = new Set();
  const regex = /<v\s+([^>]+)>/g;
  let match;
  while ((match = regex.exec(vttContent)) !== null) {
    const fullName = match[1].trim();
    if (fullName && fullName.length < 100) {
      const resolvedName = resolveParenthesizedName(fullName);
      if (resolvedName) {
        names.add(resolvedName);
      }
    }
  }
  return names;
}

// デバッグ用ログファイル
const debugLogPath = path.join(process.cwd(), 'debug.log');
function debugLog(msg) {
  fs.appendFileSync(debugLogPath, `[${new Date().toISOString()}] ${msg}\n`);
}

// ====== LLM 呼び出し (ストリーミング + 非ストリーミングフォールバック) ======
async function callLlm(endpoint, messages, label, temp = 0.3, streamOption = true) {
  const logId = genId('log');
  const startTime = Date.now();
  const log = {
    id: logId, timestamp: new Date().toISOString(),
    endpoint: `${endpoint}/chat/completions`,
    prompt: messages.find(m => m.role === 'user')?.content || '',
    responseParams: { messages: messages.map(m => ({ role: m.role, content: m.content.substring(0, 200) + '...' })), temperature: temp },
    thinkingProcess: '', finalOutput: '', latencyMs: 0, status: streamOption ? 'streaming' : 'pending', label,
    statusCode: undefined
  };
  state.logs.push(log);
  broadcast('log_created', log);
  debugLog(`[callLlm] START label=${label} logId=${logId} endpoint=${endpoint} streamOption=${streamOption}`);
  debugLog(`[callLlm] SSE clients count: ${state.sseClients.size}`);

  let thinkingFull = '';
  let outputFull = '';
  let statusCode = undefined;
  try {
    const fetchUrl = `${endpoint}/chat/completions`;
    
    if (streamOption) {
      debugLog(`[callLlm] Fetching: ${fetchUrl} stream=true`);
      const res = await customFetch(fetchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, temperature: temp, stream: true }),
        signal: AbortSignal.timeout(3600000), // 1時間タイムアウト
      });
      statusCode = res.status;
      debugLog(`[callLlm] Response status: ${res.status}`);
      if (!res.ok) throw new Error(`LLM API error: ${res.status}`);

      const contentType = res.headers.get('content-type') || '';
      debugLog(`[callLlm] Content-Type: ${contentType}`);
      debugLog(`[callLlm] res.body exists: ${!!res.body}`);

      if (res.body) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let chunkCount = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            debugLog(`[callLlm] Stream done. Total chunks: ${chunkCount}, thinking: ${thinkingFull.length}chars, output: ${outputFull.length}chars`);
            break;
          }
          const rawChunkText = dec.decode(value, { stream: true });
          chunkCount++;
          buf += rawChunkText;
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const d = line.slice(6).trim();
            if (d === '[DONE]') continue;
            try {
              const parsed = JSON.parse(d);
              const delta = parsed.choices?.[0]?.delta;
              const reasoningChunk = delta?.reasoning_content || '';
              const contentChunk = delta?.content || '';

              if (reasoningChunk) {
                thinkingFull += reasoningChunk;
                broadcast('log_chunk', { id: logId, thinkingProcess: thinkingFull, finalOutput: outputFull, rawChunk: reasoningChunk });
              }
              if (contentChunk) {
                outputFull += contentChunk;
                broadcast('log_chunk', { id: logId, thinkingProcess: thinkingFull, finalOutput: outputFull, rawChunk: contentChunk });
              }
            } catch (e) { }
          }
        }
      } else {
        debugLog('[callLlm] No res.body - cannot stream');
      }
    } else {
      // NON-STREAMING mode
      debugLog(`[callLlm] Fetching: ${fetchUrl} stream=false`);
      const res = await customFetch(fetchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, temperature: temp, stream: false }),
        signal: AbortSignal.timeout(3600000), // 1時間タイムアウト
      });
      statusCode = res.status;
      debugLog(`[callLlm] Response status: ${res.status}`);
      if (!res.ok) throw new Error(`LLM API error: ${res.status}`);

      const data = await res.json();
      const rawContent = data.choices?.[0]?.message?.content || '';
      const { thinking, output } = parseThinking(rawContent);
      thinkingFull = thinking;
      outputFull = output;
      broadcast('log_chunk', { id: logId, thinkingProcess: thinkingFull, finalOutput: outputFull, rawChunk: rawContent });
    }

    // ストリーミングで何も取得できなかった場合は非ストリーミングで再試行 (ストリーミング指定時のみ)
    if (streamOption && !thinkingFull && !outputFull) {
      debugLog('[callLlm] No streaming data - retrying without stream');
      const res2 = await customFetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, temperature: temp }),
        signal: AbortSignal.timeout(3600000), // 1時間タイムアウト
      });
      statusCode = res2.status;
      if (res2.ok) {
        const data = await res2.json();
        const rawContent = data.choices?.[0]?.message?.content || '';
        const { thinking, output } = parseThinking(rawContent);
        thinkingFull = thinking;
        outputFull = output;
        broadcast('log_chunk', { id: logId, thinkingProcess: thinkingFull, finalOutput: outputFull, rawChunk: rawContent });
      }
    }

    const latencyMs = Date.now() - startTime;
    Object.assign(log, { thinkingProcess: thinkingFull, finalOutput: outputFull, latencyMs, status: 'complete', statusCode });
    broadcast('log_complete', { id: logId, thinkingProcess: thinkingFull, finalOutput: outputFull, latencyMs, statusCode });
    debugLog(`[callLlm] COMPLETE thinking=${thinkingFull.length}chars output=${outputFull.length}chars ${latencyMs}ms statusCode=${statusCode}`);
    return { thinking: thinkingFull, output: outputFull, logId };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    Object.assign(log, { error: err.message, latencyMs, status: 'error', statusCode });
    broadcast('log_complete', { id: logId, error: err.message, latencyMs, statusCode });
    throw err;
  }
}

// ====== ファイル名の日時パースヘルパー ======
function getFileDateTime(filename) {
  // 形式: transcript_yyyy_mm-dd_hh.mm.ss.txt/vtt
  // 例: 定例会議 transcript_2026_07-07_13.35.46.txt
  const match = filename.match(/transcript_(\d{4})_(\d{2})-(\d{2})_(\d{2})\.(\d{2})\.(\d{2})/);
  if (match) {
    const [_, y, m, d, hh, mm, ss] = match;
    return new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}`).getTime();
  }
  
  // フォールバック: より一般的な yyyymmdd もしくは yyyy-mm-dd_hh.mm.ss など
  const matchGen = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})(?:\D+(\d{2})\D+(\d{2})\D+(\d{2}))?/);
  if (matchGen) {
    const y = matchGen[1];
    const m = matchGen[2];
    const d = matchGen[3];
    const hh = matchGen[4] || '00';
    const mm = matchGen[5] || '00';
    const ss = matchGen[6] || '00';
    return new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}`).getTime();
  }
  
  return 0;
}

// ====== 未処理アイテムの取得（フォルダおよびフラットファイル両対応） ======
function getUnprocessedItems(dirPath, includeProcessed = false) {
  const items = [];
  if (!fs.existsSync(dirPath)) return items;
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      // 1. フォルダの場合
      if (entry.isDirectory()) {
        if (!includeProcessed && entry.name.includes('_処理済み')) continue;
        
        const subFiles = fs.readdirSync(fullPath);
        // .txt または .vtt ファイルを探す
        const targetFiles = subFiles.filter(sf => sf.endsWith('.txt') || sf.endsWith('.vtt'));
        if (targetFiles.length > 0) {
          targetFiles.sort((a, b) => {
            const timeA = getFileDateTime(a);
            const timeB = getFileDateTime(b);
            if (timeA !== timeB) {
              return timeA - timeB;
            }
            return a.localeCompare(b);
          });
          const targetFile = targetFiles[targetFiles.length - 1];
          const targetFilePath = path.join(fullPath, targetFile);
          const rawContent = fs.readFileSync(targetFilePath, 'utf-8');
          const isVtt = targetFile.endsWith('.vtt');
          const content = isVtt ? parseVttToPlainText(rawContent) : rawContent;
          items.push({
            filename: entry.name,
            fullPath: fullPath,
            content: content,
            rawContent: isVtt ? rawContent : undefined,
            isFolder: true,
            isVtt: isVtt,
            txtFilePath: targetFilePath
          });
        }
      } 
      // 2. フラットファイルの場合（.txt + .vtt 対応）
      else if (entry.isFile()) {
        const isTarget = (entry.name.endsWith('.txt') || entry.name.endsWith('.vtt')) && (includeProcessed || !entry.name.includes('_処理済み'));
        if (isTarget) {
          const rawContent = fs.readFileSync(fullPath, 'utf-8');
          const isVtt = entry.name.endsWith('.vtt');
          const content = isVtt ? parseVttToPlainText(rawContent) : rawContent;
          items.push({
            filename: entry.name,
            fullPath: fullPath,
            content: content,
            rawContent: isVtt ? rawContent : undefined,
            isFolder: false,
            isVtt: isVtt
          });
        }
      }
    }
  } catch (e) {
    console.error('Failed to read directory entries', e);
  }
  return items;
}

// ====== 会議日時パーサー ======
function parseFilenameDateTime(filename) {
  const match = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})(?:\s+(\d{2})[.:](\d{2})[.:](\d{2}))?/);
  if (!match) return { meetingDate: null, startSeconds: null };

  const meetingDate = `${match[1]}-${match[2]}-${match[3]}`;
  const startSeconds = match[4]
    ? parseInt(match[4]) * 3600 + parseInt(match[5]) * 60 + parseInt(match[6])
    : null;
  return { meetingDate, startSeconds };
}

function formatSecondsAsTime(totalSeconds) {
  const secondsInDay = 24 * 60 * 60;
  const normalized = ((totalSeconds % secondsInDay) + secondsInDay) % secondsInDay;
  const h = Math.floor(normalized / 3600);
  const m = Math.floor((normalized % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseTimestampToSeconds(h, m, s) {
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s);
}

function parseMeetingDatetime(content, filename, isVtt = false) {
  let startTime = null;
  let endTime = null;
  const { meetingDate, startSeconds: filenameStartSeconds } = parseFilenameDateTime(filename);

  // 文字起こしヘッダは実データに存在しないため参照しない。
  if (meetingDate) {
    debugLog(`[parseMeetingDatetime] Filename date parsed: date=${meetingDate}`);
  }

  if (isVtt) {
    const cueRegex = /(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*-->\s*(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?/g;
    let firstCueStart = null;
    let lastCueEnd = null;
    let match;
    while ((match = cueRegex.exec(content)) !== null) {
      const cueStart = parseTimestampToSeconds(match[1], match[2], match[3]);
      const cueEnd = parseTimestampToSeconds(match[4], match[5], match[6]);
      if (firstCueStart === null) firstCueStart = cueStart;
      lastCueEnd = cueEnd;
    }

    if (filenameStartSeconds !== null && firstCueStart !== null && lastCueEnd !== null) {
      startTime = formatSecondsAsTime(filenameStartSeconds + firstCueStart);
      endTime = formatSecondsAsTime(filenameStartSeconds + lastCueEnd);
      debugLog(`[parseMeetingDatetime] VTT relative timestamps parsed: start=${startTime} end=${endTime}`);
    }

    return { meetingDate, startTime, endTime };
  }

  // TXT の会話タイムスタンプは絶対時刻として扱う。
  const timestampRegex = /\[[^\]\n]+\]\s*(\d{2}):(\d{2}):(\d{2})/g;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let match;
  while ((match = timestampRegex.exec(content)) !== null) {
    const ts = parseTimestampToSeconds(match[1], match[2], match[3]);
    if (firstTimestamp === null) firstTimestamp = ts;
    lastTimestamp = ts;
  }

  if (firstTimestamp !== null && lastTimestamp !== null) {
    startTime = formatSecondsAsTime(firstTimestamp);
    endTime = formatSecondsAsTime(lastTimestamp);
    debugLog(`[parseMeetingDatetime] TXT absolute timestamps parsed: start=${startTime} end=${endTime}`);
  }

  return { meetingDate, startTime, endTime };
}

// ====== スクリーンショットスキャナー ======
function scanScreenshots(imageDir, meetingDate, startTimeStr, endTimeStr) {
  const matched = [];
  if (!imageDir || !fs.existsSync(imageDir)) {
    debugLog(`[scanScreenshots] imageDir not found: ${imageDir}`);
    return matched;
  }
  if (!meetingDate || !startTimeStr) {
    debugLog(`[scanScreenshots] Missing date/time info`);
    return matched;
  }

  // startTime/endTime を分単位の数値に変換
  const parseTimeToMinutes = (timeStr) => {
    const parts = timeStr.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  };
  const startMinutes = parseTimeToMinutes(startTimeStr);
  const endMinutes = endTimeStr ? parseTimeToMinutes(endTimeStr) : startMinutes + 120; // 終了不明時はデフォルト2時間

  try {
    const files = fs.readdirSync(imageDir);
    debugLog(`[scanScreenshots] Scanning ${files.length} files in ${imageDir}`);

    for (const file of files) {
      // パターン1: スクリーンショット 2026-05-21 14.01.30.png (ドット区切り)
      // パターン2: スクリーンショット 2026-05-21 140130.png (区切りなし)
      const ssMatch = file.match(/^スクリーンショット\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{2})\.?(\d{2})\.?(\d{2})\.png$/i);
      if (!ssMatch) continue;

      const ssDate = `${ssMatch[1]}-${ssMatch[2]}-${ssMatch[3]}`;
      const ssHour = parseInt(ssMatch[4]);
      const ssMin = parseInt(ssMatch[5]);
      const ssMinutes = ssHour * 60 + ssMin;

      // 同日かつ会議時間枠内かチェック
      if (ssDate === meetingDate && ssMinutes >= startMinutes && ssMinutes <= endMinutes) {
        const fullPath = path.join(imageDir, file);
        matched.push({ filename: file, path: fullPath, time: `${ssMatch[4]}:${ssMatch[5]}:${ssMatch[6]}` });
        debugLog(`[scanScreenshots] MATCHED: ${file} (${ssMatch[4]}:${ssMatch[5]}:${ssMatch[6]})`);
      }
    }
  } catch (e) {
    debugLog(`[scanScreenshots] Error: ${e.message}`);
  }

  // 時系列順にソート
  matched.sort((a, b) => a.time.localeCompare(b.time));
  return matched;
}

// ====== データファイル読み込みヘルパー ======
function loadDataFile(filename) {
  const filePath = path.join(process.cwd(), 'data', filename);
  if (fs.existsSync(filePath)) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch (e) { return []; }
  }
  return [];
}

// ====== スマートタスク結果のマージ処理 ======
function processSmartTaskResults(parsed, projectId, minute) {
  const newTasks = [];
  const updatedTasks = [];

  for (const item of parsed) {
    if (item.type === 'update' && item.id) {
      // 既存タスクの更新提案 → pendingUpdates として SSE 通知
      const pendingUpdates = {};
      if (item.details) pendingUpdates.details = item.details;
      if (item.actionResult) pendingUpdates.actionResult = item.actionResult;
      if (item.status) pendingUpdates.status = item.status;
      if (item.progress !== undefined) pendingUpdates.progress = item.progress;

      broadcast('task_updated', { id: item.id, pendingUpdates });
      updatedTasks.push({ id: item.id, pendingUpdates });
    } else if (item.type === 'new') {
      const task = {
        id: genId('task'),
        title: item.title,
        details: item.details || '',
        assignee: item.assignee || '',
        status: item.status || 'todo',
        progress: item.progress || 0,
        projectId: projectId || undefined,
        parentId: item.parentId || undefined,
        dependencies: Array.isArray(item.dependencies) ? item.dependencies : [],
        isNew: true,
      };
      newTasks.push(task);
      state.createdTasks.push(task);
      broadcast('task_created', task);
    }
  }

  // 議事録の extractedTasks を新規タスクのみで更新
  if (minute) {
    minute.extractedTasks = newTasks;
  }

  return { newTasks, updatedTasks };
}

// ====== ファイル処理 ======
async function processFile(file, llmEndpoint, streamOption = true) {
  state.currentFile = file.filename;
  broadcast('batch_status', { status: 'processing', currentFile: file.filename, processedCount: state.processedCount, totalCount: state.totalCount });

  // ====== Step 1: 要約生成 ======
  const sumResult = await callLlm(llmEndpoint, [{ role: 'user', content: buildSummaryPrompt(file.content) }], `要約: ${file.filename}`, 0.6, streamOption);

  let extractedDate = new Date().toISOString().split('T')[0];
  let title = file.filename.replace('.txt', '').replace('.vtt', '');
  
  if (file.isFolder) {
    const match = file.filename.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2})\.(\d{2})\.(\d{2})\s+(.+)$/);
    if (match) {
      extractedDate = match[1];
      title = match[5];
    } else {
      title = file.filename;
    }
  } else {
    // "会議名 2026-07-22.txt" などの形式に対応
    const namedMatch = file.filename.match(/^(.+?)\s+(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
    if (namedMatch) {
      title = namedMatch[1].trim();
      extractedDate = `${namedMatch[2]}-${namedMatch[3]}-${namedMatch[4]}`;
    } else {
      const dateMatch = file.filename.match(/^(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
      if (dateMatch) {
        extractedDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
      }
    }
  }

  // ====== 会議時刻の検出 ======
  const { meetingDate, startTime: meetingStartTime, endTime: meetingEndTime } = parseMeetingDatetime(file.rawContent || file.content, file.filename, file.isVtt);
  if (meetingDate) extractedDate = meetingDate;

  // ====== スクリーンショット自動連携 ======
  let screenshotImages = [];
  try {
    const settingsPath = path.join(process.cwd(), 'data', 'settings.json');
    let imageDir = '';
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      imageDir = settings.imageDir || '';
    }
    if (imageDir && meetingStartTime) {
      const matchedScreenshots = scanScreenshots(imageDir, extractedDate, meetingStartTime, meetingEndTime);
      if (matchedScreenshots.length > 0) {
        screenshotImages = matchedScreenshots.map(ss => `/api/image/view?path=${encodeURIComponent(ss.path)}`);
        debugLog(`[processFile] ${matchedScreenshots.length} screenshots attached to minute`);
      }
    }
  } catch (e) {
    debugLog(`[processFile] Screenshot scan error: ${e.message}`);
  }

  // ====== Step 2: プロジェクト自動判定 ======
  const dbProjects = loadDataFile('projects.json');
  const dbMembers = loadDataFile('members.json');
  const dbTasks = loadDataFile('tasks.json');
  const activeProjects = dbProjects.filter(p => !p.isClosed);

  let matchedProjectId = null;

  if (activeProjects.length > 0) {
    try {
      const matchPrompt = buildProjectMatchingPrompt(title, file.content, activeProjects, dbMembers);
      const matchResult = await callLlm(llmEndpoint, [
        { role: 'system', content: 'You are a helpful assistant that strictly outputs valid JSON.' },
        { role: 'user', content: matchPrompt }
      ], `プロジェクト判定: ${file.filename}`, 0.3, streamOption);

      try {
        const matchParsed = JSON.parse(matchResult.output.replace(/```json\n?|```/g, '').trim());
        if (matchParsed.projectId && matchParsed.projectId !== 'unknown') {
          matchedProjectId = matchParsed.projectId;
          debugLog(`[processFile] Project matched: ${matchedProjectId}`);
        }
      } catch (e) {
        debugLog(`[processFile] Failed to parse project match result: ${e.message}`);
      }
    } catch (e) {
      debugLog(`[processFile] Project matching LLM call failed: ${e.message}`);
    }
  }

  // ====== 議事録オブジェクト生成（タスクは後で追加） ======
  const minuteId = genId('min');
  const minute = {
    id: minuteId,
    date: extractedDate,
    title: title,
    summary: sumResult.output,
    content: file.content,
    extractedTasks: [],
    projectId: matchedProjectId || undefined,
    startTime: meetingStartTime || undefined,
    endTime: meetingEndTime || undefined,
    images: screenshotImages.length > 0 ? screenshotImages : undefined,
  };
  state.createdMinutes.push(minute);
  broadcast('minute_created', minute);

  // ====== Step 3: スマートタスク抽出 or フォールバック ======
  if (matchedProjectId) {
    // プロジェクト特定済み → スマートタスク抽出
    const activeTasks = dbTasks.filter(t =>
      t.projectId === matchedProjectId &&
      !t.isNew &&
      (t.status === 'todo' || t.status === 'in-progress')
    );
    const groupTasks = dbTasks.filter(t =>
      t.projectId === matchedProjectId &&
      !t.isNew &&
      ((t.title && t.title.startsWith('【') && t.title.endsWith('】')) || t.isGroup || dbTasks.some(c => c.parentId === t.id))
    );
    const projectMembers = dbMembers;

    try {
      const smartPrompt = buildSmartTaskExtractionPrompt(file.content, activeTasks, groupTasks, projectMembers);
      const smartResult = await callLlm(llmEndpoint, [
        { role: 'system', content: 'You are a helpful assistant that strictly outputs valid JSON.' },
        { role: 'user', content: smartPrompt }
      ], `スマートタスク抽出: ${file.filename}`, 0.6, streamOption);

      let parsed = [];
      try { parsed = JSON.parse(smartResult.output.replace(/```json\n?|```/g, '').trim()); } catch (e) { }

      processSmartTaskResults(parsed, matchedProjectId, minute);
    } catch (e) {
      debugLog(`[processFile] Smart task extraction failed, falling back to basic: ${e.message}`);
      // フォールバック: 従来のタスク抽出
      await fallbackBasicTaskExtraction(file, llmEndpoint, streamOption, matchedProjectId, minute);
    }
  } else if (activeProjects.length > 0) {
    // プロジェクト判定不可 → 一時保留してフロントエンドに通知
    state.pendingFileContexts.set(minuteId, {
      file, title, content: file.content, llmEndpoint, streamOption, minuteId
    });
    broadcast('project_association_needed', {
      minuteId: minuteId,
      title: title,
      filename: file.filename,
      content: file.content.slice(0, 2000),
    });
    debugLog(`[processFile] Project unknown → sent project_association_needed for ${minuteId}`);

    // 従来のタスク抽出も並行実施（プロジェクト未紐付けの状態で）
    await fallbackBasicTaskExtraction(file, llmEndpoint, streamOption, null, minute);
  } else {
    // プロジェクトが1つもない → 従来のタスク抽出
    await fallbackBasicTaskExtraction(file, llmEndpoint, streamOption, null, minute);
  }

  // ====== メンバ自動抽出 ======
  const extractedNames = new Set();
  if (file.isVtt && file.rawContent) {
    const vttNames = extractMembersFromVtt(file.rawContent);
    for (const name of vttNames) extractedNames.add(name);
  }
  const regex1 = /\[([^\]\n]{1,50})\]\s*\d{2}:\d{2}/g;
  const regex2 = /(?:^|\n)(?:\[?\d{2}:\d{2}(?::\d{2})?\]?\s*)?([^\[\]:：\n]{1,50})[=:：]/g;
  [regex1, regex2].forEach(regex => {
    let match;
    while ((match = regex.exec(file.content)) !== null) {
      const name = match[1].trim();
      const resolvedName = resolveParenthesizedName(name);
      if (resolvedName && resolvedName.length < 15 && !resolvedName.includes('http') && !['ID', 'URL', 'Time'].includes(resolvedName) && !resolvedName.startsWith('**')) {
        extractedNames.add(resolvedName);
      }
    }
  });

  if (extractedNames.size > 0) {
    const membersOnDisk = loadDataFile('members.json');
    const newMembers = [];
    for (const name of extractedNames) {
      if (!membersOnDisk.find(m => m.name === name)) newMembers.push(name);
    }
    if (newMembers.length > 0) {
      broadcast('new_members_extracted', { names: newMembers, minuteTitle: title });
    }
  }

  // ====== ファイルリネーム（処理済み） ======
  try {
    if (file.isFolder) {
      fs.renameSync(file.fullPath, file.fullPath + '_処理済み');
    } else {
      const ext = path.extname(file.fullPath);
      const base = path.basename(file.fullPath, ext);
      const dir = path.dirname(file.fullPath);
      fs.renameSync(file.fullPath, path.join(dir, `${base}_処理済み${ext}`));
    }
  } catch (e) { }

  state.processedCount++;
}

// ====== 従来型タスク抽出（フォールバック） ======
async function fallbackBasicTaskExtraction(file, llmEndpoint, streamOption, projectId, minute) {
  const taskResult = await callLlm(llmEndpoint, [
    { role: 'system', content: 'You are a helpful assistant that strictly outputs valid JSON.' },
    { role: 'user', content: buildTaskExtractionPrompt(file.content) }
  ], `タスク抽出: ${file.filename}`, 0.6, streamOption);

  let parsed = [];
  try { parsed = JSON.parse(taskResult.output.replace(/```json\n?|```/g, '').trim()); } catch (e) { }

  const tasks = parsed.map(t => ({
    ...t,
    id: genId('task'),
    status: 'todo',
    isNew: true,
    projectId: projectId || undefined,
  }));

  minute.extractedTasks = tasks;
  state.createdTasks.push(...tasks);
  for (const t of tasks) broadcast('task_created', t);
}

async function processBatch(dir, llmEndpoint, streamOption = true) {
  if (state.isProcessing) return;
  state.isProcessing = true;
  state.processedCount = 0;
  try {
    const files = getUnprocessedItems(dir);
    state.totalCount = files.length;
    if (!files.length) { broadcast('batch_status', { status: 'no_files' }); return; }
    broadcast('batch_status', { status: 'started', totalCount: files.length });
    for (const f of files) {
      try { await processFile(f, llmEndpoint, streamOption); } catch (e) { broadcast('batch_status', { status: 'file_error', filename: f.filename, error: e.message }); }
    }
    broadcast('batch_status', { status: 'complete', processedCount: state.processedCount, totalCount: state.totalCount });
  } catch (e) { broadcast('batch_status', { status: 'error', error: e.message }); }
  finally { state.isProcessing = false; state.currentFile = null; }
}

// ====== JSON body parser helper ======
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
  });
}

// ====== WBS Excel Export (.xlsx / OOXML) ======
function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index) {
  let name = '';
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function parseDateParts(dateStr) {
  const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return { y, m, d, date };
}

function excelDateSerial(dateStr) {
  const parts = parseDateParts(dateStr);
  if (!parts) return null;
  const epoch = Date.UTC(1899, 11, 30);
  return Math.round((parts.date.getTime() - epoch) / 86400000);
}

function addDaysToDateString(dateStr, days) {
  const parts = parseDateParts(dateStr);
  if (!parts) return '';
  const date = new Date(parts.date.getTime());
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isWeekend(dateStr) {
  const parts = parseDateParts(dateStr);
  if (!parts) return false;
  const day = parts.date.getUTCDay();
  return day === 0 || day === 6;
}

function buildDateRange(startDate, endDate) {
  const days = [];
  let current = startDate;
  let guard = 0;
  while (current && current <= endDate && guard < 2000) {
    days.push(current);
    current = addDaysToDateString(current, 1);
    guard++;
  }
  return days;
}

function compareWbsTasks(a, b) {
  const aOrder = a.wbsOrder !== undefined ? a.wbsOrder : 999999;
  const bOrder = b.wbsOrder !== undefined ? b.wbsOrder : 999999;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

function collectDateBounds(project, projectTasks) {
  const dateValues = [];
  if (project?.startDate && parseDateParts(project.startDate)) dateValues.push(project.startDate);
  if (project?.endDate && parseDateParts(project.endDate)) dateValues.push(project.endDate);
  projectTasks.forEach(task => {
    if (task.startDate && parseDateParts(task.startDate)) dateValues.push(task.startDate);
    if (task.dueDate && parseDateParts(task.dueDate)) dateValues.push(task.dueDate);
  });

  if (dateValues.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    return { startDate: today, endDate: addDaysToDateString(today, 30) };
  }

  dateValues.sort();
  const startDate = dateValues[0];
  const endDate = dateValues[dateValues.length - 1];
  return startDate <= endDate ? { startDate, endDate } : { startDate: endDate, endDate: startDate };
}

function buildWbsExportRows(projectTasks, members) {
  const memberMap = new Map((members || []).map(m => [m.id, m.name]));
  const taskMap = new Map();
  const roots = [];

  projectTasks.forEach(task => {
    taskMap.set(task.id, { task, children: [] });
  });

  projectTasks.forEach(task => {
    const node = taskMap.get(task.id);
    if (task.parentId && taskMap.has(task.parentId)) {
      taskMap.get(task.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortNodes = nodes => {
    nodes.sort((a, b) => compareWbsTasks(a.task, b.task));
    nodes.forEach(node => sortNodes(node.children));
  };
  sortNodes(roots);

  const rows = [];
  const assigneeFor = task => task.assignee || memberMap.get(task.memberId) || '';
  const normalizeStatus = status => ['todo', 'in-progress', 'done'].includes(status) ? status : 'todo';
  const childTitle = (title, depth) => {
    const prefix = depth > 0 ? `${'　'.repeat(Math.max(0, depth - 1))}└ ` : '';
    return `${prefix}${title || ''}`;
  };

  const pushNode = (node, parentTitle, depth, isGroupRoot = false) => {
    rows.push({
      parentTitle,
      taskTitle: isGroupRoot ? '' : childTitle(node.task.title, depth),
      assignee: assigneeFor(node.task),
      startDate: node.task.startDate || '',
      dueDate: node.task.dueDate || '',
      status: normalizeStatus(node.task.status),
      isGroupRoot,
    });
    node.children.forEach(child => pushNode(child, parentTitle, depth + 1, false));
  };

  roots.forEach(root => {
    if (root.children.length > 0) {
      pushNode(root, root.task.title || '', 0, true);
    } else {
      pushNode(root, 'その他タスク（グループ未分類）', 0, false);
    }
  });

  if (rows.length === 0) {
    rows.push({
      parentTitle: '（タスクなし）',
      taskTitle: '',
      assignee: '',
      startDate: '',
      dueDate: '',
      status: 'todo',
      isGroupRoot: false,
    });
  }

  return rows;
}

function buildProjectMembers(project, projectTasks, members) {
  const memberById = new Map((members || []).map(member => [member.id, member]));
  const result = [];
  const seenNames = new Set();

  const addMember = member => {
    const name = String(member?.name || '').trim();
    if (!name || seenNames.has(name)) return;
    seenNames.add(name);
    result.push({
      id: member?.id || '',
      name,
      group: member?.group || '',
    });
  };

  if (project?.stakeholders?.length) {
    project.stakeholders.forEach(memberId => addMember(memberById.get(memberId)));
  } else {
    (members || []).forEach(addMember);
  }

  projectTasks.forEach(task => {
    if (task.memberId && memberById.has(task.memberId)) {
      addMember(memberById.get(task.memberId));
    } else if (task.assignee) {
      addMember({ id: '', name: task.assignee, group: 'タスク担当者' });
    }
  });

  return result.length > 0 ? result : [{ id: '', name: '', group: '' }];
}

function textCell(ref, value, style = 0) {
  if (value === undefined || value === null || value === '') return `<c r="${ref}" s="${style}"/>`;
  const text = String(value);
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t${preserve}>${escapeXml(text)}</t></is></c>`;
}

function numberCell(ref, value, style = 0) {
  if (value === undefined || value === null || value === '') return `<c r="${ref}" s="${style}"/>`;
  return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
}

function dateCell(ref, dateStr, style = 6) {
  const serial = excelDateSerial(dateStr);
  return serial === null ? `<c r="${ref}" s="${style}"/>` : numberCell(ref, serial, style);
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>
    <numFmt numFmtId="165" formatCode="m/d"/>
  </numFmts>
  <fonts count="4">
    <font><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>
    <font><sz val="9"/><color rgb="FF4B5563"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="9">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF93C5FD"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFCD34D"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF86EFAC"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD9E2EC"/></left>
      <right style="thin"><color rgb="FFD9E2EC"/></right>
      <top style="thin"><color rgb="FFD9E2EC"/></top>
      <bottom style="thin"><color rgb="FFD9E2EC"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FFE5E7EB"/></left>
      <right style="thin"><color rgb="FFE5E7EB"/></right>
      <top style="thin"><color rgb="FFF3F4F6"/></top>
      <bottom style="thin"><color rgb="FFF3F4F6"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="15">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="165" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="165" fontId="2" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="2" xfId="0" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="6" borderId="2" xfId="0" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="7" borderId="2" xfId="0" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="8" borderId="2" xfId="0" applyFill="1" applyBorder="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="1">
    <dxf><border><left style="medium"><color rgb="FFEF4444"/></left><right style="medium"><color rgb="FFEF4444"/></right></border></dxf>
  </dxfs>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
}

function buildWorksheetXml(projectName, rows, days) {
  const timelineStartCol = 6;
  const statusColIndex = timelineStartCol + days.length;
  const lastTimelineCol = statusColIndex - 1;
  const lastTimelineColName = columnName(lastTimelineCol);
  const statusColName = columnName(statusColIndex);
  const lastDataRow = rows.length + 3;
  const dimension = `A1:${statusColName}${lastDataRow}`;
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

  const monthGroups = [];
  days.forEach((day, index) => {
    const key = day.slice(0, 7);
    const existing = monthGroups[monthGroups.length - 1];
    if (!existing || existing.key !== key) {
      monthGroups.push({ key, startIndex: index, endIndex: index });
    } else {
      existing.endIndex = index;
    }
  });

  const xmlRows = [];
  const row1Cells = [
    textCell('A1', `プロジェクト: ${projectName}`, 1),
    textCell('B1', '', 1),
    textCell('C1', '', 1),
    textCell('D1', '', 1),
    textCell('E1', '', 1),
  ];
  days.forEach((day, index) => {
    const col = columnName(timelineStartCol + index);
    const isMonthStart = monthGroups.some(group => group.startIndex === index);
    const label = isMonthStart ? `${Number(day.slice(0, 4))}年${Number(day.slice(5, 7))}月` : '';
    row1Cells.push(textCell(`${col}1`, label, 2));
  });
  row1Cells.push(textCell(`${statusColName}1`, 'status', 2));
  xmlRows.push(`<row r="1" ht="26" customHeight="1">${row1Cells.join('')}</row>`);

  const row2Cells = [
    textCell('A2', '親グループ', 2),
    textCell('B2', '配下タスク', 2),
    textCell('C2', '担当者', 2),
    textCell('D2', '開始日', 2),
    textCell('E2', '終了日', 2),
  ];
  days.forEach((day, index) => {
    const col = columnName(timelineStartCol + index);
    row2Cells.push(dateCell(`${col}2`, day, isWeekend(day) ? 4 : 3));
  });
  row2Cells.push(textCell(`${statusColName}2`, 'status', 2));
  xmlRows.push(`<row r="2" ht="24" customHeight="1">${row2Cells.join('')}</row>`);

  const row3Cells = [
    textCell('A3', '', 2),
    textCell('B3', '', 2),
    textCell('C3', '', 2),
    textCell('D3', '', 2),
    textCell('E3', '', 2),
  ];
  days.forEach((day, index) => {
    const col = columnName(timelineStartCol + index);
    const parts = parseDateParts(day);
    const weekday = parts ? weekdays[parts.date.getUTCDay()] : '';
    row3Cells.push(textCell(`${col}3`, weekday, isWeekend(day) ? 11 : 10));
  });
  row3Cells.push(textCell(`${statusColName}3`, 'status', 2));
  xmlRows.push(`<row r="3" ht="18" customHeight="1">${row3Cells.join('')}</row>`);

  rows.forEach((item, index) => {
    const rowNumber = index + 4;
    const rowStyle = item.isGroupRoot ? 7 : 5;
    const barStyle = item.status === 'done' ? 14 : item.status === 'in-progress' ? 13 : 12;
    const hasValidRange = !!(parseDateParts(item.startDate) && parseDateParts(item.dueDate) && item.startDate <= item.dueDate);
    const cells = [
      textCell(`A${rowNumber}`, item.parentTitle, rowStyle),
      textCell(`B${rowNumber}`, item.taskTitle, rowStyle),
      textCell(`C${rowNumber}`, item.assignee, 5),
      dateCell(`D${rowNumber}`, item.startDate, 6),
      dateCell(`E${rowNumber}`, item.dueDate, 6),
    ];
    days.forEach((day, dayIndex) => {
      const col = columnName(timelineStartCol + dayIndex);
      const isScheduledDay = hasValidRange && day >= item.startDate && day <= item.dueDate;
      cells.push(textCell(`${col}${rowNumber}`, '', isScheduledDay ? barStyle : isWeekend(day) ? 9 : 8));
    });
    cells.push(textCell(`${statusColName}${rowNumber}`, item.status, 5));
    xmlRows.push(`<row r="${rowNumber}" ht="22" customHeight="1">${cells.join('')}</row>`);
  });

  const merges = ['A1:E1'];
  monthGroups.forEach(group => {
    const startCol = columnName(timelineStartCol + group.startIndex);
    const endCol = columnName(timelineStartCol + group.endIndex);
    if (startCol !== endCol) merges.push(`${startCol}1:${endCol}1`);
  });

  const timelineRange = `${columnName(timelineStartCol)}4:${lastTimelineColName}${lastDataRow}`;
  const cfRules = [
    { dxfId: 0, formula: `${columnName(timelineStartCol)}$2=TODAY()` },
  ];

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="${dimension}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane xSplit="5" ySplit="3" topLeftCell="F4" activePane="bottomRight" state="frozen"/>
      <selection pane="topRight" activeCell="F2" sqref="F2"/>
      <selection pane="bottomLeft" activeCell="A4" sqref="A4"/>
      <selection pane="bottomRight" activeCell="F4" sqref="F4"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="1" width="28" customWidth="1"/>
    <col min="2" max="2" width="44" customWidth="1"/>
    <col min="3" max="3" width="18" customWidth="1"/>
    <col min="4" max="5" width="18" customWidth="1"/>
    <col min="6" max="${lastTimelineCol}" width="7" customWidth="1"/>
    <col min="${statusColIndex}" max="${statusColIndex}" width="12" hidden="1" customWidth="1"/>
  </cols>
  <sheetData>${xmlRows.join('')}</sheetData>
  <autoFilter ref="A2:E${lastDataRow}"/>
  <mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>
  <conditionalFormatting sqref="${timelineRange}">
    ${cfRules.map((rule, index) => `<cfRule type="expression" dxfId="${rule.dxfId}" priority="${index + 1}"><formula>${escapeXml(rule.formula)}</formula></cfRule>`).join('')}
  </conditionalFormatting>
  <dataValidations count="2">
    <dataValidation type="list" allowBlank="1" showErrorMessage="1" showInputMessage="1" errorTitle="担当者選択エラー" error="プロジェクトメンバーシートの一覧から担当者を選択してください。" promptTitle="担当者" prompt="プロジェクトメンバーシートの一覧から選択できます。" sqref="C4:C${lastDataRow}">
      <formula1>ProjectMembers</formula1>
    </dataValidation>
    <dataValidation type="list" allowBlank="1" showErrorMessage="1" showInputMessage="1" errorTitle="日付選択エラー" error="線表ヘッダーの日付一覧から選択してください。" promptTitle="日付" prompt="日付候補のドロップダウンから選択できます。" sqref="D4:E${lastDataRow}">
      <formula1>ProjectDates</formula1>
    </dataValidation>
  </dataValidations>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

function buildMembersWorksheetXml(projectMembers) {
  const lastRow = Math.max(2, projectMembers.length + 1);
  const rows = [
    `<row r="1" ht="22" customHeight="1">${[
      textCell('A1', '担当者', 2),
      textCell('B1', 'グループ', 2),
      textCell('C1', 'ID', 2),
    ].join('')}</row>`,
  ];

  projectMembers.forEach((member, index) => {
    const rowNumber = index + 2;
    rows.push(`<row r="${rowNumber}" ht="20" customHeight="1">${[
      textCell(`A${rowNumber}`, member.name, 5),
      textCell(`B${rowNumber}`, member.group, 5),
      textCell(`C${rowNumber}`, member.id, 5),
    ].join('')}</row>`);
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:C${lastRow}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="1" width="24" customWidth="1"/>
    <col min="2" max="2" width="22" customWidth="1"/>
    <col min="3" max="3" width="30" customWidth="1"/>
  </cols>
  <sheetData>${rows.join('')}</sheetData>
  <autoFilter ref="A1:C${lastRow}"/>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

function buildWorkbookXml(days, projectMembers) {
  const timelineStartCol = 6;
  const lastTimelineColName = columnName(timelineStartCol + days.length - 1);
  const memberLastRow = Math.max(2, projectMembers.length + 1);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="18000" windowHeight="12000"/></bookViews>
  <sheets>
    <sheet name="WBS" sheetId="1" r:id="rId1"/>
    <sheet name="プロジェクトメンバー" sheetId="2" r:id="rId2"/>
  </sheets>
  <definedNames>
    <definedName name="ProjectMembers">'プロジェクトメンバー'!$A$2:$A$${memberLastRow}</definedName>
    <definedName name="ProjectDates">'WBS'!$F$2:$${lastTimelineColName}$2</definedName>
  </definedNames>
  <calcPr calcId="171027" fullCalcOnLoad="1" forceFullCalc="1"/>
</workbook>`;
}

function buildWorkbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function buildContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function buildCorePropsXml(projectName) {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(projectName)} WBS</dc:title>
  <dc:creator>05_pj_dashboard</dc:creator>
  <cp:lastModifiedBy>05_pj_dashboard</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function buildAppPropsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>05_pj_dashboard</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>
      <vt:variant><vt:i4>2</vt:i4></vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="2" baseType="lpstr">
      <vt:lpstr>WBS</vt:lpstr>
      <vt:lpstr>プロジェクトメンバー</vt:lpstr>
    </vt:vector>
  </TitlesOfParts>
  <Company></Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0300</AppVersion>
</Properties>`;
}

function crc32(buffer) {
  if (!crc32.table) {
    crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crc32.table[i] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) {
    crc = crc32.table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();

  entries.forEach(entry => {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const crc = crc32(dataBuffer);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, dataBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function sanitizeFileName(value) {
  return String(value || 'WBS')
    .split('')
    .map(ch => {
      const code = ch.charCodeAt(0);
      return code < 32 || '<>:"/\\|?*'.includes(ch) ? '_' : ch;
    })
    .join('')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'WBS';
}

function buildWbsWorkbookBuffer({ projectId, tasks = [], projects = [], members = [] }) {
  const normalizedProjectId = projectId === 'unassigned' ? null : projectId;
  const project = normalizedProjectId ? projects.find(p => p.id === normalizedProjectId) : null;
  if (normalizedProjectId && !project) {
    throw new Error('指定されたプロジェクトが見つかりません。');
  }

  const projectName = project?.name || '未分類';
  const projectTasks = tasks
    .filter(task => !task.isNew)
    .filter(task => normalizedProjectId ? task.projectId === normalizedProjectId : !task.projectId);
  const projectMembers = buildProjectMembers(project, projectTasks, members);
  const rows = buildWbsExportRows(projectTasks, members);
  const { startDate, endDate } = collectDateBounds(project, projectTasks);
  const days = buildDateRange(startDate, endDate);
  const worksheetXml = buildWorksheetXml(projectName, rows, days);
  const membersWorksheetXml = buildMembersWorksheetXml(projectMembers);

  return createZip([
    { name: '[Content_Types].xml', data: buildContentTypesXml() },
    { name: '_rels/.rels', data: buildRootRelsXml() },
    { name: 'docProps/core.xml', data: buildCorePropsXml(projectName) },
    { name: 'docProps/app.xml', data: buildAppPropsXml() },
    { name: 'xl/workbook.xml', data: buildWorkbookXml(days, projectMembers) },
    { name: 'xl/_rels/workbook.xml.rels', data: buildWorkbookRelsXml() },
    { name: 'xl/styles.xml', data: buildStylesXml() },
    { name: 'xl/worksheets/sheet1.xml', data: worksheetXml },
    { name: 'xl/worksheets/sheet2.xml', data: membersWorksheetXml },
  ]);
}

function resolveWbsOutputDir(requestedOutputDir) {
  if (requestedOutputDir && String(requestedOutputDir).trim()) {
    return path.isAbsolute(requestedOutputDir)
      ? requestedOutputDir
      : path.resolve(process.cwd(), requestedOutputDir);
  }

  const settingsPath = path.join(process.cwd(), 'data', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (settings.wbsExcelOutputDir) {
        return path.isAbsolute(settings.wbsExcelOutputDir)
          ? settings.wbsExcelOutputDir
          : path.resolve(process.cwd(), settings.wbsExcelOutputDir);
      }
    } catch (e) {
      debugLog(`[wbs-export] Failed to read settings: ${e.message}`);
    }
  }

  return path.join(process.cwd(), 'exports');
}

function resolveReportOutputDir(requestedOutputDir) {
  if (requestedOutputDir && String(requestedOutputDir).trim()) {
    return path.isAbsolute(requestedOutputDir)
      ? requestedOutputDir
      : path.resolve(process.cwd(), requestedOutputDir);
  }

  const settingsPath = path.join(process.cwd(), 'data', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (settings.reportOutputDir) {
        return path.isAbsolute(settings.reportOutputDir)
          ? settings.reportOutputDir
          : path.resolve(process.cwd(), settings.reportOutputDir);
      }
    } catch (e) {
      debugLog(`[report-export] Failed to read settings: ${e.message}`);
    }
  }

  return path.join(process.cwd(), 'exports');
}

// ====== Vite Plugin ======
function backendPlugin() {
  return {
    name: 'backend-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // Disable timeout for long-running LLM API requests
        if (req.url && req.url.startsWith('/api/')) {
          req.setTimeout(0);
          res.setTimeout(0);
        }

        // SSE
        if (req.url === '/api/batch/events' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
          res.write(`event: snapshot\ndata: ${JSON.stringify({ logs: state.logs, tasks: state.createdTasks, minutes: state.createdMinutes, isProcessing: state.isProcessing, currentFile: state.currentFile, processedCount: state.processedCount, totalCount: state.totalCount })}\n\n`);
          state.sseClients.add(res);
          const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch (e) { clearInterval(ka); } }, 30000);
          req.on('close', () => { state.sseClients.delete(res); clearInterval(ka); });
          return;
        }
        // Start batch
        if (req.url === '/api/batch/start' && req.method === 'POST') {
          try {
            const { dir, llmEndpoint, stream } = await parseBody(req);
            if (state.isProcessing) { res.statusCode = 409; res.end(JSON.stringify({ error: 'Already processing' })); return; }
            processBatch(dir, llmEndpoint || 'http://localhost:8080/v1', stream !== false);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
          } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
          return;
        }
        // Status
        if (req.url === '/api/batch/status' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ isProcessing: state.isProcessing, currentFile: state.currentFile, processedCount: state.processedCount, totalCount: state.totalCount }));
          return;
        }
        // Weekly Report Generation (via callLlm for verbose logging)
        if (req.url === '/api/report/generate' && req.method === 'POST') {
          try {
            const { minutesText, templateText, llmEndpoint } = await parseBody(req);
            const templateInstruction = templateText
              ? `以下のテンプレートのフォーマットに厳密に従って出力してください。\n\n【出力テンプレート】\n${templateText}\n\n`
              : '今週の週報（サマリー、主な進捗、次週の課題）をマークダウン形式で作成してください。\n\n';
            const prompt = `以下の今週の複数の会議議事録要約を元に、週報を作成してください。

${templateInstruction}

【記述のレイアウト・フォーマットに関する重要指示】
- 週報内にテキストを記述する際は、1行あたり半角70文字（全角35文字）程度で適切に改行（折り返し）を行ってください。
- 改行する際は、その項目や箇条書きのインデント（行頭の半角スペースによるインデント幅）を崩さず、開始位置（インデント）を揃えて次の行を書き出してください。
  （例：行頭に半角スペース4つのインデントがある場合は、折り返した後の行も同様に半角スペース4つ分を空けて開始する）

【議事録要約群】
${minutesText}`;
            const endpoint = llmEndpoint || 'http://localhost:8080/v1';
            const result = await callLlm(endpoint, [{ role: 'user', content: prompt }], '週報生成', 0.3);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ output: result.output }));
          } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
          return;
        }

        // Generic LLM proxy call (for verbose logging on frontend actions)
        if (req.url === '/api/llm/call' && req.method === 'POST') {
          try {
            const { messages, label, temperature, llmEndpoint, stream } = await parseBody(req);
            const endpoint = llmEndpoint || 'http://localhost:8080/v1';
            const result = await callLlm(endpoint, messages, label || 'AI処理', temperature !== undefined ? temperature : 0.3, stream !== false);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ output: result.output, thinking: result.thinking }));
          } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
          return;
        }

        // WBS Excel Export
        if (req.url === '/api/wbs/export-excel' && req.method === 'POST') {
          try {
            const body = await parseBody(req);
            const outputDir = resolveWbsOutputDir(body.outputDir);
            fs.mkdirSync(outputDir, { recursive: true });

            const projectId = body.projectId === 'unassigned' ? null : body.projectId;
            const project = projectId ? (body.projects || []).find(p => p.id === projectId) : null;
            const projectName = project?.name || '未分類';
            const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_');
            const filePath = path.join(outputDir, `WBS_${sanitizeFileName(projectName)}_${timestamp}.xlsx`);
            const workbookBuffer = buildWbsWorkbookBuffer({
              projectId,
              tasks: body.tasks || [],
              projects: body.projects || [],
              members: body.members || [],
            });

            fs.writeFileSync(filePath, workbookBuffer);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, filePath }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        // Weekly Report Export TXT
        if (req.url === '/api/report/export-txt' && req.method === 'POST') {
          try {
            const body = await parseBody(req);
            const outputDir = resolveReportOutputDir(body.outputDir);
            fs.mkdirSync(outputDir, { recursive: true });


            const jstString = new Date().toLocaleString("ja-JP", {timeZone: "Asia/Tokyo"});
            const match = jstString.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
            let yyyymmdd = '';
            if (match) {
              yyyymmdd = match[1] + match[2].padStart(2, '0') + match[3].padStart(2, '0');
            } else {
              const d = new Date();
              yyyymmdd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
            }

            // 設定とメンバーデータから動的にファイル名を構築
            let mySurname = '';
            let managerSurname = '';
            try {
              const settingsPath = path.join(process.cwd(), 'data', 'settings.json');
              const membersPath = path.join(process.cwd(), 'data', 'members.json');
              if (fs.existsSync(settingsPath) && fs.existsSync(membersPath)) {
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
                const allMembers = JSON.parse(fs.readFileSync(membersPath, 'utf-8'));
                const myNameValue = settings.myName || '';
                // myName はメンバーIDまたは名前で格納される場合がある
                const myMember = allMembers.find(m => m.id === myNameValue)
                  || allMembers.find(m => m.name === myNameValue);
                if (myMember) {
                  // 苗字を取得（スペース区切りの最初の部分）
                  mySurname = myMember.name.split(/\s+/)[0];
                  // 同じグループで役割が 'M' のメンバーを検索
                  const manager = allMembers.find(m => m.group === myMember.group && m.title === 'M' && m.id !== myMember.id);
                  if (manager) {
                    managerSurname = manager.name.split(/\s+/)[0];
                  }
                }
              }
            } catch (e) {
              debugLog(`[report-export] Failed to resolve member names: ${e.message}`);
            }
            const managerPart = managerSurname ? `${managerSurname}T` : '未設定T';
            const myPart = mySurname || '未設定';
            const filePath = path.join(outputDir, `週報_${managerPart}_${myPart}_${yyyymmdd}.txt`);
            fs.writeFileSync(filePath, body.content || '', 'utf-8');

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, filePath }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }
        
        // Binary Image Viewer
        if (req.url.startsWith('/api/image/view') && req.method === 'GET') {
          try {
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            const filePath = urlObj.searchParams.get('path');
            if (!filePath || !fs.existsSync(filePath)) {
              res.statusCode = 404; res.end(JSON.stringify({ error: 'Image not found' })); return;
            }
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' };
            const contentType = mimeTypes[ext] || 'application/octet-stream';
            const imageBuffer = fs.readFileSync(filePath);
            res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': imageBuffer.length, 'Cache-Control': 'public, max-age=3600' });
            res.end(imageBuffer);
          } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
          return;
        }
        
        // Image Upload for Paste
        if (req.url === '/api/image/upload' && req.method === 'POST') {
          try {
            const body = await parseBody(req);
            const base64Data = body.imageBase64.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Data, 'base64');
            
            const imagesDir = path.join(process.cwd(), 'data', 'images');
            if (!fs.existsSync(imagesDir)) {
              fs.mkdirSync(imagesDir, { recursive: true });
            }
            
            const ext = body.mimeType ? body.mimeType.split('/')[1] : 'png';
            const filename = `paste_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;
            const filePath = path.join(imagesDir, filename);
            
            fs.writeFileSync(filePath, buffer);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, url: `/api/image/view?path=${encodeURIComponent(filePath)}` }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        // Scan screenshots for existing minutes
        if (req.url === '/api/minutes/scan-screenshots' && req.method === 'POST') {
          try {
            const settingsPath = path.join(process.cwd(), 'data', 'settings.json');
            const minutesPath = path.join(process.cwd(), 'data', 'minutes.json');
            
            let imageDir = '';
            if (fs.existsSync(settingsPath)) {
              const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
              imageDir = settings.imageDir || '';
            }
            
            if (!imageDir) {
              res.statusCode = 400; res.end(JSON.stringify({ error: 'imageDir not configured' })); return;
            }
            
            let minutes = [];
            if (fs.existsSync(minutesPath)) {
              minutes = JSON.parse(fs.readFileSync(minutesPath, 'utf-8'));
            }
            
            let updatedCount = 0;
            for (const minute of minutes) {
              // content から startTime/endTime を検出
              if (!minute.startTime && minute.content) {
                const { meetingDate, startTime, endTime } = parseMeetingDatetime(minute.content, minute.title || '');
                if (startTime) {
                  minute.startTime = startTime;
                  minute.endTime = endTime;
                  if (meetingDate) minute.date = meetingDate;
                  debugLog(`[scan-screenshots] Detected times for "${minute.title}": ${startTime} - ${endTime}`);
                }
              }
              
              // スクリーンショットスキャン
              if (minute.startTime && minute.date) {
                const matched = scanScreenshots(imageDir, minute.date, minute.startTime, minute.endTime);
                if (matched.length > 0) {
                  const imageUrls = matched.map(ss => `/api/image/view?path=${encodeURIComponent(ss.path)}`);
                  minute.images = Array.from(new Set([...(minute.images || []), ...imageUrls]));
                  
                  updatedCount++;
                  debugLog(`[scan-screenshots] Attached ${matched.length} screenshots to "${minute.title}"`);
                }
              }
            }
            
            // 更新を保存
            if (updatedCount > 0) {
              fs.writeFileSync(minutesPath, JSON.stringify(minutes, null, 2), 'utf-8');
            }
            
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, updatedCount, totalMinutes: minutes.length }));
          } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
          return;
        }
        // Read Arbitrary File
        if (req.url.startsWith('/api/file/read') && req.method === 'GET') {
          try {
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            const filePath = urlObj.searchParams.get('path');
            if (!filePath || !fs.existsSync(filePath)) {
              res.statusCode = 404; res.end(JSON.stringify({ error: 'File not found' })); return;
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            res.setHeader('Content-Type', 'text/plain');
            res.end(content);
          } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
          return;
        }
        // Unprocessed files
        if (req.url?.startsWith('/api/files/unprocessed') && req.method === 'GET') {
          try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const dirPath = url.searchParams.get('dir');
            const all = url.searchParams.get('all') === 'true';
            if (!dirPath || !fs.existsSync(dirPath)) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Invalid path' })); return; }
            const results = getUnprocessedItems(dirPath, all);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(results));
          } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
          return;
        }
        // Mark processed
        if (req.url === '/api/files/mark_processed' && req.method === 'POST') {
          try {
            const { filePath } = await parseBody(req);
            if (!filePath || !fs.existsSync(filePath)) { res.statusCode = 400; res.end(JSON.stringify({ error: 'File not found' })); return; }
            const stats = fs.statSync(filePath);
            let newPath = filePath + '_処理済み';
            if (stats.isDirectory()) {
              fs.renameSync(filePath, newPath);
            } else {
              const ext = path.extname(filePath); 
              const base = path.basename(filePath, ext); 
              const dir = path.dirname(filePath);
              newPath = path.join(dir, `${base}_処理済み${ext}`);
              fs.renameSync(filePath, newPath);
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, newPath }));
          } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
          return;
        }
        // Data Persistence - GET
        if (req.url === '/api/data' && req.method === 'GET') {
          try {
            const dbDir = path.join(process.cwd(), 'data');
            const result = { tasks: [], minutes: [], projects: [], members: [], reports: [], settings: {} };
            
            if (fs.existsSync(dbDir)) {
              for (const key of Object.keys(result)) {
                const filePath = path.join(dbDir, `${key}.json`);
                if (fs.existsSync(filePath)) {
                  try {
                    result[key] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                  } catch (e) {
                    console.error(`Failed to parse ${key}.json`, e);
                  }
                }
              }
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
          } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
          return;
        }

        // Data Persistence - POST
        if (req.url === '/api/data' && req.method === 'POST') {
          try {
            const data = await parseBody(req);
            const dbDir = path.join(process.cwd(), 'data');
            if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
            
            for (const key of ['tasks', 'minutes', 'projects', 'members', 'reports', 'settings']) {
              if (data[key]) {
                const filePath = path.join(dbDir, `${key}.json`);
                fs.writeFileSync(filePath, JSON.stringify(data[key], null, 2), 'utf-8');
              }
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
          } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
          return;
        }

        // ====== スマートタスク抽出API（プロジェクト選択後の再開用） ======
        if (req.url === '/api/batch/extract-tasks' && req.method === 'POST') {
          try {
            const body = await parseBody(req);
            const { minuteId, projectId, llmEndpoint: reqLlmEndpoint } = body;

            if (!minuteId || !projectId) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'minuteId and projectId are required' }));
              return;
            }

            // 保留中コンテキストがある場合はそれを使用、なければデータから再構築
            let fileContent = '';
            let endpoint = reqLlmEndpoint || 'http://localhost:8080/v1';
            let streamOpt = true;

            const pendingCtx = state.pendingFileContexts.get(minuteId);
            if (pendingCtx) {
              fileContent = pendingCtx.content;
              endpoint = pendingCtx.llmEndpoint || endpoint;
              streamOpt = pendingCtx.streamOption !== undefined ? pendingCtx.streamOption : true;
              state.pendingFileContexts.delete(minuteId);
            } else {
              // ディスクから議事録を読み込み
              const minutesOnDisk = loadDataFile('minutes.json');
              const minuteRecord = minutesOnDisk.find(m => m.id === minuteId);
              if (minuteRecord) {
                fileContent = minuteRecord.content || '';
              }
            }

            if (!fileContent) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Minute content not found' }));
              return;
            }

            // スマートタスク抽出を実行
            const dbTasks = loadDataFile('tasks.json');
            const dbMembers = loadDataFile('members.json');

            const activeTasks = dbTasks.filter(t =>
              t.projectId === projectId &&
              !t.isNew &&
              (t.status === 'todo' || t.status === 'in-progress')
            );
            const groupTasks = dbTasks.filter(t =>
              t.projectId === projectId &&
              !t.isNew &&
              (t.isGroup || dbTasks.some(c => c.parentId === t.id))
            );

            const smartPrompt = buildSmartTaskExtractionPrompt(fileContent, activeTasks, groupTasks, dbMembers);
            const smartResult = await callLlm(endpoint, [
              { role: 'system', content: 'You are a helpful assistant that strictly outputs valid JSON.' },
              { role: 'user', content: smartPrompt }
            ], `スマートタスク抽出（手動選択後）`, 0.6, streamOpt);

            let parsed = [];
            try { parsed = JSON.parse(smartResult.output.replace(/```json\n?|```/g, '').trim()); } catch (e) { }

            const result = processSmartTaskResults(parsed, projectId, null);

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              success: true,
              newTasksCount: result.newTasks.length,
              updatedTasksCount: result.updatedTasks.length,
            }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        // ====== バックアップ作成 API ======
        if (req.url === '/api/backup/create' && req.method === 'POST') {
          try {
            const dbDir = path.join(process.cwd(), 'data');
            const backupDir = path.join(dbDir, 'backups');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

            const result = { tasks: [], minutes: [], projects: [], members: [], reports: [], settings: {} };
            if (fs.existsSync(dbDir)) {
              for (const key of Object.keys(result)) {
                const filePath = path.join(dbDir, `${key}.json`);
                if (fs.existsSync(filePath)) {
                  try { result[key] = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch (e) {}
                }
              }
            }
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFilename = `backup_${timestamp}.json`;
            const backupFilePath = path.join(backupDir, backupFilename);
            fs.writeFileSync(backupFilePath, JSON.stringify(result, null, 2), 'utf-8');

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, filename: backupFilename }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        // ====== バックアップ一覧取得 API ======
        if (req.url === '/api/backup/list' && req.method === 'GET') {
          try {
            const backupDir = path.join(process.cwd(), 'data', 'backups');
            const backups = [];
            if (fs.existsSync(backupDir)) {
              const files = fs.readdirSync(backupDir);
              for (const file of files) {
                if (file.startsWith('backup_') && file.endsWith('.json')) {
                  const filePath = path.join(backupDir, file);
                  const stats = fs.statSync(filePath);
                  backups.push({
                    filename: file,
                    createdAt: stats.birthtime || stats.mtime,
                    size: stats.size
                  });
                }
              }
            }
            backups.sort((a, b) => b.filename.localeCompare(a.filename));
            
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(backups));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        // ====== バックアップ復元 API ======
        if (req.url === '/api/backup/restore' && req.method === 'POST') {
          try {
            const { filename } = await parseBody(req);
            if (!filename) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'filename is required' }));
              return;
            }
            const backupFilePath = path.join(process.cwd(), 'data', 'backups', filename);
            if (!fs.existsSync(backupFilePath)) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Backup file not found' }));
              return;
            }
            
            const backupData = JSON.parse(fs.readFileSync(backupFilePath, 'utf-8'));
            const dbDir = path.join(process.cwd(), 'data');
            if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

            for (const key of ['tasks', 'minutes', 'projects', 'members', 'reports', 'settings']) {
              if (backupData[key]) {
                const filePath = path.join(dbDir, `${key}.json`);
                fs.writeFileSync(filePath, JSON.stringify(backupData[key], null, 2), 'utf-8');
              }
            }
            
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        // ====== LLM自動エッジ生成 API ======
        if (req.url === '/api/llm/generate-edges' && req.method === 'POST') {
          try {
            const { projectId, llmEndpoint: reqLlmEndpoint } = await parseBody(req);
            if (!projectId) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'projectId is required' }));
              return;
            }
            
            const dbTasks = loadDataFile('tasks.json');
            const projectTasks = dbTasks.filter(t => t.projectId === projectId && !t.isGroup && !t.isNew);
            
            if (projectTasks.length < 2) {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify([]));
              return;
            }

            const endpoint = reqLlmEndpoint || 'http://localhost:8080/v1';
            const edgePrompt = buildTaskEdgeGenerationPrompt(projectTasks);
            
            const llmResult = await callLlm(endpoint, [
              { role: 'system', content: 'You are a helpful assistant that strictly outputs valid JSON.' },
              { role: 'user', content: edgePrompt }
            ], `タスク間エッジ自動生成`, 0.2, false);

            let parsed = [];
            try {
              parsed = JSON.parse(llmResult.output.replace(/```json\n?|```/g, '').trim());
            } catch (e) {
              debugLog(`[generate-edges] JSON parse failed: ${e.message}`);
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(parsed));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        next();
      });
    }
  }
}

export default defineConfig({
  plugins: [react(), backendPlugin()],
})
