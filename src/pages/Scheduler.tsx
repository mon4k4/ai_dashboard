import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';
import { CalendarDays, FolderKanban, GripVertical, Users, Layers } from 'lucide-react';
import { useAppContext } from '../store/AppContext';
import TaskEditModal from '../components/TaskEditModal';
import MeetingEditModal from '../components/MeetingEditModal';
import type { TaskExtractResult } from '../services/llmService';
import * as JapaneseHolidays from 'japanese-holidays';

const DAY_WIDTH = 40; // 1日のピクセル幅

export default function Scheduler() {
  const { tasks, projects, updateTask, reorderTasks, updateProject } = useAppContext();
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingMeeting, setEditingMeeting] = useState<{
    projectId: string;
    meetingId: string;
    occurrenceDate: string;
  } | null>(null);

  const [tooltipState, setTooltipState] = useState<{
    x: number;
    y: number;
    meetingsOnDate: any[];
    isOverlap: boolean;
    overlappingOthers: any[];
  } | null>(null);

  // ドラッグ操作の状態
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragType, setDragType] = useState<'move' | 'resize-left' | 'resize-right' | null>(null);
  const [initialTaskDates, setInitialTaskDates] = useState<{ start: string; due: string } | null>(null);

  // ミーティングドラッグ操作の状態
  const [draggingMeetingState, setDraggingMeetingState] = useState<{
    projectId: string;
    meetingId: string;
    originalDate: string;
    hasMoved: boolean;
  } | null>(null);
  const [meetingDragOffset, setMeetingDragOffset] = useState<number>(0);
  const [meetingDragStartX, setMeetingDragStartX] = useState<number>(0);

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

  // 全プロジェクトのミーティングを日付ごとに集計 (重複チェック用)
  const allMeetingsByDate = useMemo(() => {
    const map = new Map<string, Array<{id: string, time?: string, title: string, projectName: string}>>();
    projects.forEach(p => {
      if (!p.meetings) return;
      p.meetings.forEach(m => {
        const dates: string[] = [];
        if (m.isRecurring && m.dayOfWeek !== undefined) {
          let cur = m.startDate && m.startDate > minDate ? m.startDate : minDate;
          const end = m.endDate && m.endDate < maxDate ? m.endDate : maxDate;
          while (cur <= end) {
            if (new Date(cur).getDay() === m.dayOfWeek) {
              if (!m.exceptions || !m.exceptions.includes(cur)) {
                dates.push(cur);
              }
            }
            cur = addDays(cur, 1);
          }
        } else if (!m.isRecurring && m.date) {
          if (m.date >= minDate && m.date <= maxDate) {
            dates.push(m.date);
          }
        }
        dates.forEach(d => {
          if (!map.has(d)) map.set(d, []);
          map.get(d)!.push({ id: m.id, time: m.time, title: m.title, projectName: p.name });
        });
      });
    });
    return map;
  }, [projects, minDate, maxDate]);

  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const myName = localStorage.getItem('myName') || '';

  // プロジェクトごとにタスクをグループ化（wbsOrder順にソート）
  const groupedTasks = useMemo(() => {
    const groups: { projectId: string | null; projectName: string; color: string; project?: any; tasks: TaskExtractResult[] }[] = [];
    
    let filteredTasks = showOnlyMine && myName
      ? tasks.filter(t => t.assignee === myName)
      : tasks;

    if (hideCompleted) {
      filteredTasks = filteredTasks.filter(t => t.status !== 'done');
    }

    const sortTasks = (taskList: TaskExtractResult[]) => {
      return [...taskList].sort((a, b) => {
        const aOrder = a.wbsOrder !== undefined ? a.wbsOrder : 9999;
        const bOrder = b.wbsOrder !== undefined ? b.wbsOrder : 9999;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.id.localeCompare(b.id);
      });
    };

    projects.forEach(p => {
      groups.push({
        projectId: p.id,
        projectName: p.name,
        color: p.color,
        project: p,
        tasks: sortTasks(filteredTasks.filter(t => t.projectId === p.id))
      });
    });

    const noProjectTasks = filteredTasks.filter(t => !t.projectId);
    if (noProjectTasks.length > 0) {
      groups.push({
        projectId: null,
        projectName: '未分類',
        color: 'var(--text-muted)',
        tasks: sortTasks(noProjectTasks)
      });
    }

    return groups;
  }, [tasks, projects, showOnlyMine, hideCompleted, myName]);

  // WBSドラッグ＆ドロップハンドラ
  const handleWbsDragEnd = (result: DropResult, projectId: string | null) => {
    const { destination, source } = result;
    if (!destination) return;
    if (destination.index === source.index) return;

    // 現在のグループに属するタスクを取得（現在のソート順）
    let filteredTasks = showOnlyMine && myName
      ? tasks.filter(t => t.assignee === myName)
      : tasks;
      
    if (hideCompleted) {
      filteredTasks = filteredTasks.filter(t => t.status !== 'done');
    }
      
    const groupTasks = [...filteredTasks]
      .filter(t => t.projectId === projectId)
      .sort((a, b) => {
        const aOrder = a.wbsOrder !== undefined ? a.wbsOrder : 9999;
        const bOrder = b.wbsOrder !== undefined ? b.wbsOrder : 9999;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.id.localeCompare(b.id);
      });

    // 配列の並び替え
    const [reorderedItem] = groupTasks.splice(source.index, 1);
    groupTasks.splice(destination.index, 0, reorderedItem);

    // 新しい順序のIDリストを送り出す
    const orderedIds = groupTasks.map(t => t.id);
    reorderTasks(orderedIds);
  };

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

  const handleMeetingPointerDown = (e: React.PointerEvent, projectId: string, meetingId: string, date: string) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingMeetingState({
      projectId,
      meetingId,
      originalDate: date,
      hasMoved: false
    });
    setMeetingDragStartX(e.clientX);
    setMeetingDragOffset(0);
  };

  const handleMeetingPointerMove = (e: React.PointerEvent) => {
    if (!draggingMeetingState) return;
    const deltaX = e.clientX - meetingDragStartX;
    const deltaDays = Math.round(deltaX / DAY_WIDTH);
    setMeetingDragOffset(deltaDays);
    if (deltaDays !== 0 && !draggingMeetingState.hasMoved) {
      setDraggingMeetingState(prev => prev ? { ...prev, hasMoved: true } : null);
    }
  };

  const handleMeetingPointerUp = (e: React.PointerEvent) => {
    if (!draggingMeetingState) return;
    e.currentTarget.releasePointerCapture(e.pointerId);

    const { projectId, meetingId, originalDate, hasMoved } = draggingMeetingState;
    const deltaDays = meetingDragOffset;

    setDraggingMeetingState(null);
    setMeetingDragOffset(0);

    if (hasMoved && deltaDays !== 0) {
      const newDate = addDays(originalDate, deltaDays);
      if (newDate && newDate !== originalDate) {
        const proj = projects.find(p => p.id === projectId);
        if (proj && proj.meetings) {
          const m = proj.meetings.find(x => x.id === meetingId);
          if (m) {
            let updated = [...proj.meetings];
            if (m.isRecurring) {
              const exceptions = m.exceptions ? [...m.exceptions, originalDate] : [originalDate];
              updated = updated.map(x => x.id === meetingId ? { ...x, exceptions } : x);
              const newSingle = {
                id: `meet-drag-${Date.now()}`,
                title: m.title,
                isRecurring: false,
                date: newDate,
                startTime: m.startTime,
                endTime: m.endTime,
                time: m.startTime
              };
              updated.push(newSingle);
            } else {
              updated = updated.map(x => x.id === meetingId ? { ...x, date: newDate } : x);
            }
            updateProject(projectId, { meetings: updated });
          }
        }
      }
    } else {
      setEditingMeeting({
        projectId,
        meetingId,
        occurrenceDate: originalDate
      });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1.5rem', userSelect: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <CalendarDays size={24} color="var(--accent-primary)" />
          Scheduler (WBS View)
        </h2>
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 500 }}>
            <input 
              type="checkbox" 
              checked={hideCompleted} 
              onChange={e => setHideCompleted(e.target.checked)} 
              style={{ width: '16px', height: '16px' }}
            />
            完了済みのタスクを非表示
          </label>
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
                  
                  <DragDropContext onDragEnd={(result) => handleWbsDragEnd(result, group.projectId)}>
                    <Droppable droppableId={`wbs-list-${group.projectId || 'unassigned'}`}>
                      {(provided) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          style={{ display: 'flex', flexDirection: 'column' }}
                        >
                          {group.tasks.map((task, index) => (
                            <Draggable key={task.id} draggableId={task.id} index={index}>
                              {(provided, snapshot) => {
                                const rowElement = (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                    style={{
                                      ...styles.taskRowLeft,
                                      ...provided.draggableProps.style,
                                      transform: snapshot.isDragging ? provided.draggableProps.style?.transform : 'translate(0, 0)',
                                      background: snapshot.isDragging ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                                    }}
                                    onClick={() => setEditingTaskId(task.id)}
                                  >
                                    <GripVertical size={14} style={{ color: 'var(--text-muted)', cursor: 'grab', marginRight: '-0.25rem' }} />
                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: getStatusColor(task.status), flexShrink: 0 }} />
                                    <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.9rem' }}>
                                      {task.title}
                                    </span>
                                  </div>
                                );
                                if (snapshot.isDragging) {
                                  return createPortal(rowElement, document.body);
                                }
                                return rowElement;
                              }}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </DragDropContext>
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
                  {/* プロジェクト期間バー */}
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

                  {/* 打ち合わせ（ミーティング）の描画 */}
                  {group.project && group.project.meetings && (() => {
                    // プロジェクト内のミーティングを日付ごとにグループ化
                    const projectMeetingsByDate = new Map<string, any[]>();
                    group.project.meetings.forEach((m: any) => {
                      const dates: string[] = [];
                      if (m.isRecurring && m.dayOfWeek !== undefined) {
                        let cur = m.startDate && m.startDate > minDate ? m.startDate : minDate;
                        const end = m.endDate && m.endDate < maxDate ? m.endDate : maxDate;
                        while (cur <= end) {
                          if (new Date(cur).getDay() === m.dayOfWeek) {
                            if (!m.exceptions || !m.exceptions.includes(cur)) {
                              dates.push(cur);
                            }
                          }
                          cur = addDays(cur, 1);
                        }
                      } else if (!m.isRecurring && m.date) {
                        if (m.date >= minDate && m.date <= maxDate) {
                          dates.push(m.date);
                        }
                      }
                      dates.forEach(d => {
                        if (!projectMeetingsByDate.has(d)) projectMeetingsByDate.set(d, []);
                        projectMeetingsByDate.get(d)!.push(m);
                      });
                    });

                    return Array.from(projectMeetingsByDate.entries()).map(([d, meetingsOnDate]) => {
                      const offsetDays = diffDays(minDate, d);
                      
                      // 時間の重複チェック（同日内で、他プロジェクト含めた全ミーティングと照合）
                      const dateAllMeetings = allMeetingsByDate.get(d) || [];
                      const timeToMin = (t?: string) => {
                        if (!t) return -1;
                        const [h, min] = t.split(':').map(Number);
                        return h * 60 + min;
                      };

                      let isOverlap = false;
                      const overlappingOthers: any[] = [];
                      for (const m of meetingsOnDate) {
                        const mTime = timeToMin(m.time);
                        for (const other of dateAllMeetings) {
                          if (meetingsOnDate.some(mod => mod.id === other.id)) continue; // 自プロジェクトのグループに含まれているものは除外
                          const oTime = timeToMin(other.time);
                          let overlapWithOther = false;
                          if (mTime === -1 || oTime === -1) {
                            overlapWithOther = true;
                          } else if (Math.abs(mTime - oTime) < 60) {
                            overlapWithOther = true;
                          }
                          
                          if (overlapWithOther) {
                            isOverlap = true;
                            if (!overlappingOthers.some(o => o.id === other.id)) {
                              overlappingOthers.push(other);
                            }
                          }
                        }
                      }
                      
                      // 自プロジェクト内での重複チェック（複数ミーティングがある場合）
                      if (meetingsOnDate.length > 1) {
                         // 同日内に複数ある時点で、視覚的には重なるのでエラー扱いとするか、時間の被りを見るか
                         // 簡易的に同一グループ内に複数あれば重複アイコンとする
                         isOverlap = true;
                      }

                      const hoverKey = `proj-${group.project.id}-date-${d}`;
                      const isHovered = tooltipState?.meetingsOnDate === meetingsOnDate;

                      const isDraggingThis = draggingMeetingState &&
                        draggingMeetingState.projectId === group.project.id &&
                        meetingsOnDate.some(m => m.id === draggingMeetingState.meetingId) &&
                        draggingMeetingState.originalDate === d;

                      const currentOffsetDays = offsetDays + (isDraggingThis ? meetingDragOffset : 0);
                      const currentLeft = (currentOffsetDays * DAY_WIDTH) + (DAY_WIDTH / 2) - 10;

                      return (
                        <div 
                          key={hoverKey} 
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setTooltipState({
                              x: rect.left + rect.width / 2,
                              y: rect.top,
                              meetingsOnDate,
                              isOverlap,
                              overlappingOthers
                            });
                          }}
                          onMouseLeave={() => setTooltipState(null)}
                          onPointerDown={(e) => {
                            if (meetingsOnDate.length > 0) {
                              handleMeetingPointerDown(e, group.project.id, meetingsOnDate[0].id, d);
                            }
                          }}
                          onPointerMove={handleMeetingPointerMove}
                          onPointerUp={handleMeetingPointerUp}
                          style={{
                            position: 'absolute',
                            left: `${currentLeft}px`,
                            top: '8px',
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            background: isOverlap ? '#ef4444' : 'var(--bg-main)',
                            border: `2px solid ${isOverlap ? '#ef4444' : group.color}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: isDraggingThis ? 100 : (isHovered ? 50 : 5),
                            cursor: 'pointer',
                            transform: isDraggingThis ? 'scale(1.25)' : 'none',
                            transition: isDraggingThis ? 'none' : 'transform 0.2s, left 0.1s ease-out',
                            opacity: isDraggingThis ? 0.8 : 1,
                          }}
                        >
                          {isOverlap ? (
                            <Layers size={12} color="white" />
                          ) : (
                            <Users size={12} color={group.color} />
                          )}
                        </div>
                      );
                    });
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
        <TaskEditModal
          taskId={editingTaskId}
          onClose={() => setEditingTaskId(null)}
        />
      )}

      {editingMeeting && (
        <MeetingEditModal
          projectId={editingMeeting.projectId}
          meetingId={editingMeeting.meetingId}
          occurrenceDate={editingMeeting.occurrenceDate}
          onClose={() => setEditingMeeting(null)}
        />
      )}
      
      {/* ツールチップ用のPortal */}
      {tooltipState && createPortal(
        <div style={{
          position: 'fixed',
          top: `${tooltipState.y - 6}px`,
          left: `${tooltipState.x}px`,
          transform: 'translate(-50%, -100%)',
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
          padding: '0.5rem',
          borderRadius: '4px',
          fontSize: '0.75rem',
          whiteSpace: 'nowrap',
          border: `1px solid ${tooltipState.isOverlap ? '#ef4444' : 'var(--border-color)'}`,
          boxShadow: 'var(--shadow-md)',
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          pointerEvents: 'none',
          minWidth: 'max-content'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {tooltipState.meetingsOnDate.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontWeight: 'bold' }}>{m.title}</span>
                {m.time && <span style={{ color: 'var(--text-secondary)' }}>{m.time}</span>}
              </div>
            ))}
          </div>
          {tooltipState.isOverlap && (
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
              <div style={{ color: '#ef4444', fontWeight: 'bold', marginBottom: '0.25rem' }}>
                ⚠️ {tooltipState.overlappingOthers.length > 0 ? '以下の予定と重複しています' : '時間が重複している予定があります'}
              </div>
              {tooltipState.overlappingOthers.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {tooltipState.overlappingOthers.map(other => (
                    <div key={other.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>[{other.projectName}]</span>
                      <span style={{ fontWeight: 'bold', color: 'var(--text-secondary)' }}>{other.title}</span>
                      {other.time && <span style={{ color: 'var(--text-muted)' }}>{other.time}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* 吹き出しの三角 */}
          <div style={{
            position: 'absolute',
            bottom: '-5px',
            left: '50%',
            transform: 'translateX(-50%)',
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: `5px solid ${tooltipState.isOverlap ? '#ef4444' : 'var(--bg-card)'}`
          }} />
        </div>,
        document.body
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
