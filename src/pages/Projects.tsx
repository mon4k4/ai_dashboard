import { useState, useMemo } from 'react';
import { FolderKanban, Plus, Trash2, Calendar, Clock, Edit2, Save, X, Sparkles, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useAppContext } from '../store/AppContext';
import { generateProjectStatus } from '../services/llmService';
import type { Project } from '../services/llmService';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

const generateColors = () => [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'
];

export default function Projects() {
  const { projects, addProject, updateProject, deleteProject, tasks, minutes } = useAppContext();
  
  const [isGenerating, setIsGenerating] = useState<Record<string, boolean>>({});
  const [expandedAIStatus, setExpandedAIStatus] = useState<Record<string, boolean>>({});

  const toggleAIStatus = (projectId: string) => {
    setExpandedAIStatus(prev => ({
      ...prev,
      [projectId]: !prev[projectId]
    }));
  };

  const handleGenerateAIStatus = async (project: Project) => {
    setIsGenerating(prev => ({ ...prev, [project.id]: true }));
    try {
      const projTasks = tasks.filter(t => t.projectId === project.id);
      const projMinutes = minutes.filter(m => m.projectId === project.id);
      
      const result = await generateProjectStatus(project, projMinutes, projTasks);
      updateProject(project.id, { aiStatusSummary: result });
    } catch (err: any) {
      alert('AI生成に失敗しました: ' + (err.message || err));
    } finally {
      setIsGenerating(prev => ({ ...prev, [project.id]: false }));
    }
  };
  
  // New Project Form State
  const [newName, setNewName] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [newStartDate, setNewStartDate] = useState('');
  const [newEndDate, setNewEndDate] = useState('');
  const [newClient, setNewClient] = useState('');
  const [newOrder, setNewOrder] = useState('');

  const getMonthsBetween = (start: string, end: string) => {
    if (!start || !end) return [];
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || startDate > endDate) return [];

    const months = [];
    let current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const endBound = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

    while (current <= endBound) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      months.push(`${year}-${month}`);
      current.setMonth(current.getMonth() + 1);
    }
    return months;
  };

  const handleAdd = () => {
    if (!newName.trim() || !newStartDate || !newEndDate) {
      alert('プロジェクト名、開始日、終了日は必須です。');
      return;
    }
    
    const colors = generateColors();
    const randomColor = colors[projects.length % colors.length];

    addProject({
      id: `proj-${Date.now()}`,
      name: newName.trim(),
      summary: newSummary.trim(),
      startDate: newStartDate,
      endDate: newEndDate,
      client: newClient.trim(),
      orderName: newOrder.trim(),
      color: randomColor,
      workload: {}
    });

    setNewName('');
    setNewSummary('');
    setNewStartDate('');
    setNewEndDate('');
    setNewClient('');
    setNewOrder('');
  };

  const { allMonths, totalWorkloadPerMonth } = useMemo(() => {
    const monthSet = new Set<string>();
    const totals: Record<string, number> = {};
    
    projects.forEach(p => {
      const pMonths = new Set([
        ...getMonthsBetween(p.startDate, p.endDate),
        ...Object.keys(p.workload || {})
      ]);
      pMonths.forEach(m => {
        monthSet.add(m);
        totals[m] = (totals[m] || 0) + (p.workload[m] || 0);
      });
    });

    const sortedMonths = Array.from(monthSet).sort();
    return { allMonths: sortedMonths, totalWorkloadPerMonth: totals };
  }, [projects]);

  const baseWorkload = parseInt(localStorage.getItem('monthlyWorkload') || '155');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1.5rem', overflowY: 'auto' }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, flexShrink: 0 }}>
        <FolderKanban size={24} color="var(--accent-primary)" />
        Projects
      </h2>

      {/* 月別 全体稼働率 */}
      {allMonths.length > 0 && (
        <div className="card" style={{ padding: '1.5rem', flexShrink: 0 }}>
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Calendar size={20} color="var(--accent-primary)" />
            月別 合計稼働率 (基準: {baseWorkload}h/月)
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.workloadTable}>
              <thead>
                <tr>
                  {allMonths.map(m => (
                    <th key={m} style={styles.workloadTh}>{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {allMonths.map(m => {
                    const hours = totalWorkloadPerMonth[m] || 0;
                    const rate = ((hours / baseWorkload) * 100).toFixed(1);
                    const isOver = hours > baseWorkload;
                    return (
                      <td key={m} style={{ ...styles.workloadTd, textAlign: 'center', padding: '0.75rem', background: isOver ? 'rgba(239, 68, 68, 0.1)' : 'transparent' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: isOver ? '#ef4444' : 'var(--text-primary)' }}>
                          {rate}%
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {hours}h
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 新規プロジェクト追加フォーム */}
      <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', flexShrink: 0 }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>新規プロジェクト作成</h3>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={styles.label}>プロジェクト名 *</label>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} style={styles.input} />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label style={styles.label}>取引先</label>
            <input type="text" value={newClient} onChange={e => setNewClient(e.target.value)} style={styles.input} />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label style={styles.label}>オーダ名</label>
            <input type="text" value={newOrder} onChange={e => setNewOrder(e.target.value)} style={styles.input} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>概要</label>
            <input type="text" value={newSummary} onChange={e => setNewSummary(e.target.value)} style={styles.input} />
          </div>
          <div style={{ width: '150px' }}>
            <label style={styles.label}>開始日 *</label>
            <input type="date" value={newStartDate} onChange={e => setNewStartDate(e.target.value)} style={styles.input} />
          </div>
          <div style={{ width: '150px' }}>
            <label style={styles.label}>終了日 *</label>
            <input type="date" value={newEndDate} onChange={e => setNewEndDate(e.target.value)} style={styles.input} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn-primary" onClick={handleAdd} style={{ height: '42px' }}>
              <Plus size={18} /> 追加
            </button>
          </div>
        </div>
      </div>

      {/* プロジェクト一覧 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {projects.length === 0 ? (
          <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            プロジェクトがありません。
          </div>
        ) : (
          projects.map(project => {
            const months = getMonthsBetween(project.startDate, project.endDate);
            
            return (
              <div key={project.id} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', borderLeft: `4px solid ${project.color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <input 
                        value={project.name}
                        onChange={e => updateProject(project.id, { name: e.target.value })}
                        style={{ ...styles.ghostInput, fontSize: '1.25rem', fontWeight: 'bold', padding: '0.2rem' }}
                      />
                      <input 
                        type="color" 
                        value={project.color}
                        onChange={e => updateProject(project.id, { color: e.target.value })}
                        style={{ width: '30px', height: '30px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent' }}
                        title="プロジェクトカラー"
                      />
                    </div>
                    <input 
                      value={project.summary}
                      placeholder="概要"
                      onChange={e => updateProject(project.id, { summary: e.target.value })}
                      style={{ ...styles.ghostInput, color: 'var(--text-muted)' }}
                    />
                  </div>
                  <button onClick={() => deleteProject(project.id)} style={styles.iconBtn} title="削除">
                    <Trash2 size={18} />
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '1rem', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>取引先</label>
                    <input value={project.client} onChange={e => updateProject(project.id, { client: e.target.value })} style={styles.ghostInput} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>オーダ名</label>
                    <input value={project.orderName} onChange={e => updateProject(project.id, { orderName: e.target.value })} style={styles.ghostInput} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>開始日</label>
                    <input type="date" value={project.startDate} onChange={e => updateProject(project.id, { startDate: e.target.value })} style={styles.ghostInput} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>終了日</label>
                    <input type="date" value={project.endDate} onChange={e => updateProject(project.id, { endDate: e.target.value })} style={styles.ghostInput} />
                  </div>
                </div>

                {/* 割り当て工数テーブル */}
                <div>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>月別割り当て工数 (時間)</h4>
                  {months.length === 0 ? (
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>開始日と終了日を正しく設定してください。</span>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={styles.workloadTable}>
                        <thead>
                          <tr>
                            {months.map(m => (
                              <th key={m} style={styles.workloadTh}>{m}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            {months.map(m => (
                              <td key={m} style={styles.workloadTd}>
                                <input 
                                  type="number"
                                  min="0"
                                  value={project.workload[m] || ''}
                                  onChange={e => {
                                    const val = parseInt(e.target.value) || 0;
                                    updateProject(project.id, { workload: { ...project.workload, [m]: val } });
                                  }}
                                  style={styles.workloadInput}
                                  placeholder="0"
                                />
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <ProjectMeetingManager project={project} updateProject={updateProject} />

                {/* AI状況と概要 */}
                <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h4 
                      onClick={() => toggleAIStatus(project.id)}
                      style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}
                    >
                      <Sparkles size={18} color="var(--accent-primary)" />
                      AI生成 状況・詳細概要
                      {expandedAIStatus[project.id] !== false ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
                    </h4>
                    <button 
                      className="btn-primary" 
                      onClick={() => handleGenerateAIStatus(project)} 
                      disabled={isGenerating[project.id]}
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                      {isGenerating[project.id] ? (
                        <>
                          <Loader2 size={14} className="spin" />
                          生成中...
                        </>
                      ) : (
                        <>
                          <Sparkles size={14} />
                          最新状況を生成
                        </>
                      )}
                    </button>
                  </div>

                  {expandedAIStatus[project.id] === false && project.aiStatusSummary && (
                    <div 
                      onClick={() => toggleAIStatus(project.id)}
                      style={{ fontSize: '0.85rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                        {project.aiStatusSummary.replace(/[#*`\n]/g, ' ').substring(0, 60)}...
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', fontWeight: 500 }}>クリックで展開</span>
                    </div>
                  )}

                  {expandedAIStatus[project.id] !== false && (
                    <>
                      {project.aiStatusSummary ? (
                        <div className="card" style={{ background: 'rgba(99, 102, 241, 0.03)', border: '1px solid rgba(99, 102, 241, 0.15)', padding: '1.25rem' }}>
                          <MarkdownRenderer content={project.aiStatusSummary} />
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.01)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border-color)', textAlign: 'center' }}>
                          このプロジェクトに紐づく議事録やタスク情報から、AI状況と詳細概要を自動生成できます。
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const styles = {
  label: {
    display: 'block',
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
    marginBottom: '0.5rem',
  },
  input: {
    width: '100%',
    padding: '0.75rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
  },
  ghostInput: {
    width: '100%',
    padding: '0.2rem 0.5rem',
    background: 'transparent',
    border: '1px dashed transparent',
    color: 'var(--text-primary)',
    transition: 'all 0.2s',
    borderRadius: '4px',
  },
  iconBtn: {
    background: 'transparent',
    color: '#ef4444',
    padding: '0.5rem',
    borderRadius: '4px',
    cursor: 'pointer',
    border: 'none',
  },
  workloadTable: {
    borderCollapse: 'collapse' as const,
    width: '100%',
  },
  workloadTh: {
    background: 'rgba(0,0,0,0.3)',
    padding: '0.5rem',
    fontSize: '0.8rem',
    fontWeight: 500,
    border: '1px solid var(--border-color)',
    textAlign: 'center' as const,
    minWidth: '80px',
  },
  workloadTd: {
    padding: '0',
    border: '1px solid var(--border-color)',
  },
  workloadInput: {
    width: '100%',
    height: '100%',
    padding: '0.5rem',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-primary)',
    textAlign: 'center' as const,
    fontSize: '0.9rem',
  }
};

function ProjectMeetingManager({ project, updateProject }: { project: Project, updateProject: (id: string, updates: Partial<Project>) => void }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const meetings = project.meetings || [];
  
  const [title, setTitle] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [date, setDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState<number>(1);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  const addOneHour = (timeStr: string) => {
    if (!timeStr) return '';
    const [hourStr, minStr] = timeStr.split(':');
    let hour = parseInt(hourStr, 10);
    let min = parseInt(minStr, 10);
    hour = (hour + 1) % 24;
    const newHourStr = String(hour).padStart(2, '0');
    const newMinStr = String(min).padStart(2, '0');
    return `${newHourStr}:${newMinStr}`;
  };

  const handleStartTimeChange = (val: string) => {
    setStartTime(val);
    if (val) {
      setEndTime(addOneHour(val));
    }
  };

  const resetForm = () => {
    setTitle(''); setIsRecurring(false); setDate(''); setStartDate(''); setEndDate(''); setDayOfWeek(1); setStartTime(''); setEndTime('');
    setIsAdding(false); setEditingId(null);
  };

  const handleSave = () => {
    if (!title.trim()) return;
    
    const newMeeting = {
      id: editingId || `meet-${Date.now()}`,
      title: title.trim(),
      isRecurring,
      date: !isRecurring ? date : undefined,
      startDate: isRecurring ? startDate : undefined,
      endDate: isRecurring ? endDate : undefined,
      dayOfWeek: isRecurring ? dayOfWeek : undefined,
      startTime,
      endTime,
      time: startTime // 互換性のため
    };

    let newMeetings;
    if (editingId) {
      const existing = meetings.find(m => m.id === editingId);
      const exceptions = existing ? existing.exceptions : undefined;
      newMeetings = meetings.map(m => m.id === editingId ? { ...newMeeting, exceptions } : m);
    } else {
      newMeetings = [...meetings, newMeeting];
    }
    
    updateProject(project.id, { meetings: newMeetings });
    resetForm();
  };

  const handleEdit = (m: any) => {
    setTitle(m.title);
    setIsRecurring(m.isRecurring);
    setDate(m.date || '');
    setStartDate(m.startDate || '');
    setEndDate(m.endDate || '');
    setDayOfWeek(m.dayOfWeek ?? 1);
    setStartTime(m.startTime || m.time || '');
    setEndTime(m.endTime || (m.time ? addOneHour(m.time) : ''));
    setEditingId(m.id);
    setIsAdding(true);
  };

  const handleDelete = (id: string) => {
    updateProject(project.id, { meetings: meetings.filter(m => m.id !== id) });
  };

  const daysStr = ['日', '月', '火', '水', '木', '金', '土'];

  return (
    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
      <div 
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', cursor: 'pointer' }}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          <Clock size={16} /> 打ち合わせ管理
        </h4>
        {!isAdding && !isCollapsed && (
          <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); setIsAdding(true); }} style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Plus size={14} /> 追加
          </button>
        )}
      </div>

      {!isCollapsed && (
        <>
          {isAdding && (
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '150px' }}>
                  <label style={styles.label}>タイトル *</label>
                  <input type="text" value={title} onChange={e => setTitle(e.target.value)} style={styles.input} placeholder="例: 開発定例" />
                </div>
                <div style={{ width: '120px' }}>
                  <label style={styles.label}>種類</label>
                  <select 
                    value={isRecurring ? 'recurring' : 'single'} 
                    onChange={e => {
                      const val = e.target.value === 'recurring';
                      setIsRecurring(val);
                      if (val) {
                        if (!startDate) setStartDate(project.startDate || '');
                        if (!endDate) setEndDate(project.endDate || '');
                      }
                    }} 
                    style={styles.input}
                  >
                    <option value="single">単発</option>
                    <option value="recurring">定期 (毎週)</option>
                  </select>
                </div>
                {isRecurring ? (
                  <>
                    <div style={{ width: '100px' }}>
                      <label style={styles.label}>曜日</label>
                      <select value={dayOfWeek} onChange={e => setDayOfWeek(Number(e.target.value))} style={styles.input}>
                        {daysStr.map((d, i) => <option key={i} value={i}>{d}曜</option>)}
                      </select>
                    </div>
                    <div style={{ width: '135px' }}>
                      <label style={styles.label}>開始日</label>
                      <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={styles.input} />
                    </div>
                    <div style={{ width: '135px' }}>
                      <label style={styles.label}>終了日</label>
                      <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={styles.input} />
                    </div>
                  </>
                ) : (
                  <div style={{ width: '140px' }}>
                    <label style={styles.label}>日付</label>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} style={styles.input} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', width: '220px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>開始時間</label>
                    <input type="time" value={startTime} onChange={e => handleStartTimeChange(e.target.value)} style={styles.input} />
                  </div>
                  <span style={{ marginTop: '1.2rem', color: 'var(--text-muted)' }}>〜</span>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>終了時間</label>
                    <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} style={styles.input} />
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button className="btn-secondary" onClick={resetForm} style={{ padding: '0.25rem 0.75rem' }}><X size={14} /> キャンセル</button>
                <button className="btn-primary" onClick={handleSave} disabled={!title.trim()} style={{ padding: '0.25rem 0.75rem' }}><Save size={14} /> 保存</button>
              </div>
            </div>
          )}

          {meetings.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {meetings.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', padding: '0.5rem 0.75rem', borderRadius: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span style={{ fontWeight: 500 }}>{m.title}</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {m.isRecurring ? `毎週${daysStr[m.dayOfWeek!]}曜${(m.startDate || m.endDate) ? ` (${m.startDate || ''} 〜 ${m.endDate || ''})` : ''}` : m.date}
                      {' '}
                      {m.startTime || m.time}
                      {m.endTime && ` 〜 ${m.endTime}`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => handleEdit(m)} style={{ ...styles.iconBtn, color: 'var(--text-muted)', padding: '0.25rem' }} title="編集"><Edit2 size={16} /></button>
                    <button onClick={() => handleDelete(m.id)} style={{ ...styles.iconBtn, padding: '0.25rem' }} title="削除"><Trash2 size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            !isAdding && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>打ち合わせは登録されていません。</div>
          )}
        </>
      )}
    </div>
  );
}
