import { useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';
import { Bot, Loader2, Plus, GripVertical } from 'lucide-react';
import { useAppContext } from '../store/AppContext';
import { extractTasksFromTranscript } from '../services/llmService';
import type { TaskExtractResult } from '../services/llmService';
import TaskEditModal from '../components/TaskEditModal';

const COLUMNS = [
  { id: 'todo', title: 'To Do' },
  { id: 'in-progress', title: 'In Progress' },
  { id: 'done', title: 'Done' }
];

export default function Kanban() {
  const { tasks, projects, addTask, updateTask } = useAppContext();
  const [transcript, setTranscript] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [showOnlyMine, setShowOnlyMine] = useState(false);
  
  const myName = localStorage.getItem('myName') || '';

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

  const onDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    updateTask(draggableId, { status: destination.droppableId as any });
  };

  const filteredTasks = showOnlyMine && myName
    ? tasks.filter(t => t.assignee === myName)
    : tasks;

  const tasksByColumn = COLUMNS.reduce((acc, col) => {
    acc[col.id] = filteredTasks.filter(t => t.status === col.id);
    return acc;
  }, {} as Record<string, TaskExtractResult[]>);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 500 }}>
          <input 
            type="checkbox" 
            checked={showOnlyMine} 
            onChange={e => setShowOnlyMine(e.target.checked)} 
            disabled={!myName}
            style={{ width: '16px', height: '16px' }}
          />
          自分のタスクのみ表示 {(!myName) && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>(設定から名前を登録してください)</span>}
        </label>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Bot size={20} color="var(--accent-primary)" />
          タスク自動抽出
        </h3>
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

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <DragDropContext onDragEnd={onDragEnd}>
          <div style={styles.board}>
            {COLUMNS.map((col) => (
              <div key={col.id} className="glass-panel" style={styles.column}>
                <h4 style={styles.columnHeader}>
                  {col.title} <span style={styles.badge}>{tasksByColumn[col.id]?.length || 0}</span>
                </h4>
                
                <Droppable droppableId={col.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      style={{
                        ...styles.taskList,
                        background: snapshot.isDraggingOver ? 'rgba(255, 255, 255, 0.05)' : 'transparent'
                      }}
                    >
                      {tasksByColumn[col.id]?.map((task, index) => {
                        const project = projects.find(p => p.id === task.projectId);
                        return (
                          <Draggable key={task.id} draggableId={task.id} index={index}>
                            {(provided, snapshot) => (
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
                                <div style={styles.taskMeta}>
                                  <span style={styles.assignee}>{task.assignee}</span>
                                  {task.progress !== undefined && (
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{task.progress}%</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            ))}
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
    gap: '1.5rem',
    height: '100%',
    overflowX: 'auto' as const,
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
    gap: '0.5rem',
    marginBottom: '1rem',
    fontSize: '1.1rem',
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
