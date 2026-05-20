// @ts-nocheck
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { buildSummaryPrompt } from './src/prompts/summaryPrompts'
import { buildTaskExtractionPrompt } from './src/prompts/taskPrompts'

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

// ====== VTTからメンバー名を抽出 ======
function extractMembersFromVtt(vttContent) {
  const names = new Set();
  const regex = /<v\s+([^>]+)>/g;
  let match;
  while ((match = regex.exec(vttContent)) !== null) {
    const fullName = match[1].trim();
    if (fullName && fullName.length < 50) {
      names.add(fullName);
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
async function callLlm(endpoint, messages, label, temp = 0.3) {
  const logId = genId('log');
  const startTime = Date.now();
  const log = {
    id: logId, timestamp: new Date().toISOString(),
    endpoint: `${endpoint}/chat/completions`,
    prompt: messages.find(m => m.role === 'user')?.content || '',
    responseParams: { messages: messages.map(m => ({ role: m.role, content: m.content.substring(0, 200) + '...' })), temperature: temp },
    thinkingProcess: '', finalOutput: '', latencyMs: 0, status: 'streaming', label,
  };
  state.logs.push(log);
  broadcast('log_created', log);
  debugLog(`[callLlm] START label=${label} logId=${logId} endpoint=${endpoint}`);
  debugLog(`[callLlm] SSE clients count: ${state.sseClients.size}`);

  let thinkingFull = '';
  let outputFull = '';
  try {
    const fetchUrl = `${endpoint}/chat/completions`;
    debugLog(`[callLlm] Fetching: ${fetchUrl} stream=true`);

    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, temperature: temp, stream: true }),
    });
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
        if (chunkCount <= 5) {
          debugLog(`[callLlm] Raw chunk #${chunkCount}: ${rawChunkText.substring(0, 300)}`);
        }
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


    // ストリーミングで何も取得できなかった場合は非ストリーミングで再試行
    if (!thinkingFull && !outputFull) {
      debugLog('[callLlm] No streaming data - retrying without stream');
      const res2 = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, temperature: temp }),
      });
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
    Object.assign(log, { thinkingProcess: thinkingFull, finalOutput: outputFull, latencyMs, status: 'complete' });
    broadcast('log_complete', { id: logId, thinkingProcess: thinkingFull, finalOutput: outputFull, latencyMs });
    debugLog(`[callLlm] COMPLETE thinking=${thinkingFull.length}chars output=${outputFull.length}chars ${latencyMs}ms`);
    return { thinking: thinkingFull, output: outputFull, logId };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    Object.assign(log, { error: err.message, latencyMs, status: 'error' });
    broadcast('log_complete', { id: logId, error: err.message, latencyMs });
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

// ====== ファイル処理 ======
async function processFile(file, llmEndpoint) {
  state.currentFile = file.filename;
  broadcast('batch_status', { status: 'processing', currentFile: file.filename, processedCount: state.processedCount, totalCount: state.totalCount });

  const sumResult = await callLlm(llmEndpoint, [{ role: 'user', content: buildSummaryPrompt(file.content) }], `要約: ${file.filename}`, 0.6);
  const taskResult = await callLlm(llmEndpoint, [
    { role: 'system', content: 'You are a helpful assistant that strictly outputs valid JSON.' },
    { role: 'user', content: buildTaskExtractionPrompt(file.content) }
  ], `タスク抽出: ${file.filename}`, 0.6);

  let parsed = [];
  try { parsed = JSON.parse(taskResult.output.replace(/```json\n?|```/g, '').trim()); } catch (e) { }

  const tasks = parsed.map(t => ({ ...t, id: genId('task'), status: 'todo', isNew: true }));
  
  let extractedDate = new Date().toISOString().split('T')[0];
  let title = file.filename.replace('.txt', '').replace('.vtt', '');
  
  if (file.isFolder) {
    // フォルダ名から日時とタイトルをパース (例: 2026-04-05 16.41.24 title)
    // 正規表現で 'YYYY-MM-DD HH.mm.ss Title' を抽出
    const match = file.filename.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2})\.(\d{2})\.(\d{2})\s+(.+)$/);
    if (match) {
      extractedDate = match[1]; // YYYY-MM-DD
      title = match[5]; // Title
    } else {
      title = file.filename;
    }
  } else {
    // 従来のフラットファイル処理 (例: 202605200930_Title)
    const dateMatch = file.filename.match(/^(\d{4})(\d{2})(\d{2})/);
    if (dateMatch) {
      extractedDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    }
  }
  
  const minute = { id: genId('min'), date: extractedDate, title: title, summary: sumResult.output, content: file.content, extractedTasks: tasks };
  state.createdTasks.push(...tasks);
  state.createdMinutes.push(minute);
  for (const t of tasks) broadcast('task_created', t);
  broadcast('minute_created', minute);

  // ====== メンバ自動抽出 ======
  const extractedNames = new Set();
  
  // VTTファイルの場合は <v Name> タグから直接抽出
  if (file.isVtt && file.rawContent) {
    const vttNames = extractMembersFromVtt(file.rawContent);
    for (const name of vttNames) {
      extractedNames.add(name);
    }
  }
  
  // 通常のテキスト形式の正規表現でも抽出
  const regex1 = /\[([^\]\n]{1,15})\]\s*\d{2}:\d{2}/g;
  const regex2 = /(?:^|\n)(?:\[?\d{2}:\d{2}(?::\d{2})?\]?\s*)?([^\[\]:：\n]{1,15})[=:：]/g;
  [regex1, regex2].forEach(regex => {
    let match;
    while ((match = regex.exec(file.content)) !== null) {
      const name = match[1].trim();
      if (name && name.length < 15 && !name.includes('http') && !['ID', 'URL', 'Time'].includes(name) && !name.startsWith('**')) {
        extractedNames.add(name);
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

async function processBatch(dir, llmEndpoint) {
  if (state.isProcessing) return;
  state.isProcessing = true;
  state.processedCount = 0;
  try {
    const files = getUnprocessedItems(dir);
    state.totalCount = files.length;
    if (!files.length) { broadcast('batch_status', { status: 'no_files' }); return; }
    broadcast('batch_status', { status: 'started', totalCount: files.length });
    for (const f of files) {
      try { await processFile(f, llmEndpoint); } catch (e) { broadcast('batch_status', { status: 'file_error', filename: f.filename, error: e.message }); }
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
            const { dir, llmEndpoint } = await parseBody(req);
            if (state.isProcessing) { res.statusCode = 409; res.end(JSON.stringify({ error: 'Already processing' })); return; }
            processBatch(dir, llmEndpoint || 'http://localhost:8080/v1');
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
