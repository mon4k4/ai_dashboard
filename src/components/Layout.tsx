import { useState, useEffect } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, FileText, FileBarChart, Settings, Bell, Check, FolderKanban, Users, ChevronDown, ChevronRight, X, FolderTree } from 'lucide-react';
import { useAppContext } from '../store/AppContext';
import LLMLogViewer from './LLMLogViewer';

export default function Layout() {
  const { tasks, projects, members, commitTask, updateTask, settings, deleteTask } = useAppContext();
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  
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

  const navItems = [
    { path: '/kanban', label: 'Kanban', icon: <LayoutDashboard size={20} /> },
    { path: '/wbs', label: 'WBS', icon: <FolderTree size={20} /> },
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
              {newTasks.length > 0 && (
                <span style={styles.badge}>{newTasks.length}</span>
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
              <h3>新規タスクの確認</h3>
              <button style={styles.closeBtn} onClick={() => setIsNotificationOpen(false)}>×</button>
            </div>
            <div style={styles.drawerContent}>
              {newTasks.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>新しいタスクはありません。</p>
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
                            style={{ 
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
                              transition: 'all 0.2s ease'
                            }}
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
        )}
        
        {/* LLM詳細ログビューア */}
        <LLMLogViewer />
      </main>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    height: '100vh',
    padding: '1rem',
    gap: '1rem',
  },
  sidebar: {
    width: '260px',
    display: 'flex',
    flexDirection: 'column' as const,
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
    flexDirection: 'column' as const,
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
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  contentWrapper: {
    flex: 1,
    overflow: 'auto',
    padding: '2rem',
    display: 'flex',
    flexDirection: 'column' as const,
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
    position: 'absolute' as const,
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
    position: 'absolute' as const,
    top: '1rem',
    right: '1rem',
    bottom: '1rem',
    width: '400px',
    background: 'var(--bg-main)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-card)',
    display: 'flex',
    flexDirection: 'column' as const,
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
    overflowY: 'auto' as const,
    flex: 1,
  },
  closeBtn: {
    background: 'transparent',
    color: 'var(--text-muted)',
    fontSize: '1.5rem',
    padding: '0 0.5rem',
  }
};
