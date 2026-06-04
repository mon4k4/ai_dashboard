import { useState, useEffect } from 'react';
import { X, ArrowRight, CornerDownRight, Trash2, Calendar, FileText, Eye, Edit3, Image as ImageIcon } from 'lucide-react';
import { useAppContext } from '../store/AppContext';
import { MarkdownRenderer } from './MarkdownRenderer';

interface TaskEditModalProps {
  taskId: string;
  onClose: () => void;
}

export default function TaskEditModal({ taskId, onClose }: TaskEditModalProps) {
  const { tasks, projects, members, updateTask, addTask, deleteTask, minutes } = useAppContext();
  const [activeTaskId, setActiveTaskId] = useState(taskId);
  const [previewDetails, setPreviewDetails] = useState(false);
  const [previewResult, setPreviewResult] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    setActiveTaskId(taskId);
  }, [taskId]);
  
  const task = tasks.find(t => t.id === activeTaskId);

  const originatingMinute = task
    ? (minutes || []).find(m => m.extractedTasks && m.extractedTasks.some(t => t.id === task.id))
    : undefined;
  if (!task) return null;

  const projectTasks = tasks.filter(t => t.projectId === task.projectId);

  // プロジェクト関係者による担当者フィルタリング
  const selectedProject = projects.find(p => p.id === task.projectId);
  const projectStakeholders = selectedProject?.stakeholders || [];
  const filteredMembers = (task.projectId && projectStakeholders.length > 0)
    ? members.filter(m => projectStakeholders.includes(m.id))
    : members;

  // 現在アサインされているメンバーは常に選択肢に含める
  const displayMembers = [...filteredMembers];
  if (task.memberId && !displayMembers.some(m => m.id === task.memberId)) {
    const currentMember = members.find(m => m.id === task.memberId);
    if (currentMember) {
      displayMembers.push(currentMember);
    }
  }

  // 循環参照を防ぐための親候補フィルタリング
  const getValidParentOptions = () => {
    const descendants = new Set<string>();
    const findDescendants = (pid: string) => {
      projectTasks.forEach(t => {
        if (t.parentId === pid) {
          descendants.add(t.id);
          findDescendants(t.id);
        }
      });
    };
    findDescendants(task.id);
    return projectTasks.filter(t => 
      t.id !== task.id && 
      !descendants.has(t.id)
    );
  };

  const childTasks = tasks.filter(t => t.parentId === task.id);

  const getStatusColorBg = (status: string) => {
    switch (status) {
      case 'todo': return 'rgba(239, 68, 68, 0.1)';
      case 'in-progress': return 'rgba(59, 130, 246, 0.1)';
      case 'done': return 'rgba(16, 185, 129, 0.1)';
      default: return 'rgba(255, 255, 255, 0.1)';
    }
  };

  const getStatusColorText = (status: string) => {
    switch (status) {
      case 'todo': return '#ef4444';
      case 'in-progress': return '#3b82f6';
      case 'done': return '#10b981';
      default: return 'var(--text-muted)';
    }
  };

  const handlePasteImage = async (e: React.ClipboardEvent<HTMLTextAreaElement>, field: 'details' | 'actionResult') => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (!file) continue;

        setIsUploading(true);
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const base64 = event.target?.result as string;
            const res = await fetch('/api/image/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageBase64: base64, mimeType: file.type })
            });
            const data = await res.json();
            if (data.success) {
              const imageTag = `\n![画像](${data.url})\n`;
              const currentVal = task![field] || '';
              
              // 簡易的にカーソル位置ではなく末尾に追記するか、全体のテキストを更新する
              // ここではシンプルに現在のテキストに追記する
              const el = e.target as HTMLTextAreaElement;
              const start = el.selectionStart;
              const end = el.selectionEnd;
              const newVal = currentVal.substring(0, start) + imageTag + currentVal.substring(end);
              
              updateTask(task!.id, { [field]: newVal });
            } else {
              alert('画像のアップロードに失敗しました: ' + data.error);
            }
          } catch (err) {
            alert('画像のアップロードに失敗しました');
          } finally {
            setIsUploading(false);
          }
        };
        reader.readAsDataURL(file);
        break; // 最初の画像のみ処理
      }
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={{ margin: 0 }}>タスク詳細編集</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button 
              onClick={() => {
                if (window.confirm('このタスクを削除してもよろしいですか？')) {
                  deleteTask(task.id);
                  onClose();
                }
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#ef4444',
                cursor: 'pointer',
                padding: '0.2rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'opacity 0.2s',
              }}
              title="タスクを削除"
              onMouseEnter={(e) => e.currentTarget.style.opacity = '0.7'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
            >
              <Trash2 size={18} />
            </button>
            <button style={styles.closeBtn} onClick={onClose}><X size={20} /></button>
          </div>
        </div>

        <div style={styles.body}>
          {/* 議事録要約から生成された場合の関連議事録表示 */}
          {originatingMinute && (
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '0.25rem', 
              background: 'rgba(99, 102, 241, 0.08)', 
              padding: '0.6rem 1rem', 
              borderRadius: '6px', 
              border: '1px solid rgba(99, 102, 241, 0.2)',
              marginBottom: '0.25rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--accent-primary)', fontWeight: 600 }}>
                <FileText size={14} />
                <span>AI自動生成タスク (議事録由来)</span>
              </div>
              <div style={{ fontSize: '0.825rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                議事録: <span style={{ fontWeight: 600 }}>{originatingMinute.title}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.775rem', color: 'var(--text-muted)' }}>
                <Calendar size={12} />
                <span>
                  開催日時: {originatingMinute.date} 
                  {originatingMinute.startTime && ` ${originatingMinute.startTime}`}
                  {originatingMinute.endTime && ` - ${originatingMinute.endTime}`}
                </span>
              </div>
            </div>
          )}

          {/* 親タスクへのパンくず・移動ナビゲーション */}
          {task.parentId && (() => {
            const parent = tasks.find(t => t.id === task.parentId);
            if (!parent) return null;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(255,255,255,0.02)', padding: '0.4rem 0.8rem', borderRadius: '4px', borderLeft: '3px solid var(--accent-primary)', marginBottom: '0.25rem' }}>
                <CornerDownRight size={14} style={{ color: 'var(--accent-primary)' }} />
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>親タスク:</span>
                <span 
                  onClick={() => setActiveTaskId(parent.id)}
                  style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-primary)', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  {parent.title}
                </span>
              </div>
            );
          })()}

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
                  memberId: e.target.value
                })}
                style={styles.input}
              >
                <option value="">-- 未割り当て (推奨: {task.assignee}) --</option>
                {displayMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>

          {/* 親タスクの設定プルダウン */}
          {task.projectId && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={styles.label}>親タスクの設定</label>
              <select
                value={task.parentId || ''}
                onChange={e => updateTask(task.id, { parentId: e.target.value || undefined })}
                style={styles.input}
              >
                <option value="">-- なし (最上位タスク) --</option>
                {getValidParentOptions().map(p => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
          )}

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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={styles.label}>詳細情報</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button 
                  onClick={() => setPreviewDetails(false)} 
                  style={{ ...styles.tabBtn, background: !previewDetails ? 'rgba(99,102,241,0.1)' : 'transparent', color: !previewDetails ? 'var(--accent-primary)' : 'var(--text-muted)' }}
                >
                  <Edit3 size={14} /> 編集
                </button>
                <button 
                  onClick={() => setPreviewDetails(true)} 
                  style={{ ...styles.tabBtn, background: previewDetails ? 'rgba(99,102,241,0.1)' : 'transparent', color: previewDetails ? 'var(--accent-primary)' : 'var(--text-muted)' }}
                >
                  <Eye size={14} /> プレビュー
                </button>
              </div>
            </div>
            {previewDetails ? (
              <div style={{ ...styles.input, minHeight: '100px', background: 'rgba(0,0,0,0.2)' }}>
                {task.details ? <MarkdownRenderer content={task.details} /> : <span style={{ color: 'var(--text-muted)' }}>詳細情報はありません。</span>}
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <textarea 
                  value={task.details || ''} 
                  onChange={e => updateTask(task.id, { details: e.target.value })}
                  onPaste={e => handlePasteImage(e, 'details')}
                  placeholder="詳細情報を入力... (画像をペーストできます)"
                  style={{ ...styles.input, minHeight: '100px', resize: 'vertical' }}
                />
                {isUploading && <div style={styles.uploadingBadge}><ImageIcon size={12} /> アップロード中...</div>}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={styles.label}>対応結果</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button 
                  onClick={() => setPreviewResult(false)} 
                  style={{ ...styles.tabBtn, background: !previewResult ? 'rgba(16,185,129,0.1)' : 'transparent', color: !previewResult ? '#10b981' : 'var(--text-muted)' }}
                >
                  <Edit3 size={14} /> 編集
                </button>
                <button 
                  onClick={() => setPreviewResult(true)} 
                  style={{ ...styles.tabBtn, background: previewResult ? 'rgba(16,185,129,0.1)' : 'transparent', color: previewResult ? '#10b981' : 'var(--text-muted)' }}
                >
                  <Eye size={14} /> プレビュー
                </button>
              </div>
            </div>
            {previewResult ? (
              <div style={{ ...styles.input, minHeight: '80px', background: 'rgba(0,0,0,0.2)' }}>
                {task.actionResult ? <MarkdownRenderer content={task.actionResult} /> : <span style={{ color: 'var(--text-muted)' }}>対応結果はありません。</span>}
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <textarea 
                  value={task.actionResult || ''} 
                  onChange={e => updateTask(task.id, { actionResult: e.target.value })}
                  onPaste={e => handlePasteImage(e, 'actionResult')}
                  placeholder="対応結果や進捗メモを入力... (画像をペーストできます)"
                  style={{ ...styles.input, minHeight: '80px', resize: 'vertical' }}
                />
                {isUploading && <div style={styles.uploadingBadge}><ImageIcon size={12} /> アップロード中...</div>}
              </div>
            )}
          </div>

          {/* 子タスク管理セクション */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={styles.label}>子タスク ({childTasks.length}件)</label>
              <button 
                className="btn-primary" 
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', height: 'auto', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                onClick={() => {
                  const newChildId = `task-child-${Date.now()}`;
                  const newChild = {
                    id: newChildId,
                    title: `${task.title} の子タスク`,
                    status: 'todo' as const,
                    projectId: task.projectId,
                    parentId: task.id,
                    assignee: task.assignee,
                    memberId: task.memberId,
                    progress: 0,
                    isNew: false
                  };
                  addTask(newChild);
                  setActiveTaskId(newChildId);
                }}
              >
                + 子タスクを追加
              </button>
            </div>
            {childTasks.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '150px', overflowY: 'auto', background: 'rgba(255,255,255,0.02)', padding: '0.5rem', borderRadius: '4px' }}>
                {childTasks.map(c => (
                  <div 
                    key={c.id} 
                    onClick={() => setActiveTaskId(c.id)}
                    style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center', 
                      padding: '0.4rem 0.6rem', 
                      background: 'rgba(255,255,255,0.03)', 
                      borderRadius: '4px', 
                      cursor: 'pointer',
                      border: '1px solid transparent',
                      transition: 'background 0.2s, border-color 0.2s'
                    }}
                  >
                    <span style={{ fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, marginRight: '0.5rem', color: 'var(--text-primary)' }}>
                      {c.title}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ 
                        fontSize: '0.7rem', 
                        padding: '1px 6px', 
                        borderRadius: '10px', 
                        background: getStatusColorBg(c.status),
                        color: getStatusColorText(c.status),
                        fontWeight: 600
                      }}>
                        {c.status === 'todo' ? 'To Do' : c.status === 'in-progress' ? 'In Progress' : 'Done'}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', minWidth: '35px', textAlign: 'right' }}>
                        {c.progress || 0}%
                      </span>
                      <ArrowRight size={12} style={{ color: 'var(--text-muted)' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>子タスクはありません。</span>
            )}
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
    maxWidth: '650px',
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
  },
  tabBtn: {
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    padding: '0.2rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  uploadingBadge: {
    position: 'absolute' as const,
    right: '10px',
    bottom: '15px',
    background: 'rgba(0,0,0,0.7)',
    color: '#fff',
    padding: '0.2rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.7rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    pointerEvents: 'none' as const,
  }
};
