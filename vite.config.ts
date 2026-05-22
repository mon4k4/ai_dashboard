// @ts-nocheck
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { buildSummaryPrompt } from './src/prompts/summaryPrompts'
import { buildTaskExtractionPrompt } from './src/prompts/taskPrompts'
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
        const targetFile = subFiles.find(sf => sf.endsWith('.txt')) || subFiles.find(sf => sf.endsWith('.vtt'));
        if (targetFile) {
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
function parseMeetingDatetime(content, filename) {
  let startTime = null;
  let endTime = null;
  let meetingDate = null;

  // ヘッダから日時を検出: **日時:** 2026/05/21 14:00 - 15:08
  const headerMatch = content.match(/[\*]*日時[\*]*[：:]\s*[\*]*\s*(\d{4})[\/-](\d{2})[\/-](\d{2})\s+(\d{2}):(\d{2})\s*[-–~〜]\s*(\d{2}):(\d{2})/);
  if (headerMatch) {
    meetingDate = `${headerMatch[1]}-${headerMatch[2]}-${headerMatch[3]}`;
    startTime = `${headerMatch[4]}:${headerMatch[5]}`;
    endTime = `${headerMatch[6]}:${headerMatch[7]}`;
    debugLog(`[parseMeetingDatetime] Header parsed: date=${meetingDate} start=${startTime} end=${endTime}`);
  }

  // フォルダ名からフォールバック: 2026-05-21 14.00.15 タイトル
  if (!startTime) {
    const folderMatch = filename.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2})\.(\d{2})\.(\d{2})/);
    if (folderMatch) {
      meetingDate = folderMatch[1];
      startTime = `${folderMatch[2]}:${folderMatch[3]}`;
      debugLog(`[parseMeetingDatetime] Folder fallback: date=${meetingDate} start=${startTime}`);
    }
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

// ====== ファイル処理 ======
async function processFile(file, llmEndpoint, streamOption = true) {
  state.currentFile = file.filename;
  broadcast('batch_status', { status: 'processing', currentFile: file.filename, processedCount: state.processedCount, totalCount: state.totalCount });

  const sumResult = await callLlm(llmEndpoint, [{ role: 'user', content: buildSummaryPrompt(file.content) }], `要約: ${file.filename}`, 0.6, streamOption);
  const taskResult = await callLlm(llmEndpoint, [
    { role: 'system', content: 'You are a helpful assistant that strictly outputs valid JSON.' },
    { role: 'user', content: buildTaskExtractionPrompt(file.content) }
  ], `タスク抽出: ${file.filename}`, 0.6, streamOption);

  let parsed = [];
  try { parsed = JSON.parse(taskResult.output.replace(/```json\n?|```/g, '').trim()); } catch (e) { }

  const tasks = parsed.map(t => ({ ...t, id: genId('task'), status: 'todo', isNew: true }));
  
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
    const dateMatch = file.filename.match(/^(\d{4})(\d{2})(\d{2})/);
    if (dateMatch) {
      extractedDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    }
  }

  // ====== 会議時刻の検出 ======
  const { meetingDate, startTime: meetingStartTime, endTime: meetingEndTime } = parseMeetingDatetime(file.content, file.filename);
  if (meetingDate) extractedDate = meetingDate;

  // ====== スクリーンショット自動連携 ======
  let screenshotImages = [];
  let summaryWithImages = sumResult.output;
  
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
        
        // 要約末尾にスクリーンショットセクションを追加
        summaryWithImages += '\n\n---\n\n### 📸 会議中のスクリーンショット\n\n';
        for (const ss of matchedScreenshots) {
          const imgUrl = `/api/image/view?path=${encodeURIComponent(ss.path)}`;
          summaryWithImages += `**${ss.time}** \n![${ss.filename}](${imgUrl})\n\n`;
        }
        debugLog(`[processFile] ${matchedScreenshots.length} screenshots attached to minute`);
      }
    }
  } catch (e) {
    debugLog(`[processFile] Screenshot scan error: ${e.message}`);
  }

  const minute = {
    id: genId('min'),
    date: extractedDate,
    title: title,
    summary: summaryWithImages,
    content: file.content,
    extractedTasks: tasks,
    startTime: meetingStartTime || undefined,
    endTime: meetingEndTime || undefined,
    images: screenshotImages.length > 0 ? screenshotImages : undefined,
  };
  state.createdTasks.push(...tasks);
  state.createdMinutes.push(minute);
  for (const t of tasks) broadcast('task_created', t);
  broadcast('minute_created', minute);

  // ====== メンバ自動抽出 ======
  const extractedNames = new Set();
  
  if (file.isVtt && file.rawContent) {
    const vttNames = extractMembersFromVtt(file.rawContent);
    for (const name of vttNames) {
      extractedNames.add(name);
    }
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
    const dbDir = path.join(process.cwd(), 'data');
    const membersPath = path.join(dbDir, 'members.json');
    let members = [];
    if (fs.existsSync(membersPath)) {
      try { members = JSON.parse(fs.readFileSync(membersPath, 'utf-8')); } catch (e) {}
    }
    
    const newMembers = [];
    for (const name of extractedNames) {
      if (!members.find(m => m.name === name)) {
        newMembers.push(name);
      }
    }
    
    if (newMembers.length > 0) {
      broadcast('new_members_extracted', { names: newMembers, minuteTitle: title });
    }
  }

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
            const prompt = `以下の今週の複数の会議議事録要約を元に、週報を作成してください。\n${templateInstruction}【議事録要約群】\n${minutesText}`;
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
                  minute.images = imageUrls;
                  
                  // 要約にスクリーンショットセクションがなければ追加
                  if (minute.summary && !minute.summary.includes('会議中のスクリーンショット')) {
                    minute.summary += '\n\n---\n\n### 📸 会議中のスクリーンショット\n\n';
                    for (const ss of matched) {
                      const imgUrl = `/api/image/view?path=${encodeURIComponent(ss.path)}`;
                      minute.summary += `**${ss.time}** \n![${ss.filename}](${imgUrl})\n\n`;
                    }
                  }
                  
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

        next();
      });
    }
  }
}

export default defineConfig({
  plugins: [react(), backendPlugin()],
})
