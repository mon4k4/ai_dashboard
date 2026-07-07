import { useState, useEffect } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, FileText, FileBarChart, Settings, Bell, Check, FolderKanban, Users, ChevronDown, ChevronRight, X, FolderTree, RefreshCw, AlertTriangle, Network } from 'lucide-react';
import { useAppContext } from '../store/AppContext';
import LLMLogViewer from './LLMLogViewer';

export default function Layout() {
  const {
    tasks, projects, members, commitTask, updateTask, settings, deleteTask,
    commitTaskUpdate, rejectTaskUpdate,
    pendingProjectAssociations, removePendingProjectAssociation,
    updateMinute,
  } = useAppContext();
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [expandedUpdateId, setExpandedUpdateId] = useState<string | null>(null);
  const [associationProcessing, setAssociationProcessing] = useState<string | null>(null);
  
  // OSおよびコントラストモードの自動調整エフェクト
  useEffect(() => {
    const isWindows = typeof window !== 'undefined' && /Win/i.test(navigator.userAgent || navigator.platform);
    const mode = settings.colorContrastMode || 'auto';
    const shouldOptimize = mode === 'win' || (mode === 'auto' && isWindows);
    
    if (shouldOptimize) {
      document.documentElement.classList.add('ua-windows');
    } else {
      document.documentElement.classList.remove('ua-windows');
    }
  }, [settings.colorContrastMode]);

  const newTasks = tasks.filter(t => t.isNew);
  const pendingUpdateTasks = tasks.filter(t => t.pendingUpdates && Object.keys(t.pendingUpdates).length > 0);
  const totalNotifications = newTasks.length + pendingUpdateTasks.length + pendingProjectAssociations.length;

  // プロジェクト紐付けを実行
  const handleProjectAssociation = async (minuteId: string, projectId: string) => {
    setAssociationProcessing(minuteId);
    try {
      const llmEndpoint = settings.llmEndpoint || localStorage.getItem('llmEndpoint') || 'http://localhost:8080/v1';
      
      // 議事録のprojectIdを更新
      updateMinute(minuteId, { projectId });

      // スマートタスク抽出APIを呼び出し
      const res = await fetch('/api/batch/extract-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minuteId, projectId, llmEndpoint }),
      });
      const data = await res.json();
      if (data.success) {
        removePendingProjectAssociation(minuteId);
      }
    } catch (e) {
      console.error('Project association failed:', e);
    } finally {
      setAssociationProcessing(null);
    }
  };

  const navItems = [
    { path: '/kanban', label: 'Kanban', icon: <LayoutDashboard size={20} /> },
    { path: '/wbs', label: 'WBS', icon: <FolderTree size={20} /> },
    { path: '/relation', label: 'Relation', icon: <Network size={20} /> },
    { path: '/scheduler', label: 'Scheduler', icon: <CalendarDays size={20} /> },
    { path: '/projects', label: 'Projects', icon: <FolderKanban size={20} /> },
    { path: '/members', label: 'Members', icon: <Users size={20} /> },
    { path: '/minutes', label: 'Minutes', icon: <FileText size={20} /> },
    { path: '/report', label: 'Report', icon: <FileBarChart size={20} /> },
    { path: '/settings', label: 'Settings', icon: <Settings size={20} /> },
  ];

  return (
    <div style={styles.container}>
      {/* Sidebar */}
      <aside className="glass-panel" style={styles.sidebar}>
        <div style={styles.logoContainer}>
          <div style={styles.logoIcon}>AI</div>
          <h1 style={styles.logoText}>Dashboard</h1>
        </div>
        
        <nav style={styles.nav}>
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              style={({ isActive }) => ({
                ...styles.navItem,
                ...(isActive ? styles.navItemActive : {}),
              })}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        
        {/* 通知エリア */}
        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
          <button 
            style={styles.notificationBtn} 
            onClick={() => setIsNotificationOpen(!isNotificationOpen)}
          >
            <div style={{ position: 'relative' }}>
              <Bell size={20} />
              {totalNotifications > 0 && (
                <span style={styles.badge}>{totalNotifications}</span>
              )}
            </div>
            <span>通知・承認</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main style={styles.main}>
        <div className="glass-panel" style={styles.contentWrapper}>
          <Outlet />
        </div>

        {/* 通知ドロワー */}
        {isNotificationOpen && (
          <div style={styles.drawer}>
            <div style={styles.drawerHeader}>
              <h3>通知・承認</h3>
              <button style={styles.closeBtn} onClick={() => setIsNotificationOpen(false)}>×</button>
            </div>
            <div style={styles.drawerContent}>

              {/* ====== プロジェクト紐付け要求セクション ====== */}
              {pendingProjectAssociations.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={styles.sectionTitle}>
                    <AlertTriangle size={16} style={{ color: '#f59e0b' }} />
                    プロジェクト紐付け要求
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {pendingProjectAssociations.map(assoc => (
                      <div key={assoc.minuteId} className="card" style={{ padding: '1rem' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                          {assoc.title}
                        </div>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem', lineHeight: 1.4 }}>
                          この議事録のプロジェクトを自動判定できませんでした。紐付け先のプロジェクトを選択してください。
                        </p>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <select
                            id={`assoc-project-${assoc.minuteId}`}
                            style={{ flex: 1, padding: '0.4rem', fontSize: '0.85rem' }}
                            defaultValue=""
                          >
                            <option value="">-- プロジェクトを選択 --</option>
                            {projects.filter(p => !p.isClosed).map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                          <button
                            className="btn-primary"
                            disabled={associationProcessing === assoc.minuteId}
                            onClick={() => {
                              const select = document.getElementById(`assoc-project-${assoc.minuteId}`) as HTMLSelectElement;
                              const projectId = select?.value;
                              if (projectId) handleProjectAssociation(assoc.minuteId, projectId);
                            }}
                            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                          >
                            {associationProcessing === assoc.minuteId ? (
                              <><RefreshCw size={14} className="spin" /> 処理中...</>
                            ) : (
                              '抽出実行'
                            )}
                          </button>
                          <button
                            style={{ ...styles.dismissBtn }}
                            onClick={() => removePendingProjectAssociation(assoc.minuteId)}
                            title="スキップ"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ====== 既存タスクの更新提案セクション ====== */}
              {pendingUpdateTasks.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={styles.sectionTitle}>
                    <RefreshCw size={16} style={{ color: '#3b82f6' }} />
                    既存タスクの更新提案 ({pendingUpdateTasks.length}件)
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {pendingUpdateTasks.map(task => {
                      const isExpanded = expandedUpdateId === task.id;
                      const updates = task.pendingUpdates || {};
                      return (
                        <div key={task.id} className="card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <div 
                            style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '0.5rem' }}
                            onClick={() => setExpandedUpdateId(isExpanded ? null : task.id)}
                          >
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            <span style={{ fontWeight: 'bold', flex: 1 }}>{task.title}</span>
                            <span style={{
                              padding: '0.15rem 0.5rem',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              fontWeight: 'bold',
                              background: 'rgba(59, 130, 246, 0.15)',
                              color: '#3b82f6',
                            }}>更新提案</span>
                          </div>

                          {isExpanded && (
                            <div style={{ paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                              {/* 対応結果の差分 */}
                              {updates.actionResult && (
                                <div>
                                  <label style={styles.diffLabel}>対応結果 (新規追加):</label>
                                  <div style={styles.diffNew}>
                                    <textarea
                                      defaultValue={updates.actionResult}
                                      onChange={(e) => {
                                        task.pendingUpdates = { ...task.pendingUpdates, actionResult: e.target.value };
                                      }}
                                      style={{ width: '100%', padding: '0.5rem', fontSize: '0.8rem', minHeight: '60px', resize: 'vertical', background: 'transparent', border: 'none', color: 'inherit' }}
                                    />
                                  </div>
                                </div>
                              )}

                              {/* 詳細の差分 */}
                              {updates.details && (
                                <div>
                                  <label style={styles.diffLabel}>詳細 (更新後):</label>
                                  {task.details && (
                                    <div style={styles.diffOld}>
                                      <span style={{ fontSize: '0.75rem', color: 'rgba(239, 68, 68, 0.7)' }}>現在:</span>
                                      <div style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>{task.details}</div>
                                    </div>
                                  )}
                                  <div style={styles.diffNew}>
                                    <span style={{ fontSize: '0.75rem', color: 'rgba(34, 197, 94, 0.7)' }}>提案:</span>
                                    <textarea
                                      defaultValue={updates.details}
                                      onChange={(e) => {
                                        task.pendingUpdates = { ...task.pendingUpdates, details: e.target.value };
                                      }}
                                      style={{ width: '100%', padding: '0.5rem', fontSize: '0.8rem', minHeight: '50px', resize: 'vertical', background: 'transparent', border: 'none', color: 'inherit' }}
                                    />
                                  </div>
                                </div>
                              )}

                              {/* ステータスと進捗 */}
                              <div style={{ display: 'flex', gap: '1rem' }}>
                                {updates.status && (
                                  <div style={{ flex: 1 }}>
                                    <label style={styles.diffLabel}>ステータス:</label>
                                    <div style={{ fontSize: '0.85rem' }}>
                                      <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{task.status}</span>
                                      {' → '}
                                      <span style={{ fontWeight: 'bold', color: updates.status === 'done' ? '#22c55e' : updates.status === 'in-progress' ? '#f59e0b' : 'var(--text-primary)' }}>
                                        {updates.status}
                                      </span>
                                    </div>
                                  </div>
                                )}
                                {updates.progress !== undefined && (
                                  <div style={{ flex: 1 }}>
                                    <label style={styles.diffLabel}>進捗率:</label>
                                    <div style={{ fontSize: '0.85rem' }}>
                                      <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{task.progress ?? 0}%</span>
                                      {' → '}
                                      <span style={{ fontWeight: 'bold' }}>{updates.progress}%</span>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* 承認/却下 */}
                              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <button
                                  className="btn-danger-outline"
                                  onClick={() => rejectTaskUpdate(task.id)}
                                  style={styles.rejectBtn}
                                >
                                  <X size={14} /> 却下
                                </button>
                                <button
                                  className="btn-primary"
                                  onClick={() => commitTaskUpdate(task.id)}
                                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                                >
                                  <Check size={14} /> 承認
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ====== 新規タスク承認セクション ====== */}
              <div>
                <h4 style={styles.sectionTitle}>新規タスクの確認 ({newTasks.length}件)</h4>
                {newTasks.length === 0 && pendingUpdateTasks.length === 0 && pendingProjectAssociations.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>通知はありません。</p>
                ) : newTasks.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>新しいタスクはありません。</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {newTasks.map(task => {
                      const isExpanded = expandedTaskId === task.id;
                      const selectedProject = projects.find(p => p.id === task.projectId);
                      const projectStakeholders = selectedProject?.stakeholders || [];
                      const filteredMembers = (task.projectId && projectStakeholders.length > 0)
                        ? members.filter(m => projectStakeholders.includes(m.id))
                        : members;
                      const displayMembers = [...filteredMembers];
                      if (task.memberId && !displayMembers.some(m => m.id === task.memberId)) {
                        const currentMember = members.find(m => m.id === task.memberId);
                        if (currentMember) {
                          displayMembers.push(currentMember);
                        }
                      }
                      return (
                        <div key={task.id} className="card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <div 
                            style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '0.5rem' }}
                            onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                          >
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            <input 
                              value={task.title}
                              onChange={(e) => updateTask(task.id, { title: e.target.value })}
                              onClick={(e) => e.stopPropagation()}
                              style={{ fontWeight: 'bold', background: 'transparent', border: '1px dashed transparent', padding: '0.2rem', flex: 1 }}
                              title="クリックして編集"
                            />
                          </div>
                          
                          {isExpanded && (
                            <div style={{ paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                              <div>
                                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>詳細情報:</label>
                                <textarea
                                  value={task.details || ''}
                                  onChange={(e) => updateTask(task.id, { details: e.target.value })}
                                  style={{ width: '100%', padding: '0.5rem', fontSize: '0.85rem', minHeight: '60px', resize: 'vertical' }}
                                />
                              </div>
                              
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <div style={{ display: 'flex', gap: '1rem' }}>
                                  <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>プロジェクト:</label>
                                    <select 
                                      value={task.projectId || ''} 
                                      onChange={(e) => updateTask(task.id, { projectId: e.target.value })}
                                      style={{ width: '100%', padding: '0.25rem', fontSize: '0.85rem' }}
                                    >
                                      <option value="">-- 未設定 --</option>
                                      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                    </select>
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>担当者:</label>
                                    <select 
                                      value={task.memberId || ''} 
                                      onChange={(e) => updateTask(task.id, { memberId: e.target.value })}
                                      style={{ width: '100%', padding: '0.25rem', fontSize: '0.85rem' }}
                                    >
                                      <option value="">-- 未割り当て (推奨: {task.assignee}) --</option>
                                      {displayMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                    </select>
                                  </div>
                                </div>

                                <div style={{ display: 'flex', gap: '1rem' }}>
                                  <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>親グループ:</label>
                                    <select 
                                      value={task.parentId || ''} 
                                      onChange={(e) => updateTask(task.id, { parentId: e.target.value })}
                                      style={{ width: '100%', padding: '0.25rem', fontSize: '0.85rem' }}
                                    >
                                      <option value="">-- 親グループなし --</option>
                                      {tasks.filter(t => t.projectId === task.projectId && t.isGroup && !t.isNew).map(g => (
                                        <option key={g.id} value={g.id}>{g.title}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>関連タスク (エッジ):</label>
                                    <select 
                                      multiple
                                      value={task.dependencies || []} 
                                      onChange={(e) => {
                                        const selected = Array.from(e.target.selectedOptions, option => option.value);
                                        updateTask(task.id, { dependencies: selected });
                                      }}
                                      style={{ width: '100%', padding: '0.25rem', fontSize: '0.85rem', height: '60px' }}
                                      title="複数選択可 (Ctrl/Cmdキーを押しながらクリック)"
                                    >
                                      {tasks.filter(t => t.projectId === task.projectId && !t.isGroup && !t.isNew && t.id !== task.id).map(t => (
                                        <option key={t.id} value={t.id}>{t.title}</option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                          
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                            <button 
                              className="btn-danger-outline"
                              onClick={() => {
                                if (window.confirm('このタスクを却下して削除してもよろしいですか？')) {
                                  deleteTask(task.id);
                                }
                              }} 
                              style={styles.rejectBtn}
                              onMouseEnter={e => {
                                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                              }}
                              onMouseLeave={e => {
                                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                              }}
                            >
                              <X size={14} />
                              却下
                            </button>
                            <button className="btn-primary" onClick={() => commitTask(task.id)} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                              <Check size={14} />
                              承認して追加
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* LLM詳細ログビューア */}
        <LLMLogViewer />
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    height: '100vh',
    padding: '1rem',
    gap: '1rem',
  },
  sidebar: {
    width: '260px',
    display: 'flex',
    flexDirection: 'column',
    padding: '1.5rem',
  },
  logoContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    marginBottom: '2rem',
  },
  logoIcon: {
    background: 'var(--accent-gradient)',
    color: 'white',
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    fontSize: '1.2rem',
  },
  logoText: {
    fontSize: '1.25rem',
    margin: 0,
    background: 'var(--accent-gradient)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 1rem',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-secondary)',
    transition: 'all 0.2s ease',
  },
  navItemActive: {
    background: 'rgba(99, 102, 241, 0.15)',
    color: 'var(--accent-primary)',
    fontWeight: '500',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  contentWrapper: {
    flex: 1,
    overflow: 'auto',
    padding: '2rem',
    display: 'flex',
    flexDirection: 'column',
  },
  notificationBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 1rem',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)',
    background: 'rgba(255, 255, 255, 0.05)',
    width: '100%',
    transition: 'all 0.2s ease',
  },
  badge: {
    position: 'absolute',
    top: '-5px',
    right: '-5px',
    background: '#ef4444',
    color: 'white',
    fontSize: '0.7rem',
    fontWeight: 'bold',
    minWidth: '16px',
    height: '16px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 4px',
  },
  drawer: {
    position: 'absolute',
    top: '1rem',
    right: '1rem',
    bottom: '1rem',
    width: '440px',
    background: 'var(--bg-main)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-card)',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 100,
    overflow: 'hidden',
  },
  drawerHeader: {
    padding: '1rem 1.5rem',
    borderBottom: '1px solid var(--border-color)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  drawerContent: {
    padding: '1.5rem',
    overflowY: 'auto',
    flex: 1,
  },
  closeBtn: {
    background: 'transparent',
    color: 'var(--text-muted)',
    fontSize: '1.5rem',
    padding: '0 0.5rem',
  },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.95rem',
    fontWeight: 'bold',
    marginBottom: '0.75rem',
    color: 'var(--text-primary)',
  },
  diffLabel: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    display: 'block',
    marginBottom: '0.25rem',
  },
  diffOld: {
    padding: '0.5rem',
    borderRadius: '4px',
    background: 'rgba(239, 68, 68, 0.05)',
    border: '1px solid rgba(239, 68, 68, 0.15)',
    marginBottom: '0.25rem',
  },
  diffNew: {
    padding: '0.5rem',
    borderRadius: '4px',
    background: 'rgba(34, 197, 94, 0.05)',
    border: '1px solid rgba(34, 197, 94, 0.15)',
  },
  rejectBtn: {
    padding: '0.4rem 0.8rem',
    fontSize: '0.85rem',
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    color: '#ef4444',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
    transition: 'all 0.2s ease',
  },
  dismissBtn: {
    background: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    padding: '0.4rem',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
  },
};
