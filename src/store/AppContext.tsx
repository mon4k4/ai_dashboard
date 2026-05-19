import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { TaskExtractResult, MinuteSummary, Project, TeamMember, WeeklyReport } from '../services/llmService';

export interface LlmLog {
  id: string;
  timestamp: string;
  endpoint: string;
  prompt: string;
  responseParams: any;
  thinkingProcess?: string;
  finalOutput: string;
  latencyMs: number;
  error?: string;
  status?: 'streaming' | 'complete' | 'error';
  label?: string;
}

interface BatchStatus {
  isProcessing: boolean;
  currentFile: string | null;
  processedCount: number;
  totalCount: number;
  message: string;
}

interface AppState {
  tasks: TaskExtractResult[];
  minutes: MinuteSummary[];
  projects: Project[];
  members: TeamMember[];
  reports: WeeklyReport[];
  llmLogs: LlmLog[];
  batchStatus: BatchStatus;
  addTask: (task: TaskExtractResult) => void;
  updateTask: (id: string, updates: Partial<TaskExtractResult>) => void;
  commitTask: (id: string) => void;
  reorderTasks: (orderedIds: string[]) => void;
  addMinute: (minute: MinuteSummary) => void;
  updateMinute: (id: string, updates: Partial<MinuteSummary>) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  addMember: (member: TeamMember) => void;
  updateMember: (id: string, updates: Partial<TeamMember>) => void;
  deleteMember: (id: string) => void;
  addReport: (report: WeeklyReport) => void;
  updateReport: (id: string, updates: Partial<WeeklyReport>) => void;
  pendingMembers: string[];
  clearPendingMembers: () => void;
}

