import { useState, useMemo, useRef, useEffect } from 'react';
import { CalendarDays, FolderKanban } from 'lucide-react';
import { useAppContext } from '../store/AppContext';
import TaskEditModal from '../components/TaskEditModal';
import type { TaskExtractResult } from '../services/llmService';
import * as JapaneseHolidays from 'japanese-holidays';

const DAY_WIDTH = 40; // 1日のピクセル幅

export default function Scheduler() {
  const { tasks, projects, updateTask } = useAppContext();
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  // ドラッグ操作の状態
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragType, setDragType] = useState<'move' | 'resize-left' | 'resize-right' | null>(null);
  const [initialTaskDates, setInitialTaskDates] = useState<{ start: string; due: string } | null>(null);

  // 日付操作のユーティリティ
  const addDays = (dateStr: string, days: number) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  };

  const diffDays = (d1: string, d2: string) => {
    const date1 = new Date(d1);
    const date2 = new Date(d2);
    if (isNaN(date1.getTime()) || isNaN(date2.getTime())) return 0;
    return Math.round((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24));
  };

  const todayStr = new Date().toISOString().split('T')[0];

  // 全タスクの中で最小の開始日と最大の終了日を見つける
  const { minDate, maxDate } = useMemo(() => {
    let min = todayStr;
    let max = todayStr;
    
    tasks.forEach(t => {
      if (t.startDate && t.startDate < min) min = t.startDate;
      if (t.dueDate && t.dueDate > max) max = t.dueDate;
    });

    // 余白を持たせる (-7 days, +30 days)
    return {
      minDate: addDays(min, -7),
      maxDate: addDays(max, 30)
    };
  }, [tasks, todayStr]);

  // カレンダーの日付配列を生成
  const days = useMemo(() => {
    const list = [];
    let current = minDate;
    while (current <= maxDate) {
      list.push(current);
      current = addDays(current, 1);
    }
    return list;
  }, [minDate, maxDate]);

  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const myName = localStorage.getItem('myName') || '';

  // プロジェクトごとにタスクをグループ化
  const groupedTasks = useMemo(() => {
    const groups: { projectId: string | null; projectName: string; color: string; project?: any; tasks: TaskExtractResult[] }[] = [];
    
    const filteredTasks = showOnlyMine && myName
      ? tasks.filter(t => t.assignee === myName)
      : tasks;

    projects.forEach(p => {
      groups.push({
        projectId: p.id,
        projectName: p.name,
        color: p.color,
        project: p,
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

    return groups.filter(g => g.tasks.length > 0);
  }, [tasks, projects, showOnlyMine, myName]);

  // ================= ドラッグ＆ドロップ =================
  const handlePointerDown = (e: React.PointerEvent, taskId: string, type: 'move' | 'resize-left' | 'resize-right') => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const task = tasks.find(t => t.id === taskId);
    if (!task || !task.startDate || !task.dueDate) return;
    
    setDraggingTaskId(taskId);
    setDragType(type);
    setDragStartX(e.clientX);
    setInitialTaskDates({ start: task.startDate, due: task.dueDate });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingTaskId || !dragType || !initialTaskDates) return;
    
    const deltaX = e.clientX - dragStartX;
    const deltaDays = Math.round(deltaX / DAY_WIDTH);

    let newStart = initialTaskDates.start;
    let newDue = initialTaskDates.due;

    if (dragType === 'move') {
      newStart = addDays(initialTaskDates.start, deltaDays);
      newDue = addDays(initialTaskDates.due, deltaDays);
    } else if (dragType === 'resize-left') {
      newStart = addDays(initialTaskDates.start, deltaDays);
      if (newStart > newDue) newStart = newDue; // 終了日を越えないようにする
    } else if (dragType === 'resize-right') {
      newDue = addDays(initialTaskDates.due, deltaDays);
      if (newDue < newStart) newDue = newStart; // 開始日を越えないようにする
    }

    // パフォーマンスのため、状態を直接更新せずに updateTask を呼ぶ
    // 頻繁なレンダリングを避けるために requestAnimationFrame を使うのが理想ですが、簡易実装
    updateTask(draggingTaskId, { startDate: newStart, dueDate: newDue });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingTaskId) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDraggingTaskId(null);
      setDragType(null);
      setInitialTaskDates(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1.5rem', userSelect: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <CalendarDays size={24} color="var(--accent-primary)" />
          Scheduler (WBS View)
        </h2>
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

      <div className="glass-panel" style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <div style={{ display: 'flex', minWidth: 'max-content' }}>
          
          {/* 左側: タスクリスト (横スクロール時も固定) */}
          <div style={{ width: '300px', position: 'sticky', left: 0, zIndex: 20, background: 'var(--bg-main)', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
            {/* 左側ヘッダー (縦スクロール時も固定) */}
            <div style={{ height: '60px', position: 'sticky', top: 0, zIndex: 30, borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', padding: '0 1rem', background: 'var(--bg-main)' }}>
              <span style={{ fontWeight: 'bold' }}>プロジェクト / タスク</span>
            </div>
            <div style={{ flex: 1 }}>
              {groupedTasks.map(group => (
                <div key={group.projectId || 'unassigned'}>
                  <div style={{ ...styles.projectHeader, borderLeft: `4px solid ${group.color}` }}>
                    <FolderKanban size={16} />
                    {group.projectName}
                  </div>
                  {group.tasks.map(task => (
                    <div key={task.id} style={styles.taskRowLeft} onClick={() => setEditingTaskId(task.id)}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: getStatusColor(task.status), flexShrink: 0 }} />
                      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.9rem' }}>
                        {task.title}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* 右側: ガントチャート (タイムライン) */}
          <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {/* 日付・月ヘッダー (縦スクロール時も固定) */}
          <div style={{ display: 'flex', flexDirection: 'column', height: '60px', position: 'sticky', top: 0, zIndex: 10, borderBottom: '1px solid var(--border-color)', background: 'var(--bg-main)' }}>
            
            {/* 月ヘッダー */}
            <div style={{ display: 'flex', height: '24px', borderBottom: '1px solid var(--border-color)' }}>
              {(() => {
                const months: { month: number, year: number, days: number }[] = [];
                let currentMonth = -1;
                let currentYear = -1;
                let currentDays = 0;
                
                days.forEach(d => {
                  const dateObj = new Date(d);
                  const m = dateObj.getMonth();
                  const y = dateObj.getFullYear();
                  if (m !== currentMonth || y !== currentYear) {
                    if (currentMonth !== -1) {
                      months.push({ month: currentMonth, year: currentYear, days: currentDays });
                    }
                    currentMonth = m;
                    currentYear = y;
                    currentDays = 1;
                  } else {
                    currentDays++;
                  }
                });
                if (currentMonth !== -1) months.push({ month: currentMonth, year: currentYear, days: currentDays });
                
                return months.map((m, i) => (
                  <div key={i} style={{ width: m.days * DAY_WIDTH, minWidth: m.days * DAY_WIDTH, borderRight: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {m.year}年 {m.month + 1}月
                  </div>
                ));
              })()}
            </div>

            {/* 日ヘッダー */}
            <div style={{ display: 'flex', height: '36px' }}>
              {days.map(d => {
                const dateObj = new Date(d);
                const dayOfWeek = dateObj.getDay();
                const isHoliday = !!JapaneseHolidays.isHoliday(dateObj);
                const isDayOff = dayOfWeek === 0 || dayOfWeek === 6 || isHoliday;
                const isToday = d === todayStr;
                
                let textColor = 'var(--text-muted)';
                if (dayOfWeek === 0 || isHoliday) textColor = '#ef4444'; // 日・祝は赤
                else if (dayOfWeek === 6) textColor = '#3b82f6'; // 土曜は青
                
                return (
                  <div key={d} style={{ ...styles.dayHeader, height: '100%', width: DAY_WIDTH, minWidth: DAY_WIDTH, background: isDayOff ? 'rgba(255,255,255,0.04)' : 'transparent' }}>
                    <div style={{ fontSize: '0.75rem', color: isToday ? 'var(--accent-primary)' : textColor, fontWeight: isToday ? 'bold' : 'normal' }}>
                      {dateObj.getDate()}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: textColor }}>
                      {['日','月','火','水','木','金','土'][dayOfWeek]}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          
          {/* チャートエリア */}
          <div style={{ position: 'relative', flex: 1 }}>
            {/* 背景のグリッドと現在日ライン */}
            <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, display: 'flex', pointerEvents: 'none' }}>
              {days.map(d => {
                const dateObj = new Date(d);
                const dayOfWeek = dateObj.getDay();
                const isHoliday = !!JapaneseHolidays.isHoliday(dateObj);
                const isDayOff = dayOfWeek === 0 || dayOfWeek === 6 || isHoliday;
                const isToday = d === todayStr;
                return (
                  <div key={`grid-${d}`} style={{ 
                    width: DAY_WIDTH, 
                    minWidth: DAY_WIDTH, 
                    borderRight: '1px solid rgba(255,255,255,0.05)',
                    background: isDayOff ? 'rgba(255,255,255,0.04)' : 'transparent',
                    position: 'relative'
                  }}>
                    {isToday && <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: '2px', background: 'var(--accent-primary)', zIndex: 10 }} />}
                  </div>
                );
              })}
            </div>

            {/* タスクバー */}
            {groupedTasks.map(group => (
              <div key={`timeline-group-${group.projectId || 'unassigned'}`}>
                <div style={{ height: '36px', position: 'relative', borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.01)' }}>
                  {group.project && group.project.startDate && group.project.endDate && (() => {
                    const offsetDays = diffDays(minDate, group.project.startDate);
                    const durationDays = diffDays(group.project.startDate, group.project.endDate) + 1;
                    return (
                      <div style={{
                        position: 'absolute',
                        left: `${offsetDays * DAY_WIDTH}px`,
                        width: `${durationDays * DAY_WIDTH}px`,
                        height: '12px',
                        background: group.color,
                        borderRadius: '6px',
                        top: '12px',
                        opacity: 0.5,
                        pointerEvents: 'none'
                      }} />
                    );
                  })()}
                </div>
                {group.tasks.map(task => {
                  if (!task.startDate || !task.dueDate) {
                    return (
                      <div key={`timeline-task-${task.id}`} style={styles.taskRowRight}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>日程未設定</span>
                      </div>
                    );
                  }

                  const offsetDays = diffDays(minDate, task.startDate);
                  const durationDays = diffDays(task.startDate, task.dueDate) + 1; // 1日も含める
                  const progress = task.progress || 0;

                  return (
                    <div key={`timeline-task-${task.id}`} style={styles.taskRowRight}>
                      <div 
                        style={{
                          position: 'absolute',
                          left: `${offsetDays * DAY_WIDTH}px`,
                          width: `${durationDays * DAY_WIDTH}px`,
                          height: '24px',
                          background: 'var(--bg-card)',
                          border: `1px solid ${group.color}`,
                          borderRadius: '4px',
                          top: '6px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          overflow: 'hidden',
                          boxShadow: 'var(--shadow-sm)'
                        }}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerLeave={handlePointerUp}
                      >
                        {/* 全体にかかる進捗プログレス背景 */}
                        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress}%`, background: `${group.color}44`, pointerEvents: 'none' }} />

                        {/* リサイズハンドル (左) */}
                        <div 
                          style={styles.resizeHandle} 
                          onPointerDown={e => handlePointerDown(e, task.id, 'resize-left')}
                        />
                        
                        {/* ドラッグ移動エリア (中央) */}
                        <div 
                          style={{ flex: 1, height: '100%', position: 'relative' }}
                          onPointerDown={e => handlePointerDown(e, task.id, 'move')}
                          onClick={() => setEditingTaskId(task.id)}
                        >
                          <div style={{ position: 'relative', padding: '0 0.5rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', zIndex: 1, pointerEvents: 'none', height: '100%', display: 'flex', alignItems: 'center' }}>
                            {task.title} ({progress}%)
                          </div>
                        </div>

                        {/* リサイズハンドル (右) */}
                        <div 
                          style={styles.resizeHandle} 
                          onPointerDown={e => handlePointerDown(e, task.id, 'resize-right')}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>

      {editingTaskId && (
        <TaskEditModal taskId={editingTaskId} onClose={() => setEditingTaskId(null)} />
      )}
    </div>
  );
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'done': return 'var(--status-done)';
    case 'in-progress': return 'var(--status-in-progress)';
    default: return 'var(--status-todo)';
  }
};

const styles = {
  projectHeader: {
    padding: '0.5rem 1rem',
    background: 'rgba(255,255,255,0.03)',
    borderBottom: '1px solid var(--border-color)',
    borderTop: '1px solid var(--border-color)',
    fontWeight: 600,
    fontSize: '0.9rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    height: '36px'
  },
  taskRowLeft: {
    padding: '0 1rem',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  taskRowRight: {
    height: '36px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
    padding: '0 0.5rem',
  },
  dayHeader: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    borderRight: '1px solid var(--border-color)',
  },
  resizeHandle: {
    width: '8px',
    height: '100%',
    cursor: 'col-resize',
    background: 'rgba(255,255,255,0.1)',
    zIndex: 2,
  }
};
