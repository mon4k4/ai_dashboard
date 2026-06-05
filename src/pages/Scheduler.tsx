import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';
import { CalendarDays, FolderKanban, GripVertical, Users, Layers, ChevronRight, ChevronDown } from 'lucide-react';
import { useAppContext } from '../store/AppContext';
import TaskEditModal from '../components/TaskEditModal';
import MeetingEditModal from '../components/MeetingEditModal';
import type { TaskExtractResult } from '../services/llmService';
import * as JapaneseHolidays from 'japanese-holidays';

const DAY_WIDTH = 40; // 1日のピクセル幅
const COLLAPSED_PROJECTS_STORAGE_KEY = 'schedulerCollapsedProjectIds';
const COLLAPSED_TASKS_STORAGE_KEY = 'schedulerCollapsedTaskIds';

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

export default function Scheduler() {
  const { tasks, projects, updateTask, reorderTasks, updateProject, moveProject } = useAppContext();
  const isDraggingRef = useRef(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  // 列幅ドラッグリサイズ状態
  const [leftColumnWidth, setLeftColumnWidth] = useState<number>(() => {
    const saved = localStorage.getItem('scheduler_leftColumnWidth');
    return saved ? parseInt(saved, 10) : 320;
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // 左右パネルの独立スクロール用参照
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const hasScrolledToToday = useRef(false);

  // 垂直スクロール同期（無限ループ防止用ガード）
  const scrollSyncSource = useRef<'left' | 'right' | null>(null);

  const handleLeftPanelScroll = () => {
    if (scrollSyncSource.current === 'right') return;
    scrollSyncSource.current = 'left';
    if (rightScrollRef.current && leftScrollRef.current) {
      rightScrollRef.current.scrollTop = leftScrollRef.current.scrollTop;
    }
    requestAnimationFrame(() => { scrollSyncSource.current = null; });
  };

  const handleRightPanelScroll = () => {
    if (scrollSyncSource.current === 'left') return;
    scrollSyncSource.current = 'right';
    if (leftScrollRef.current && rightScrollRef.current) {
      leftScrollRef.current.scrollTop = rightScrollRef.current.scrollTop;
    }
    requestAnimationFrame(() => { scrollSyncSource.current = null; });
  };

  const handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = leftColumnWidth;
  };

  const handleResizeMove = (e: React.PointerEvent) => {
    if (!isResizing) return;
    const deltaX = e.clientX - resizeStartX.current;
    const newWidth = Math.max(200, Math.min(600, resizeStartWidth.current + deltaX));
    setLeftColumnWidth(newWidth);
  };

  const handleResizeEnd = (e: React.PointerEvent) => {
    if (isResizing) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setIsResizing(false);
      localStorage.setItem('scheduler_leftColumnWidth', String(leftColumnWidth));
    }
  };
  const [editingMeeting, setEditingMeeting] = useState<{
    projectId: string;
    meetingId: string;
    occurrenceDate: string;
  } | null>(null);

  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Record<string, boolean>>(
    () => readSavedCollapseState(COLLAPSED_TASKS_STORAGE_KEY)
  );
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Record<string, boolean>>(
    () => readSavedCollapseState(COLLAPSED_PROJECTS_STORAGE_KEY)
  );
  const [hideClosedProjects, setHideClosedProjects] = useState(() => {
    return localStorage.getItem('scheduler_hideClosedProjects') === 'true';
  });

  const activeProjects = useMemo(() => {
    return hideClosedProjects ? projects.filter(p => !p.isClosed) : projects;
  }, [projects, hideClosedProjects]);

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

  // 本日（Today）基準への初回マウント時のスクロール調整（右パネルのみ）
  useEffect(() => {
    if (rightScrollRef.current && !hasScrolledToToday.current && days.length > 0) {
      const scrollTimer = setTimeout(() => {
        if (rightScrollRef.current) {
          const todayIndex = days.indexOf(todayStr);
          if (todayIndex !== -1) {
            const todayX = todayIndex * DAY_WIDTH;
            const container = rightScrollRef.current;
            const timelineAreaWidth = container.clientWidth;
            container.scrollLeft = Math.max(0, todayX - (timelineAreaWidth / 2));
            hasScrolledToToday.current = true;
          }
        }
      }, 50);
      return () => clearTimeout(scrollTimer);
    }
  }, [days, todayStr]);

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

  const [showOnlyMine, setShowOnlyMine] = useState(() => {
    return localStorage.getItem('scheduler_showOnlyMine') === 'true';
  });
  const [hideCompleted, setHideCompleted] = useState(() => {
    return localStorage.getItem('scheduler_hideCompleted') === 'true';
  });
  const myMemberId = localStorage.getItem('myName') || '';
  // プロジェクトごとにタスクをグループ化（階層構造）
  const groupedTasks = useMemo(() => {
    const groups: { 
      projectId: string | null; 
      projectName: string; 
      color: string; 
      project?: any; 
      tasks: (TaskExtractResult & { depth: number; hasChildren: boolean; rootIndex: number })[] 
    }[] = [];
    
    // 未承認タスク（isNew: true）は除外する
    const approvedTasks = tasks.filter(t => !t.isNew);
    let filteredTasks = showOnlyMine && myMemberId
      ? approvedTasks.filter(t => t.memberId === myMemberId)
      : approvedTasks;

    if (hideCompleted) {
      filteredTasks = filteredTasks.filter(t => t.status !== 'done');
    }

    const buildTreeList = (taskList: TaskExtractResult[]): (TaskExtractResult & { depth: number; hasChildren: boolean; rootIndex: number })[] => {
      const childrenMap = new Map<string, TaskExtractResult[]>();
      const rootTasks: TaskExtractResult[] = [];
      const taskIds = new Set(taskList.map(t => t.id));
      
      taskList.forEach(t => {
        if (t.parentId && taskIds.has(t.parentId)) {
          if (!childrenMap.has(t.parentId)) {
            childrenMap.set(t.parentId, []);
          }
          childrenMap.get(t.parentId)!.push(t);
        } else {
          rootTasks.push(t);
        }
      });
      
      const sortFn = (a: TaskExtractResult, b: TaskExtractResult) => {
        const aOrder = a.wbsOrder !== undefined ? a.wbsOrder : 9999;
        const bOrder = b.wbsOrder !== undefined ? b.wbsOrder : 9999;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.id.localeCompare(b.id);
      };
      
      rootTasks.sort(sortFn);
      childrenMap.forEach(list => list.sort(sortFn));
      
      const result: (TaskExtractResult & { depth: number; hasChildren: boolean; rootIndex: number })[] = [];
      const traverse = (task: TaskExtractResult, depth: number, rootIndex: number) => {
        const children = childrenMap.get(task.id) || [];
        const isCollapsed = collapsedTaskIds[task.id];
        result.push({
          ...task,
          depth,
          hasChildren: children.length > 0,
          rootIndex
        });
        if (!isCollapsed) {
          children.forEach(child => traverse(child, depth + 1, rootIndex));
        }
      };
      
      rootTasks.forEach((root, idx) => traverse(root, 0, idx));
      return result;
    };

    activeProjects.forEach(p => {
      const isProjectCollapsed = collapsedProjectIds[p.id || 'unassigned'];
      groups.push({
        projectId: p.id,
        projectName: p.name,
        color: p.color,
        project: p,
        tasks: isProjectCollapsed ? [] : buildTreeList(filteredTasks.filter(t => t.projectId === p.id))
      });
    });
 
    const noProjectTasks = filteredTasks.filter(t => !t.projectId);
    if (noProjectTasks.length > 0) {
      const isProjectCollapsed = collapsedProjectIds['unassigned'];
      groups.push({
        projectId: null,
        projectName: '未分類',
        color: 'var(--text-muted)',
        tasks: isProjectCollapsed ? [] : buildTreeList(noProjectTasks)
      });
    }
 
    return groups;
  }, [tasks, activeProjects, showOnlyMine, hideCompleted, myMemberId, collapsedTaskIds, collapsedProjectIds]);
  // WBSドラッグ＆ドロップハンドラ
  const handleWbsDragEnd = (result: DropResult, projectId: string | null) => {

    const { destination, source } = result;
    if (!destination) return;
    if (destination.index === source.index) return;

    // 1. プロジェクトに属する全タスクを取得
    const projectTasks = tasks.filter(t => t.projectId === projectId);
    
    // 2. 表示されている（折りたたまれていない）タスクのリストを取得
    const group = groupedTasks.find(g => g.projectId === projectId);
    if (!group) return;
    const visibleTasks = group.tasks;
    
    const draggedTask = visibleTasks[source.index];
    if (!draggedTask) return;
    
    const destTask = visibleTasks[destination.index];
    if (!destTask) return;

    // 3. ツリー構造のノード型を定義して構築
    interface TreeNode {
      id: string;
      task: TaskExtractResult;
      children: TreeNode[];
    }

    const nodeMap = new Map<string, TreeNode>();
    projectTasks.forEach(t => {
      nodeMap.set(t.id, { id: t.id, task: t, children: [] });
    });

    const roots: TreeNode[] = [];
    projectTasks.forEach(t => {
      const node = nodeMap.get(t.id)!;
      if (t.parentId && nodeMap.has(t.parentId)) {
        nodeMap.get(t.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    // WBS順序でソートするヘルパー
    const sortNodes = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => {
        const aOrder = a.task.wbsOrder !== undefined ? a.task.wbsOrder : 9999;
        const bOrder = b.task.wbsOrder !== undefined ? b.task.wbsOrder : 9999;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.id.localeCompare(b.id);
      });
      nodes.forEach(n => sortNodes(n.children));
    };
    sortNodes(roots);

    // 4. ドラッグ対象ノードの兄弟（シブリング）リストを特定
    let siblings: TreeNode[] = [];
    if (draggedTask.parentId && nodeMap.has(draggedTask.parentId)) {
      siblings = nodeMap.get(draggedTask.parentId)!.children;
    } else {
      siblings = roots;
    }

    const sourceSiblingIdx = siblings.findIndex(n => n.id === draggedTask.id);
    if (sourceSiblingIdx === -1) return;

    // 5. ターゲットタスクが含まれる兄弟ノード（またはその子孫）を特定
    const isDescendantOfNode = (node: TreeNode, targetId: string): boolean => {
      if (node.id === targetId) return true;
      return node.children.some(c => isDescendantOfNode(c, targetId));
    };

    let destSiblingIdx = siblings.findIndex(sib => isDescendantOfNode(sib, destTask.id));

    // ドラッグ範囲外（親が異なる場所）へドロップしようとした場合は、現在の階層の境界にクランプする
    if (destSiblingIdx === -1) {
      if (destination.index < source.index) {
        destSiblingIdx = 0;
      } else {
        destSiblingIdx = siblings.length - 1;
      }
    }

    // 6. 兄弟リスト内で並び替えを実行
    const [movedNode] = siblings.splice(sourceSiblingIdx, 1);
    siblings.splice(destSiblingIdx, 0, movedNode);

    // 7. 深さ優先探索（DFS）で新しい wbsOrder を付与してID順序をフラット化
    const orderedIds: string[] = [];
    const traverse = (node: TreeNode) => {
      orderedIds.push(node.id);
      node.children.forEach(traverse);
    };
    roots.forEach(traverse);

    // 8. 状態更新
    reorderTasks(orderedIds);
  };

  // ================= ドラッグ＆ドロップ =================
  const handlePointerDown = (e: React.PointerEvent, taskId: string, type: 'move' | 'resize-left' | 'resize-right') => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const task = tasks.find(t => t.id === taskId);
    if (!task || !task.startDate || !task.dueDate) return;
    
    isDraggingRef.current = false;
    setDraggingTaskId(taskId);
    setDragType(type);
    setDragStartX(e.clientX);
    setInitialTaskDates({ start: task.startDate, due: task.dueDate });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingTaskId || !dragType || !initialTaskDates) return;
    
    const deltaX = e.clientX - dragStartX;
    if (Math.abs(deltaX) > 2) {
      isDraggingRef.current = true;
    }
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
              checked={hideClosedProjects} 
              onChange={e => {
                setHideClosedProjects(e.target.checked);
                localStorage.setItem('scheduler_hideClosedProjects', String(e.target.checked));
              }} 
              style={{ width: '16px', height: '16px' }}
            />
            クローズ済みのPJを非表示
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 500 }}>
            <input 
              type="checkbox" 
              checked={hideCompleted} 
              onChange={e => {
                setHideCompleted(e.target.checked);
                localStorage.setItem('scheduler_hideCompleted', String(e.target.checked));
              }} 
              style={{ width: '16px', height: '16px' }}
            />
            完了済みのタスクを非表示
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 500 }}>
            <input 
              type="checkbox" 
              checked={showOnlyMine} 
              onChange={e => {
                setShowOnlyMine(e.target.checked);
                localStorage.setItem('scheduler_showOnlyMine', String(e.target.checked));
              }} 
              disabled={!myMemberId}
              style={{ width: '16px', height: '16px' }}
            />
            自分のタスクのみ表示 {(!myMemberId) && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>(設定から名前を登録してください)</span>}
          </label>
        </div>
      </div>

      <div className="glass-panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', position: 'relative' }}>
          
          {/* 左側: タスクリスト（独立した垂直スクロールのみ） */}
          <div style={{ width: `${leftColumnWidth}px`, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-main)', borderRight: '1px solid var(--border-color)', position: 'relative' }}>
            {/* 左側ヘッダー */}
            <div style={{ height: '60px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', padding: '0 1rem', background: 'var(--bg-main)', flexShrink: 0 }}>
              <span style={{ fontWeight: 'bold' }}>プロジェクト / タスク</span>
            </div>

            {/* Excel風ドラッグリサイズハンドル */}
            <div 
              onPointerDown={handleResizeStart}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
              style={{
                position: 'absolute',
                top: 0,
                right: '-3px',
                bottom: 0,
                width: '6px',
                cursor: 'col-resize',
                zIndex: 35,
                background: isResizing ? 'var(--accent-primary)' : 'transparent',
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => {
                if (!isResizing) e.currentTarget.style.background = 'rgba(99, 102, 241, 0.4)';
              }}
              onMouseLeave={e => {
                if (!isResizing) e.currentTarget.style.background = 'transparent';
              }}
            />

            {/* スクロール可能なタスクリスト領域（垂直のみ、水平スクロールなし） */}
            <div ref={leftScrollRef} onScroll={handleLeftPanelScroll} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
              {groupedTasks.map(group => {
                const isProjectCollapsed = collapsedProjectIds[group.projectId || 'unassigned'];
                const projectIndex = group.projectId ? activeProjects.findIndex(p => p.id === group.projectId) : -1;
                const isFirst = projectIndex === 0;
                const isLast = projectIndex === activeProjects.length - 1;

                return (
                  <div key={group.projectId || 'unassigned'}>
                    <div 
                      onClick={() => {
                        const key = group.projectId || 'unassigned';
                        toggleSavedCollapseState(COLLAPSED_PROJECTS_STORAGE_KEY, key, setCollapsedProjectIds);
                      }}
                      style={{ 
                        ...styles.projectHeader, 
                        borderLeft: `4px solid ${group.color}`,
                        cursor: 'pointer',
                        userSelect: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingRight: '0.5rem'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {isProjectCollapsed ? (
                          <ChevronRight size={14} style={{ color: 'var(--text-secondary)' }} />
                        ) : (
                          <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} />
                        )}
                        <FolderKanban size={16} />
                        <span>{group.projectName}</span>
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
                  
                  <DragDropContext onDragEnd={(result) => handleWbsDragEnd(result, group.projectId)}>
                    <Droppable droppableId={`wbs-list-${group.projectId || 'unassigned'}`}>
                      {(provided) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          style={{ display: 'flex', flexDirection: 'column' }}
                        >
                          {group.tasks.map((task: any, index) => (
                            <Draggable key={task.id} draggableId={task.id} index={index}>
                              {(provided, snapshot) => {
                                const isAlt = task.rootIndex % 2 === 1;
                                const baseBg = isAlt ? 'rgba(255,255,255,0.025)' : 'transparent';
                                const rowBg = snapshot.isDragging ? 'var(--bg-card, #1a1a24)' : baseBg;
                                const borderTop = task.depth === 0 ? '1px solid rgba(255,255,255,0.08)' : undefined;
                                
                                const rowElement = (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                    style={{
                                      ...styles.taskRowLeft,
                                      position: 'relative',
                                      ...provided.draggableProps.style,
                                      paddingLeft: `${task.depth * 20 + 16}px`,
                                      transform: snapshot.isDragging ? provided.draggableProps.style?.transform : 'translate(0, 0)',
                                      background: rowBg,
                                      borderTop: borderTop,
                                      width: snapshot.isDragging ? `${leftColumnWidth - 10}px` : (provided.draggableProps.style as any)?.width || '100%',
                                      border: snapshot.isDragging ? '1px solid var(--accent-primary)' : (borderTop ? `1px solid transparent` : undefined), // Keep height stable
                                      borderTopColor: borderTop ? 'rgba(255,255,255,0.08)' : undefined,
                                      borderRadius: snapshot.isDragging ? '6px' : undefined,
                                      boxShadow: snapshot.isDragging ? '0 10px 20px rgba(0,0,0,0.5)' : undefined,
                                      zIndex: snapshot.isDragging ? 9999 : undefined
                                    }}
                                    onClick={() => setEditingTaskId(task.id)}
                                  >
                                    {/* 階層ガイド接続線の描画 */}
                                    {Array.from({ length: task.depth }).map((_, i) => {
                                      const lineLeft = i * 20 + 20;
                                      const isLast = i === task.depth - 1;
                                      return (
                                        <div key={i} style={{
                                          position: 'absolute',
                                          left: `${lineLeft}px`,
                                          top: 0,
                                          bottom: 0,
                                          width: '20px',
                                          pointerEvents: 'none'
                                        }}>
                                          <div style={{
                                            position: 'absolute',
                                            left: '0px',
                                            top: 0,
                                            bottom: isLast ? '50%' : 0,
                                            borderLeft: '1px dashed rgba(255,255,255,0.2)'
                                          }} />
                                          {isLast && (
                                            <div style={{
                                              position: 'absolute',
                                              left: '0px',
                                              top: '50%',
                                              width: '10px',
                                              borderTop: '1px dashed rgba(255,255,255,0.2)'
                                            }} />
                                          )}
                                        </div>
                                      );
                                    })}

                                    <GripVertical size={14} style={{ color: 'var(--text-muted)', cursor: 'grab', marginRight: '-0.25rem' }} />
                                    
                                    {/* 折りたたみボタン */}
                                    {task.hasChildren ? (
                                      <div 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleSavedCollapseState(COLLAPSED_TASKS_STORAGE_KEY, task.id, setCollapsedTaskIds);
                                        }}
                                        style={{
                                          cursor: 'pointer',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          width: '16px',
                                          height: '16px',
                                          color: 'var(--text-secondary)',
                                          zIndex: 10
                                        }}
                                      >
                                        {collapsedTaskIds[task.id] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                      </div>
                                    ) : (
                                      <div style={{ width: '16px' }} />
                                    )}

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
                );
              })}
            </div>
          </div>

          {/* 右側: ガントチャート (タイムライン) - 独立した水平・垂直スクロール */}
          <div ref={rightScrollRef} onScroll={handleRightPanelScroll} style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ minWidth: 'max-content' }}>
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
              <div key={`timeline-group-${group.projectId || 'unassigned'}`} style={{ position: 'relative' }}>
                {/* SVG 接続線レイヤー */}
                <svg 
                  style={{ 
                    position: 'absolute', 
                    top: 0, 
                    left: 0, 
                    width: `${days.length * DAY_WIDTH}px`, 
                    height: `${(group.tasks.length + 1) * 36}px`, 
                    pointerEvents: 'none', 
                    zIndex: 1 
                  }}
                >
                  {group.tasks.map((task, idx) => {
                    if (!task.parentId || !task.startDate || !task.dueDate) return null;
                    
                    const parentIdx = group.tasks.findIndex(t => t.id === task.parentId);
                    if (parentIdx === -1) return null;
                    const parentTask = group.tasks[parentIdx];
                    if (!parentTask.startDate || !parentTask.dueDate) return null;
                    
                    const parentOffsetDays = diffDays(minDate, parentTask.startDate);
                    const childOffsetDays = diffDays(minDate, task.startDate);
                    
                    const parentStartX = parentOffsetDays * DAY_WIDTH;
                    const x1 = parentStartX;
                    const y1 = (parentIdx + 1) * 36 + 18; // block left vertical center Y
                    
                    const x2 = childOffsetDays * DAY_WIDTH; // childStartX
                    const y2 = (idx + 1) * 36 + 18; // block left vertical center Y
                    
                    // Rounded elbow (kagi) line math
                    const R = 8; // corner radius
                    const verticalDist = y2 - y1;
                    const horizDist = Math.abs(x2 - x1);
                    const r = Math.min(R, horizDist, verticalDist);
                    const dx = x2 > x1 ? 1 : -1;
                    
                    const pathD = `M ${x1} ${y1} L ${x1} ${y2 - r} Q ${x1} ${y2} ${x1 + dx * r} ${y2} L ${x2} ${y2}`;

                    return (
                      <g key={`edge-${task.id}`}>
                        <path
                          d={pathD}
                          fill="none"
                          stroke={group.color}
                          strokeWidth="1.5"
                          strokeDasharray="4,4"
                          opacity="0.6"
                        />
                        <circle
                          cx={x1}
                          cy={y1}
                          r="3"
                          fill={group.color}
                          opacity="0.9"
                        />
                        <circle
                          cx={x2}
                          cy={y2}
                          r="3"
                          fill={group.color}
                          opacity="0.9"
                        />
                      </g>
                    );
                  })}
                </svg>
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
                  const isAlt = task.rootIndex % 2 === 1;
                  const baseBg = isAlt ? 'rgba(255,255,255,0.025)' : 'transparent';
                  const borderTop = task.depth === 0 ? '1px solid rgba(255,255,255,0.08)' : '1px solid transparent';
                  
                  if (!task.startDate || !task.dueDate) {
                    return (
                      <div key={`timeline-task-${task.id}`} style={{ ...styles.taskRowRight, background: baseBg, borderTop }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', paddingLeft: '8px' }}>日程未設定</span>
                      </div>
                    );
                  }

                  const offsetDays = diffDays(minDate, task.startDate);
                  const durationDays = diffDays(task.startDate, task.dueDate) + 1; // 1日も含める
                  const progress = task.progress || 0;

                  return (
                    <div key={`timeline-task-${task.id}`} style={{ ...styles.taskRowRight, background: baseBg, borderTop }}>
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
                          onClick={() => {
                            if (isDraggingRef.current) {
                              isDraggingRef.current = false;
                              return;
                            }
                            setEditingTaskId(task.id);
                          }}
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
