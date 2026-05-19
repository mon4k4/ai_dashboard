import { X } from 'lucide-react';
import { useAppContext } from '../store/AppContext';

interface TaskEditModalProps {
  taskId: string;
  onClose: () => void;
}

export default function TaskEditModal({ taskId, onClose }: TaskEditModalProps) {
  const { tasks, projects, members, updateTask, deleteTask } = useAppContext();
  
  const task = tasks.find(t => t.id === taskId);
  if (!task) return null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={{ margin: 0 }}>タスク詳細編集</h3>
          <button style={styles.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>

        <div style={styles.body}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={styles.label}>タスク名</label>
            <input 
              value={task.title} 
              onChange={e => updateTask(task.id, { title: e.target.value })}
              style={styles.input}
            />
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={styles.label}>ステータス</label>
              <select 
                value={task.status} 
                onChange={e => updateTask(task.id, { status: e.target.value as any })}
                style={styles.input}
              >
                <option value="todo">To Do</option>
                <option value="in-progress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </div>
            
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={styles.label}>進捗率 (%)</label>
              <input 
                type="number"
                min="0"
                max="100"
                value={task.progress || (task.status === 'done' ? 100 : task.status === 'in-progress' ? 50 : 0)} 
                onChange={e => updateTask(task.id, { progress: parseInt(e.target.value) || 0 })}
                style={styles.input}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={styles.label}>プロジェクト</label>
              <select 
                value={task.projectId || ''} 
                onChange={e => updateTask(task.id, { projectId: e.target.value })}
                style={styles.input}
              >
                <option value="">-- 未設定 --</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={styles.label}>担当者</label>
              <select 
                value={task.memberId || ''} 
                onChange={e => updateTask(task.id, { 
                  memberId: e.target.value,
                  assignee: members.find(m => m.id === e.target.value)?.name || task.assignee
                })}
                style={styles.input}
              >
                <option value="">-- 未設定 ({task.assignee}) --</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={styles.label}>開始日</label>
              <input 
                type="date"
                value={task.startDate || ''} 
                onChange={e => updateTask(task.id, { startDate: e.target.value })}
                style={styles.input}
              />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={styles.label}>期日 (終了日)</label>
              <input 
                type="date"
                value={task.dueDate || ''} 
                onChange={e => updateTask(task.id, { dueDate: e.target.value })}
                style={styles.input}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={styles.label}>詳細情報</label>
            <textarea 
              value={task.details || ''} 
              onChange={e => updateTask(task.id, { details: e.target.value })}
              style={{ ...styles.input, minHeight: '100px', resize: 'vertical' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(4px)',
  },
  modal: {
    background: 'var(--bg-main)',
    width: '90%',
    maxWidth: '500px',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-lg)',
    display: 'flex',
    flexDirection: 'column' as const,
    maxHeight: '90vh',
  },
  header: {
    padding: '1.25rem 1.5rem',
    borderBottom: '1px solid var(--border-color)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '0.2rem',
  },
  body: {
    padding: '1.5rem',
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1.25rem',
  },
  label: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    fontWeight: 500,
  },
  input: {
    width: '100%',
    padding: '0.75rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    fontSize: '0.9rem',
  }
};
