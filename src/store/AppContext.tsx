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
  status?: 'streaming' | 'pending' | 'complete' | 'error';
  label?: string;
  statusCode?: number;
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
  deleteTask: (id: string) => void;
  reorderTasks: (orderedIds: string[]) => void;
  addMinute: (minute: MinuteSummary) => void;
  updateMinute: (id: string, updates: Partial<MinuteSummary>) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  moveProject: (id: string, direction: 'up' | 'down') => void;
  addMember: (member: TeamMember) => void;
  updateMember: (id: string, updates: Partial<TeamMember>) => void;
  deleteMember: (id: string) => void;
  moveMember: (id: string, direction: 'up' | 'down') => void;
  reorderMembers: (group: string, fromIdx: number, toIdx: number) => void;
  addReport: (report: WeeklyReport) => void;
  updateReport: (id: string, updates: Partial<WeeklyReport>) => void;
  settings: Record<string, string>;
  saveSettings: (newSettings: Record<string, string>) => void;
  pendingMembers: PendingMemberGroup[];
  clearPendingMembers: (minuteTitle?: string) => void;
  addPendingMembers: (minuteTitle: string, names: string[]) => void;
}

export interface PendingMemberGroup {
  minuteTitle: string;
  names: string[];
}

const AppContext = createContext<AppState | undefined>(undefined);

function extractMarkdownImageSources(content: string): string[] {
  const sources: string[] = [];
  const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    sources.push(match[1]);
  }
  return sources;
}

function stripMarkdownImages(content: string): string {
  const lines = content.split('\n');
  const removeIndexes = new Set<number>();

  lines.forEach((line, index) => {
    if (!/!\[[^\]]*\]\([^)]+\)/.test(line)) return;

    removeIndexes.add(index);
    if (index > 0 && lines[index - 1].trim() === '') removeIndexes.add(index - 1);
    if (index > 0 && /^\*\*.+\*\*\s*$/.test(lines[index - 1].trim())) removeIndexes.add(index - 1);
    if (index > 1 && removeIndexes.has(index - 1) && /^\*\*.+\*\*\s*$/.test(lines[index - 2].trim())) removeIndexes.add(index - 2);
    if (index + 1 < lines.length && lines[index + 1].trim() === '') removeIndexes.add(index + 1);
  });

  return lines
    .filter((_, index) => !removeIndexes.has(index))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n?---\n\n### .? 会議中のスクリーンショット\s*$/u, '')
    .trimEnd();
}

