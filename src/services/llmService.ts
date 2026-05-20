import { buildTaskExtractionPrompt } from '../prompts/taskPrompts';
import { buildSummaryPrompt } from '../prompts/summaryPrompts';
import { buildWeeklyReportPrompt } from '../prompts/reportPrompts';
import { buildProjectStatusPrompt } from '../prompts/projectPrompts';

export interface TaskExtractResult {
  id: string;
  title: string;
  details?: string;
  assignee: string;
  memberId?: string;
  projectId?: string;
  status: 'todo' | 'in-progress' | 'done';
  startDate?: string;
  dueDate?: string;
  progress?: number;
  isNew?: boolean;
  wbsOrder?: number;
  actionResult?: string; // 対応結果
}

export interface Project {
  id: string;
  name: string;
  summary: string;
  startDate: string;
  endDate: string;
  client: string;
  orderName: string;
  color: string;
  workload: Record<string, number>; // e.g. { "2026-05": 160 }
  meetings?: ProjectMeeting[];
  aiStatusSummary?: string; // AI生成の状況と詳細概要
}

export interface ProjectMeeting {
  id: string;
  title: string;
  isRecurring: boolean;
  date?: string; // YYYY-MM-DD for single
  startDate?: string; // YYYY-MM-DD for recurring
  endDate?: string; // YYYY-MM-DD for recurring
  dayOfWeek?: number; // 0-6 for recurring
  time?: string; // e.g. "14:00"
}

export interface TeamMember {
  id: string;
  name: string;
  group: string;
}

export interface MinuteSummary {
  id: string;
  date: string;
  title: string;
  summary: string;
  content?: string;
  extractedTasks: TaskExtractResult[];
  images?: string[];
  projectId?: string; // 関連プロジェクトID
}

export interface WeeklyReport {
  id: string;
  date: string;
  content: string;
}


const getEndpoint = () => {
  return localStorage.getItem('llmEndpoint') || 'http://localhost:8080/v1';
};

/**
 * バックエンドにバッチ処理を開始させる（バックエンド主導・リロード耐性あり）
 */
export async function startBatchProcess(dir: string): Promise<void> {
  const llmEndpoint = getEndpoint();
  const res = await fetch('/api/batch/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir, llmEndpoint })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to start batch processing');
  }
}

/**
 * バッチ処理の状態を取得
 */
export async function getBatchStatus(): Promise<any> {
  const res = await fetch('/api/batch/status');
  return res.json();
}

/**
 * 未処理の議事録テキスト一覧を取得する (ローカルAPI経由)
 */
export async function getUnprocessedFiles(dir: string): Promise<{filename: string, fullPath: string, content: string}[]> {
  const res = await fetch(`/api/files/unprocessed?dir=${encodeURIComponent(dir)}`);
  if (!res.ok) throw new Error('Failed to fetch unprocessed files');
  return res.json();
}

/**
 * ファイルを処理済みとしてリネームする (ローカルAPI経由)
 */
export async function markFileAsProcessed(filePath: string): Promise<void> {
  const res = await fetch('/api/files/mark_processed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath })
  });
  if (!res.ok) throw new Error('Failed to mark file as processed');
}

/**
 * `<think>...</think>` ブロックを抽出し、思考プロセスと最終出力に分離する
 */
const parseThinkingResponse = (rawContent: string) => {
  const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    const thinkingProcess = thinkMatch[1].trim();
    const finalOutput = rawContent.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    return { thinkingProcess, finalOutput };
  }
  return { thinkingProcess: undefined, finalOutput: rawContent.trim() };
};

/**
 * Zoomの文字起こしテキストからタスクを抽出する（手動用・フロントエンド直接呼び出し）
 */
export async function extractTasksFromTranscript(transcript: string): Promise<TaskExtractResult[]> {
  const prompt = buildTaskExtractionPrompt(transcript);
  const endpoint = `${getEndpoint()}/chat/completions`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'You are a helpful assistant that strictly outputs valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
    })
  });

  if (!response.ok) throw new Error(`LLM API request failed: ${response.status}`);
  const data = await response.json();
  const rawContent = data.choices[0].message.content;
  const { finalOutput } = parseThinkingResponse(rawContent);
  const jsonStr = finalOutput.replace(/```json\n?|```/g, '').trim();
  return JSON.parse(jsonStr) as TaskExtractResult[];
}

/**
 * 議事録の要約を生成する（手動用）
 */
export async function summarizeMeeting(transcript: string): Promise<string> {
  const prompt = buildSummaryPrompt(transcript);
  const endpoint = `${getEndpoint()}/chat/completions`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    })
  });

  if (!response.ok) throw new Error('LLM API request failed');
  const data = await response.json();
  const rawContent = data.choices[0].message.content;
  const { finalOutput } = parseThinkingResponse(rawContent);
  return finalOutput;
}

/**
 * 複数の議事録から週報を生成する
 */
export async function generateWeeklyReport(minutes: MinuteSummary[], templateText?: string): Promise<string> {
  const minutesText = minutes.map(m => `■${m.date} ${m.title}\n${m.summary}`).join('\n\n');
  const prompt = buildWeeklyReportPrompt(minutesText, templateText);
  const endpoint = `${getEndpoint()}/chat/completions`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    })
  });

  if (!response.ok) throw new Error('LLM API request failed');
  const data = await response.json();
  const rawContent = data.choices[0].message.content;
  const { finalOutput } = parseThinkingResponse(rawContent);
  return finalOutput;
}

/**
 * プロジェクトの状況と詳細概要をAIで生成する
 */
export async function generateProjectStatus(project: Project, minutes: MinuteSummary[], tasks: TaskExtractResult[]): Promise<string> {
  const minutesText = minutes.map(m => `■ ${m.date} ${m.title}\n要約:\n${m.summary}`).join('\n\n');
  const tasksText = tasks.map(t => {
    let tStr = `- [${t.status}] ${t.title} (担当: ${t.assignee || '未設定'}`;
    if (t.progress !== undefined) tStr += `, 進捗: ${t.progress}%`;
    if (t.dueDate) tStr += `, 期日: ${t.dueDate}`;
    tStr += `)`;
    if (t.details) tStr += `\n  詳細: ${t.details}`;
    if (t.actionResult) tStr += `\n  対応結果: ${t.actionResult}`;
    return tStr;
  }).join('\n');

  const prompt = buildProjectStatusPrompt(project.name, project.summary, minutesText, tasksText);
  const endpoint = `${getEndpoint()}/chat/completions`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    })
  });

  if (!response.ok) throw new Error('LLM API request failed');
  const data = await response.json();
  const rawContent = data.choices[0].message.content;
  const { finalOutput } = parseThinkingResponse(rawContent);
  return finalOutput;
}

