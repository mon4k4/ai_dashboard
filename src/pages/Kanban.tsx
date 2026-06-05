import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';
import { Bot, Loader2, Plus, CornerDownRight, FolderKanban, ChevronRight, ChevronDown } from 'lucide-react';
import { useAppContext } from '../store/AppContext';
import { extractTasksFromTranscript } from '../services/llmService';
import type { TaskExtractResult } from '../services/llmService';
import TaskEditModal from '../components/TaskEditModal';

const COLUMNS = [
  { id: 'todo', title: 'To Do' },
  { id: 'in-progress', title: 'In Progress' },
  { id: 'done', title: 'Done' }
];

const COLLAPSED_PROJECTS_STORAGE_KEY = 'kanbanCollapsedProjectIds';

function readSavedCollapseState(key: string): Record<string, boolean> {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return {};
    const parsed = JSON.parse(saved);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toggleSavedCollapseState(
  key: string,
  id: string,
  setState: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
) {
  setState(prev => {
    const next = { ...prev, [id]: !prev[id] };
    localStorage.setItem(key, JSON.stringify(next));
    return next;
  });
}

export default function Kanban() {
  const { tasks, projects, members, addTask, updateTask, moveProject } = useAppContext();
  const [transcript, setTranscript] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  
  // フィルター状態
  const [showOnlyMine, setShowOnlyMine] = useState(() => {
    return localStorage.getItem('kanban_showOnlyMine') === 'true';
  });
  const [hideClosedProjects, setHideClosedProjects] = useState(() => {
    return localStorage.getItem('kanban_hideClosedProjects') === 'true';
  });
  const [isFormExpanded, setIsFormExpanded] = useState(false);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Record<string, boolean>>(
    () => readSavedCollapseState(COLLAPSED_PROJECTS_STORAGE_KEY)
  );
  
  const myMemberId = localStorage.getItem('myName') || '';

  const handleExtract = async () => {
    if (!transcript.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const extractedTasks = await extractTasksFromTranscript(transcript);
      // 新しいタスクを追加（重複チェックなどは簡易的に省略、ユニークIDを振り直すか既存を使う）
      extractedTasks.forEach(task => {
        addTask({
          ...task,
          id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, // Ensure unique ID
          status: 'todo'
        });
      });
      setTranscript('');
    } catch (err: any) {
      setError(err.message || 'Failed to extract tasks');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddManualTask = (projectId: string | null, status: 'todo' | 'in-progress' | 'done') => {
    const newTaskId = `task-manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    addTask({
      id: newTaskId,
      title: '新しいタスク',
      status,
      projectId: projectId || undefined,
      assignee: '',
      progress: 0,
      isNew: false
    });
    setEditingTaskId(newTaskId);
  };

  const onDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const [destColId, destProjId] = destination.droppableId.split('_');
    const [, sourceProjId] = source.droppableId.split('_');

    const updates: Partial<TaskExtractResult> = { status: destColId as any };
    if (destProjId !== sourceProjId) {
      updates.projectId = destProjId === 'unassigned' ? undefined : destProjId;
    }
    updateTask(draggableId, updates);
  };

  // 未承認タスク（isNew: true）は除外する
  const approvedTasks = tasks.filter(t => !t.isNew);
  const filteredTasks = showOnlyMine && myMemberId
    ? approvedTasks.filter(t => t.memberId === myMemberId)
    : approvedTasks;

  const groupedTasks = useMemo(() => {
    const groups: { 
      projectId: string | null; 
      projectName: string; 
      color: string; 
      tasks: TaskExtractResult[] 
    }[] = [];
    
    const activeProjects = hideClosedProjects ? projects.filter(p => !p.isClosed) : projects;

    activeProjects.forEach(p => {
      groups.push({
        projectId: p.id,
        projectName: p.name,
        color: p.color,
        tasks: filteredTasks.filter(t => t.projectId === p.id)
      });
    });

    const noProjectTasks = filteredTasks.filter(t => !t.projectId);
    if (noProjectTasks.length > 0) {
      groups.push({
        projectId: null,
        projectName: '未分類',
        color: 'var(--text-muted)',
        tasks: noProjectTasks
      });
    }

    return groups;
  }, [filteredTasks, projects, hideClosedProjects]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1.5rem', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 500 }}>
          <input 
            type="checkbox" 
            checked={hideClosedProjects} 
            onChange={e => {
              setHideClosedProjects(e.target.checked);
              localStorage.setItem('kanban_hideClosedProjects', String(e.target.checked));
            }} 
            style={{ width: '16px', height: '16px' }}
          />
          クローズ済みのPJを非表示
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 500 }}>
          <input 
            type="checkbox" 
            checked={showOnlyMine} 
            onChange={e => {
              setShowOnlyMine(e.target.checked);
              localStorage.setItem('kanban_showOnlyMine', String(e.target.checked));
            }} 
            disabled={!myMemberId}
            style={{ width: '16px', height: '16px' }}
          />
          自分のタスクのみ表示 {(!myMemberId) && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>(設定から名前を登録してください)</span>}
        </label>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: isFormExpanded ? '1rem' : '0', transition: 'all 0.3s ease' }}>
        <div 
          onClick={() => setIsFormExpanded(!isFormExpanded)} 
          style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' }}>
            <Bot size={20} color="var(--accent-primary)" />
            タスク自動抽出
          </h3>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            {isFormExpanded ? '閉じる ▲' : '開く ▼'}
          </span>
        </div>

        {isFormExpanded && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Zoomの文字起こしテキストをここに貼り付けてください..."
              rows={4}
              style={{ resize: 'vertical' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {error ? <span style={{ color: '#ef4444', fontSize: '0.875rem' }}>{error}</span> : <span />}
              <button className="btn-primary" onClick={handleExtract} disabled={isLoading || !transcript.trim()}>
                {isLoading ? <Loader2 size={18} className="spin" /> : <Plus size={18} />}
                AIで抽出する
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <DragDropContext onDragEnd={onDragEnd}>
          <div style={styles.board}>
            {groupedTasks.map((group: any) => {
              const isProjectCollapsed = collapsedProjectIds[group.projectId || 'unassigned'];
              const activeProjects = hideClosedProjects ? projects.filter(p => !p.isClosed) : projects;
              const projectIndex = group.projectId ? activeProjects.findIndex(p => p.id === group.projectId) : -1;
              const isFirst = projectIndex === 0;
              const isLast = projectIndex === activeProjects.length - 1;

              return (
                <div key={group.projectId || 'unassigned'} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {/* プロジェクトヘッダー */}
                  <div 
                    onClick={() => {
                      const key = group.projectId || 'unassigned';
                      toggleSavedCollapseState(COLLAPSED_PROJECTS_STORAGE_KEY, key, setCollapsedProjectIds);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.6rem 1rem',
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      userSelect: 'none',
                      borderLeft: `4px solid ${group.color || 'var(--text-muted)'}`
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                      {isProjectCollapsed ? (
                        <ChevronRight size={14} style={{ color: 'var(--text-secondary)' }} />
                      ) : (
                        <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} />
                      )}
                      <FolderKanban size={16} style={{ color: group.color || 'var(--text-muted)' }} />
                      <span>{group.projectName}</span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                        ({group.tasks.length} 件)
                      </span>
                    </div>

                    {group.projectId && (
                      <div style={{ display: 'flex', gap: '0.25rem' }} onClick={e => e.stopPropagation()}>
                        <button
                          disabled={isFirst}
                          onClick={() => moveProject(group.projectId!, 'up')}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: isFirst ? 'var(--text-muted)' : 'var(--text-secondary)',
                            cursor: isFirst ? 'not-allowed' : 'pointer',
                            padding: '0.2rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.75rem',
                            opacity: isFirst ? 0.3 : 0.7,
                            transition: 'opacity 0.2s'
                          }}
                          title="上に移動"
                          onMouseOver={e => !isFirst && (e.currentTarget.style.opacity = '1')}
                          onMouseOut={e => !isFirst && (e.currentTarget.style.opacity = '0.7')}
                        >
                          ▲
                        </button>
                        <button
                          disabled={isLast}
                          onClick={() => moveProject(group.projectId!, 'down')}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: isLast ? 'var(--text-muted)' : 'var(--text-secondary)',
                            cursor: isLast ? 'not-allowed' : 'pointer',
                            padding: '0.2rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.75rem',
                            opacity: isLast ? 0.3 : 0.7,
                            transition: 'opacity 0.2s'
                          }}
                          title="下に移動"
                          onMouseOver={e => !isLast && (e.currentTarget.style.opacity = '1')}
                          onMouseOut={e => !isLast && (e.currentTarget.style.opacity = '0.7')}
                        >
                          ▼
                        </button>
                      </div>
                    )}
                  </div>

                  {/* スイムレーンのカラム表示 */}
                  {!isProjectCollapsed && (
                    <div style={{ display: 'flex', gap: '1.5rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
                      {COLUMNS.map((col) => {
                        const colTasks = group.tasks.filter((t: TaskExtractResult) => t.status === col.id);
                        const droppableId = `${col.id}_${group.projectId || 'unassigned'}`;
                        return (
                          <div key={col.id} className="glass-panel" style={{ ...styles.column, flex: '1 1 300px', minWidth: '260px' }}>
                            <h4 style={styles.columnHeader}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {col.title} <span style={styles.badge}>{colTasks.length}</span>
                              </span>
                              <button
                                onClick={() => handleAddManualTask(group.projectId, col.id as any)}
                                style={styles.addColumnTaskBtn}
                                title="タスクを追加"
                                onMouseEnter={e => {
                                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                                  e.currentTarget.style.color = 'var(--accent-primary)';
                                }}
                                onMouseLeave={e => {
                                  e.currentTarget.style.background = 'transparent';
                                  e.currentTarget.style.color = 'var(--text-secondary)';
                                }}
                              >
                                <Plus size={16} />
                              </button>
                            </h4>
                            
                            <Droppable droppableId={droppableId}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.droppableProps}
                                  style={{
                                    ...styles.taskList,
                                    background: snapshot.isDraggingOver ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                                    minHeight: '120px'
                                  }}
                                >
                                  {colTasks.map((task: TaskExtractResult, index: number) => {
                                    const project = projects.find(p => p.id === task.projectId);
                                    return (
                                       <Draggable key={task.id} draggableId={task.id} index={index}>
                                        {(provided, snapshot) => {
                                          const cardElement = (
                                            <div
                                              ref={provided.innerRef}
                                              {...provided.draggableProps}
                                              {...provided.dragHandleProps}
                                              onClick={() => setEditingTaskId(task.id)}
                                              style={{
                                                ...styles.taskCard,
                                                borderLeft: project ? `4px solid ${project.color}` : '1px solid var(--border-color)',
                                                ...provided.draggableProps.style,
                                                transform: snapshot.isDragging ? provided.draggableProps.style?.transform : 'translate(0, 0)',
                                                cursor: 'pointer'
                                              }}
                                            >
                                              <div style={styles.taskTitle}>{task.title}</div>
                                               {project && (
                                                <div style={{ fontSize: '0.75rem', color: project.color, fontWeight: 500 }}>
                                                  {project.name}
                                                </div>
                                              )}
                                              
                                              {/* 親タスクバッジ */}
                                              {(() => {
                                                const parentTask = tasks.find(t => t.id === task.parentId);
                                                if (!parentTask) return null;
                                                return (
                                                  <div 
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setEditingTaskId(parentTask.id);
                                                    }}
                                                    style={{
                                                      fontSize: '0.7rem',
                                                      color: 'var(--accent-primary)',
                                                      background: 'rgba(255, 255, 255, 0.05)',
                                                      border: '1px solid rgba(255, 255, 255, 0.1)',
                                                      padding: '0.1rem 0.4rem',
                                                      borderRadius: '4px',
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      gap: '0.25rem',
                                                      cursor: 'pointer',
                                                      marginTop: '0.25rem',
                                                      width: 'fit-content'
                                                    }}
                                                    title="親タスクを編集"
                                                  >
                                                    <CornerDownRight size={10} />
                                                    {parentTask.title}
                                                  </div>
                                                );
                                              })()}
                                              
                                              {task.actionResult && (
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.03)', padding: '0.25rem 0.5rem', borderRadius: '4px', borderLeft: '2px solid var(--accent-primary)', marginTop: '0.25rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={task.actionResult}>
                                                  <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>対応: </span>{task.actionResult}
                                                </div>
                                              )}
                                              
                                              {/* 子タスクの進捗サマリー */}
                                              {(() => {
                                                const childTasks = tasks.filter(t => t.parentId === task.id);
                                                if (childTasks.length === 0) return null;
                                                const doneCount = childTasks.filter(t => t.status === 'done').length;
                                                const avgProgress = Math.round(childTasks.reduce((sum: number, c: TaskExtractResult) => sum + (c.progress || 0), 0) / childTasks.length);
                                                return (
                                                  <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                                    <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                                                      <span>子タスク ({doneCount}/{childTasks.length}件)</span>
                                                      <span>{avgProgress}%</span>
                                                    </div>
                                                    <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                                                      <div 
                                                        style={{ 
                                                          width: `${avgProgress}%`, 
                                                          height: '100%', 
                                                          background: 'var(--accent-primary)', 
                                                          borderRadius: '2px' 
                                                        }} 
                                                      />
                                                    </div>
                                                  </div>
                                                );
                                              })()}
                                              <div style={styles.taskMeta}>
                                                <span style={styles.assignee}>
                                                  {members.find(m => m.id === task.memberId)?.name || '未割り当て'}
                                                </span>
                                                {task.progress !== undefined && (
                                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{task.progress}%</span>
                                                )}
                                              </div>
                                            </div>
                                          );
                                          if (snapshot.isDragging) {
                                            return createPortal(cardElement, document.body);
                                          }
                                          return cardElement;
                                        }}
                                      </Draggable>
                                    );
                                  })}
                                  {provided.placeholder}
                                </div>
                              )}
                            </Droppable>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </DragDropContext>
      </div>
      
      {editingTaskId && (
        <TaskEditModal taskId={editingTaskId} onClose={() => setEditingTaskId(null)} />
      )}
      
      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

const styles = {
  board: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1.5rem',
    height: '100%',
    overflowY: 'auto' as const,
    paddingBottom: '0.5rem',
  },
  column: {
    display: 'flex',
    flexDirection: 'column' as const,
    flex: '0 0 320px',
    padding: '1rem',
  },
  columnHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    marginBottom: '1rem',
    fontSize: '1.1rem',
  },
  addColumnTaskBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: '0.2rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    transition: 'background 0.2s, color 0.2s',
  },
  badge: {
    background: 'var(--bg-card)',
    padding: '0.1rem 0.5rem',
    borderRadius: '1rem',
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
  },
  taskList: {
    flex: 1,
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.75rem',
    borderRadius: 'var(--radius-md)',
    transition: 'background 0.2s ease',
    minHeight: '100px',
  },
  taskCard: {
    background: 'var(--bg-card)',
    padding: '1rem',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-color)',
    boxShadow: 'var(--shadow-glass)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.5rem',
  },
  taskTitle: {
    fontWeight: 500,
    fontSize: '0.95rem',
  },
  taskMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.85rem',
  },
  assignee: {
    background: 'rgba(99, 102, 241, 0.2)',
    color: 'var(--accent-primary)',
    padding: '0.2rem 0.5rem',
    borderRadius: '4px',
  }
};