function normalizeMinuteImages(minute: MinuteSummary): MinuteSummary {
  const markdownImages = extractMarkdownImageSources(minute.summary || '');
  if (markdownImages.length === 0) return minute;

  return {
    ...minute,
    summary: stripMarkdownImages(minute.summary || ''),
    images: Array.from(new Set([...(minute.images || []), ...markdownImages])),
  };
}

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
  const [pendingMembers, setPendingMembers] = useState<PendingMemberGroup[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const sseRef = useRef<EventSource | null>(null);

  const [isLoaded, setIsLoaded] = useState(false);

  // Load from Backend API
  useEffect(() => {
    fetch('/api/data')
      .then(res => res.json())
      .then(data => {
        if (data.tasks) setTasks(data.tasks);
        if (data.minutes) setMinutes(data.minutes.map(normalizeMinuteImages));
        if (data.projects) setProjects(data.projects);
        if (data.members) setMembers(data.members);
        if (data.reports) setReports(data.reports);
        if (data.settings) {
          setSettings(data.settings);
          Object.entries(data.settings).forEach(([key, val]) => {
            if (val !== undefined && val !== null) {
              localStorage.setItem(key, String(val));
            }
          });
        }
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
        body: JSON.stringify({ tasks, minutes, projects, members, reports, settings })
      }).catch(e => console.error('Failed to save data:', e));
    }, 500);

    return () => clearTimeout(timer);
  }, [tasks, minutes, projects, members, reports, settings, isLoaded]);

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
          const title = data.minuteTitle || '新規議事録';
          setPendingMembers(prev => {
            const existingIdx = prev.findIndex(g => g.minuteTitle === title);
            if (existingIdx >= 0) {
              const updated = [...prev];
              updated[existingIdx] = {
                ...updated[existingIdx],
                names: Array.from(new Set([...updated[existingIdx].names, ...data.names]))
              };
              return updated;
            } else {
              return [...prev, { minuteTitle: title, names: data.names }];
            }
          });
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

  const deleteTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id).map(t => t.parentId === id ? { ...t, parentId: undefined } : t));
    setMinutes(prevMinutes => prevMinutes.map(m => {
      const hasTask = m.extractedTasks && m.extractedTasks.some(t => t.id === id);
      if (hasTask) {
        return {
          ...m,
          extractedTasks: m.extractedTasks.filter(t => t.id !== id)
        };
      }
      return m;
    }));
  }, []);

  const updateTask = useCallback((id: string, updates: Partial<TaskExtractResult>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    setMinutes(prevMinutes => prevMinutes.map(m => {
      const hasTask = m.extractedTasks && m.extractedTasks.some(t => t.id === id);
      if (hasTask) {
        return {
          ...m,
          extractedTasks: m.extractedTasks.map(t => t.id === id ? { ...t, ...updates } : t)
        };
      }
      return m;
    }));
  }, []);

  const commitTask = useCallback((id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, isNew: false } : t));
    setMinutes(prevMinutes => prevMinutes.map(m => {
      const hasTask = m.extractedTasks && m.extractedTasks.some(t => t.id === id);
      if (hasTask) {
        return {
          ...m,
          extractedTasks: m.extractedTasks.map(t => t.id === id ? { ...t, isNew: false } : t)
        };
      }
      return m;
    }));
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
    setMinutes(prev => prev.map(m => {
      if (m.id === id) {
        const hasProjectIdUpdate = 'projectId' in updates;
        
        const updatedExtractedTasks = hasProjectIdUpdate
          ? (m.extractedTasks || []).map(t => ({ ...t, projectId: updates.projectId }))
          : m.extractedTasks;
        
        if (hasProjectIdUpdate && m.extractedTasks && m.extractedTasks.length > 0) {
          const taskIds = new Set(m.extractedTasks.map(t => t.id));
          setTasks(prevTasks => prevTasks.map(t => taskIds.has(t.id) ? { ...t, projectId: updates.projectId } : t));
        }

        return { ...m, ...updates, extractedTasks: updatedExtractedTasks };
      }
      return m;
    }));
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

  const moveProject = useCallback((id: string, direction: 'up' | 'down') => {
    setProjects(prev => {
      const idx = prev.findIndex(p => p.id === id);
      if (idx === -1) return prev;
      const newProjects = [...prev];
      if (direction === 'up' && idx > 0) {
        const temp = newProjects[idx];
        newProjects[idx] = newProjects[idx - 1];
        newProjects[idx - 1] = temp;
      } else if (direction === 'down' && idx < newProjects.length - 1) {
        const temp = newProjects[idx];
        newProjects[idx] = newProjects[idx + 1];
        newProjects[idx + 1] = temp;
      }
      return newProjects;
    });
  }, []);

  const addMember = useCallback((member: TeamMember) => {
    setMembers(prev => {
      if (prev.some(m => m.name === member.name)) {
        return prev;
      }
      return [...prev, member];
    });
  }, []);

  const updateMember = useCallback((id: string, updates: Partial<TeamMember>) => {
    setMembers(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }, []);

  const deleteMember = useCallback((id: string) => {
    setMembers(prev => prev.filter(m => m.id !== id));
  }, []);

  const moveMember = useCallback((id: string, direction: 'up' | 'down') => {
    setMembers(prev => {
      const member = prev.find(m => m.id === id);
      if (!member) return prev;
      // Get members in the same group, sorted by order
      const groupMembers = prev
        .filter(m => m.group === member.group)
        .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
      const idx = groupMembers.findIndex(m => m.id === id);
      if (idx === -1) return prev;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= groupMembers.length) return prev;
      const swapMember = groupMembers[swapIdx];
      // Swap orders
      return prev.map(m => {
        if (m.id === member.id) return { ...m, order: swapMember.order ?? swapIdx };
        if (m.id === swapMember.id) return { ...m, order: member.order ?? idx };
        return m;
      });
    });
  }, []);

  const reorderMembers = useCallback((group: string, fromIdx: number, toIdx: number) => {
    setMembers(prev => {
      const groupMembers = prev
        .filter(m => m.group === group)
        .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));

      const updatedList = [...groupMembers];
      const [removed] = updatedList.splice(fromIdx, 1);
      updatedList.splice(toIdx, 0, removed);

      const updatedGroupMembers = updatedList.map((m, index) => ({
        ...m,
        order: index
      }));

      const otherGroupMembers = prev.filter(m => m.group !== group);
      return [...otherGroupMembers, ...updatedGroupMembers];
    });
  }, []);

  const clearPendingMembers = useCallback((minuteTitle?: string) => {
    if (minuteTitle) {
      setPendingMembers(prev => prev.filter(g => g.minuteTitle !== minuteTitle));
    } else {
      setPendingMembers([]);
    }
  }, []);

  const addPendingMembers = useCallback((minuteTitle: string, names: string[]) => {
    setPendingMembers(prev => {
      const existingIdx = prev.findIndex(g => g.minuteTitle === minuteTitle);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          names: Array.from(new Set([...updated[existingIdx].names, ...names]))
        };
        return updated;
      } else {
        return [...prev, { minuteTitle, names }];
      }
    });
  }, []);

  const addReport = useCallback((report: WeeklyReport) => {
    setReports(prev => [report, ...prev]);
  }, []);

  const updateReport = useCallback((id: string, updates: Partial<WeeklyReport>) => {
    setReports(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  }, []);

  const saveSettings = useCallback((newSettings: Record<string, string>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      Object.entries(newSettings).forEach(([key, val]) => {
        localStorage.setItem(key, val);
      });
      return updated;
    });
  }, []);

  return (
    <AppContext.Provider value={{ 
      tasks, minutes, projects, members, reports, llmLogs, batchStatus, pendingMembers,
      addTask, updateTask, commitTask, deleteTask, reorderTasks, addMinute, updateMinute,
      addProject, updateProject, deleteProject, moveProject,
      addMember, updateMember, deleteMember, moveMember, reorderMembers, addReport, updateReport, clearPendingMembers, addPendingMembers,
      settings, saveSettings
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