const AppContext = createContext<AppState | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<TaskExtractResult[]>([]);
  const [minutes, setMinutes] = useState<MinuteSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [llmLogs, setLlmLogs] = useState<LlmLog[]>([]);
  const [batchStatus, setBatchStatus] = useState<BatchStatus>({
    isProcessing: false, currentFile: null, processedCount: 0, totalCount: 0, message: ''
  });
  const [pendingMembers, setPendingMembers] = useState<string[]>([]);
  const sseRef = useRef<EventSource | null>(null);

  const [isLoaded, setIsLoaded] = useState(false);

  // Load from Backend API
  useEffect(() => {
    fetch('/api/data')
      .then(res => res.json())
      .then(data => {
        if (data.tasks) setTasks(data.tasks);
        if (data.minutes) setMinutes(data.minutes);
        if (data.projects) setProjects(data.projects);
        if (data.members) setMembers(data.members);
        if (data.reports) setReports(data.reports);
        setIsLoaded(true);
      })
      .catch(e => {
        console.error('Failed to load data:', e);
        setIsLoaded(true);
      });
  }, []);

  // Save to Backend API (Auto-save)
  useEffect(() => {
    if (!isLoaded) return;
    
    const timer = setTimeout(() => {
      fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks, minutes, projects, members, reports })
      }).catch(e => console.error('Failed to save data:', e));
    }, 500);

    return () => clearTimeout(timer);
  }, [tasks, minutes, projects, members, reports, isLoaded]);

  // ====== SSE接続: バックエンドからのイベントを購読 ======
  useEffect(() => {
    const connect = () => {
      const es = new EventSource('/api/batch/events');
      sseRef.current = es;

      es.addEventListener('snapshot', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        setLlmLogs(data.logs || []);
        setBatchStatus({
          isProcessing: data.isProcessing,
          currentFile: data.currentFile,
          processedCount: data.processedCount,
          totalCount: data.totalCount,
          message: data.isProcessing ? `${data.currentFile} を処理中...` : '',
        });
        // バックエンドで作成されたタスク・議事録をマージ（重複排除）
        if (data.tasks?.length) {
          setTasks(prev => {
            const existingIds = new Set(prev.map(t => t.id));
            const newOnes = data.tasks.filter((t: any) => !existingIds.has(t.id));
            return newOnes.length ? [...prev, ...newOnes] : prev;
          });
        }
        if (data.minutes?.length) {
          setMinutes(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const newOnes = data.minutes.filter((m: any) => !existingIds.has(m.id));
            return newOnes.length ? [...newOnes, ...prev] : prev;
          });
        }
      });

      es.addEventListener('log_created', (e: MessageEvent) => {
        const log = JSON.parse(e.data);
        setLlmLogs(prev => [log, ...prev.filter(l => l.id !== log.id)]);
      });

      es.addEventListener('log_chunk', (e: MessageEvent) => {
        const { id, thinkingProcess, finalOutput } = JSON.parse(e.data);
        setLlmLogs(prev => prev.map(l => l.id === id ? { ...l, thinkingProcess, finalOutput } : l));
      });

      es.addEventListener('log_complete', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        setLlmLogs(prev => prev.map(l => l.id === data.id ? { ...l, ...data, status: data.error ? 'error' : 'complete' } : l));
      });

      es.addEventListener('task_created', (e: MessageEvent) => {
        const task = JSON.parse(e.data);
        setTasks(prev => prev.some(t => t.id === task.id) ? prev : [...prev, task]);
      });

      es.addEventListener('minute_created', (e: MessageEvent) => {
        const minute = JSON.parse(e.data);
        setMinutes(prev => prev.some(m => m.id === minute.id) ? prev : [minute, ...prev]);
      });

      es.addEventListener('batch_status', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        const messages: Record<string, string> = {
          started: `${data.totalCount}件のファイルの処理を開始します...`,
          processing: `${data.currentFile} を処理中...`,
          complete: `${data.processedCount}件の議事録を処理しました。`,
          no_files: '未処理の議事録はありませんでした。',
          error: `エラー: ${data.error}`,
          file_error: `${data.filename}: エラー - ${data.error}`,
        };
        setBatchStatus({
          isProcessing: data.status === 'started' || data.status === 'processing',
          currentFile: data.currentFile || null,
          processedCount: data.processedCount || 0,
          totalCount: data.totalCount || 0,
          message: messages[data.status] || '',
        });
      });

      es.addEventListener('new_members_extracted', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        if (data.names && Array.isArray(data.names)) {
          setPendingMembers(prev => Array.from(new Set([...prev, ...data.names])));
        }
      });

      es.onerror = () => {
        es.close();
        setTimeout(connect, 3000); // 再接続
      };
    };

    connect();
    return () => { sseRef.current?.close(); };
  }, []);

  const addTask = useCallback((task: TaskExtractResult) => {
    setTasks(prev => [...prev, task]);
  }, []);

  const updateTask = useCallback((id: string, updates: Partial<TaskExtractResult>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const commitTask = useCallback((id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, isNew: false } : t));
  }, []);

  const reorderTasks = useCallback((orderedIds: string[]) => {
    setTasks(prev => {
      const taskMap = new Map(prev.map(t => [t.id, t]));
      orderedIds.forEach((id, index) => {
        const task = taskMap.get(id);
        if (task) {
          taskMap.set(id, { ...task, wbsOrder: index });
        }
      });
      return prev.map(t => taskMap.get(t.id) || t);
    });
  }, []);

  const addMinute = useCallback((minute: MinuteSummary) => {
    setMinutes(prev => [minute, ...prev]);
  }, []);

  const updateMinute = useCallback((id: string, updates: Partial<MinuteSummary>) => {
    setMinutes(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }, []);

  const addProject = useCallback((project: Project) => {
    setProjects(prev => [...prev, project]);
  }, []);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const deleteProject = useCallback((id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id));
  }, []);

  const addMember = useCallback((member: TeamMember) => {
    setMembers(prev => [...prev, member]);
  }, []);

  const updateMember = useCallback((id: string, updates: Partial<TeamMember>) => {
    setMembers(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }, []);

  const deleteMember = useCallback((id: string) => {
    setMembers(prev => prev.filter(m => m.id !== id));
  }, []);

  const clearPendingMembers = useCallback(() => {
    setPendingMembers([]);
  }, []);

  const addReport = useCallback((report: WeeklyReport) => {
    setReports(prev => [report, ...prev]);
  }, []);

  const updateReport = useCallback((id: string, updates: Partial<WeeklyReport>) => {
    setReports(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  }, []);

  return (
    <AppContext.Provider value={{ 
      tasks, minutes, projects, members, reports, llmLogs, batchStatus, pendingMembers,
      addTask, updateTask, commitTask, reorderTasks, addMinute, updateMinute,
      addProject, updateProject, deleteProject,
      addMember, updateMember, deleteMember, addReport, updateReport, clearPendingMembers
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) throw new Error('useAppContext must be used within an AppProvider');
  return context;
}
