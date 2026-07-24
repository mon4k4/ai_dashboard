import { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Users, FolderTree, Filter, Download, GripVertical, Edit3, CornerUpLeft } from 'lucide-react';
import { useAppContext } from '../store/AppContext';
import TaskEditModal from '../components/TaskEditModal';
import type { TaskExtractResult } from '../services/llmService';
import './WBS.css';

interface TaskNode {
  task: TaskExtractResult;
  children: TaskNode[];
}

export default function WBS() {
  const { tasks, projects, members, settings, addTask, updateTask, deleteTask } = useAppContext();
  
  // クローズ済みのプロジェクト非表示設定
  const [hideClosedProjects, setHideClosedProjects] = useState(() => {
    return localStorage.getItem('wbs_hideClosedProjects') === 'true';
  });

  const activeProjects = useMemo(() => {
    return hideClosedProjects ? projects.filter(p => !p.isClosed) : projects;
  }, [projects, hideClosedProjects]);

  // アクティブなプロジェクトID
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
    const initialHide = localStorage.getItem('wbs_hideClosedProjects') === 'true';
    const list = initialHide ? projects.filter(p => !p.isClosed) : projects;
    if (list.length > 0) {
      return list[0].id;
    }
    return null;
  });
  const hasUserSelectedProject = useRef(false);

  // 子タスクの折りたたみ状態 (localStorageに保存)
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('wbsCollapsedTaskIds');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // 詳細編集中のタスクID
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState('');

  // フィルター状態 (localStorageに保存)
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(() => {
    return localStorage.getItem('wbs_showIncompleteOnly') === 'true';
  });
  const [filterMemberId, setFilterMemberId] = useState<string>('');

  // ドラッグ＆ドロップ用ステート（UI表示用）
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);

  // Refs（同期的にドラッグ状態を追跡 — React state のバッチ更新遅延を回避）
  const draggedTaskIdRef = useRef<string | null>(null);
  const draggedCardIdRef = useRef<string | null>(null);

  // 各プロジェクト内でのカード順序
  const [cardOrder, setCardOrder] = useState<string[]>([]);

  // プロジェクト一覧に変化があった場合の安全なフォールバック
  useEffect(() => {
    if (!hasUserSelectedProject.current && activeProjectId === null && activeProjects.length > 0) {
      setActiveProjectId(activeProjects[0].id);
      return;
    }

    if (activeProjectId && !activeProjects.some(p => p.id === activeProjectId) && activeProjectId !== 'unassigned') {
      if (activeProjects.length > 0) {
        setActiveProjectId(activeProjects[0].id);
      } else {
        setActiveProjectId(null);
      }
    }
  }, [activeProjects, activeProjectId]);

  // プロジェクト切り替え時にカード順序を復元
  useEffect(() => {
    if (activeProjectId) {
      const saved = localStorage.getItem(`wbs_card_order_${activeProjectId}`);
      if (saved) {
        try { setCardOrder(JSON.parse(saved)); } catch (e) { setCardOrder([]); }
      } else {
        setCardOrder([]);
      }
    }
  }, [activeProjectId]);

  // 子タスク折りたたみトグルのヘルパー
  const toggleCollapse = (taskId: string) => {
    setCollapsedTaskIds(prev => {
      const next = { ...prev, [taskId]: !prev[taskId] };
      localStorage.setItem('wbsCollapsedTaskIds', JSON.stringify(next));
      return next;
    });
  };

  // 最上位の親グループタスク（カード）の新規追加
  const handleAddGroup = () => {
    if (!activeProjectId) {
      alert('プロジェクトを選択してください。');
      return;
    }
    const newGroupId = `task-group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // プロジェクトの最初の担当者をデフォルトにする
    let defaultAssignee = '';
    let defaultMemberId = '';
    
    const activeProj = projects.find(p => p.id === activeProjectId);
    if (activeProj?.stakeholders && activeProj.stakeholders.length > 0) {
      const firstMember = members.find(m => m.id === activeProj.stakeholders![0]);
      if (firstMember) {
        defaultAssignee = firstMember.name;
        defaultMemberId = firstMember.id;
      }
    }

    addTask({
      id: newGroupId,
      title: '新しいグループ',
      status: 'todo',
      projectId: activeProjectId,
      assignee: defaultAssignee,
      memberId: defaultMemberId || undefined,
      progress: 0,
      isNew: false,
      isGroup: true // 親グループとして定義
    });
  };

  // 親グループまたは子タスク内へ新規タスク（子タスク）を追加
  const handleAddChild = (parentTask: TaskExtractResult) => {
    const newChildId = `task-child-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    addTask({
      id: newChildId,
      title: '新しいタスク',
      status: 'todo',
      projectId: parentTask.projectId,
      parentId: parentTask.id,
      assignee: parentTask.assignee || '',
      memberId: parentTask.memberId || undefined,
      progress: 0,
      isNew: false
    });

    // 親を展開状態にする
    if (collapsedTaskIds[parentTask.id]) {
      setCollapsedTaskIds(prev => {
        const next = { ...prev, [parentTask.id]: false };
        localStorage.setItem('wbsCollapsedTaskIds', JSON.stringify(next));
        return next;
      });
    }
  };

  // その他タスク用の新規タスク追加
  const handleAddUnparentedTask = () => {
    if (!activeProjectId) return;
    const newTaskId = `task-manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    addTask({
      id: newTaskId,
      title: '新しいタスク',
      status: 'todo',
      projectId: activeProjectId,
      assignee: '',
      progress: 0,
      isNew: false
    });
  };

  // Excel出力
  const handleExportExcel = async () => {
    setIsExportingExcel(true);
    setExportMessage('');
    setExportError('');

    try {
      const res = await fetch('/api/wbs/export-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          tasks,
          projects,
          members,
          outputDir: settings.wbsExcelOutputDir || './exports',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Excel出力に失敗しました');
      }
      setExportMessage(`Excel出力しました: ${data.filePath}`);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Excel出力に失敗しました');
    } finally {
      setIsExportingExcel(false);
    }
  };

  // 循環参照チェック (parentTaskId が childTaskId の子孫でないことを保証)
  const isDescendant = (parentTaskId: string, childTaskId: string | undefined): boolean => {
    if (!childTaskId) return false;
    let current = tasks.find(t => t.id === childTaskId);
    while (current) {
      if (current.parentId === parentTaskId) return true;
      const nextParentId = current.parentId;
      current = nextParentId ? tasks.find(t => t.id === nextParentId) : undefined;
    }
    return false;
  };

  // 承認済みタスクのみをフィルタリング
  const approvedTasks = useMemo(() => tasks.filter(t => !t.isNew), [tasks]);

  // フィルター条件にマッチするタスク
  const filteredTasks = useMemo(() => {
    const projectFiltered = approvedTasks.filter(t => {
      if (activeProjectId === null) {
        return !t.projectId;
      }
      return t.projectId === activeProjectId;
    });

    if (!showIncompleteOnly && !filterMemberId) {
      return projectFiltered;
    }

    const directMatchIds = new Set<string>();
    projectFiltered.forEach(t => {
      let matches = true;
      if (showIncompleteOnly && t.status === 'done') matches = false;
      if (filterMemberId && t.memberId !== filterMemberId) matches = false;
      if (matches) directMatchIds.add(t.id);
    });

    // フィルタマッチしたタスクの親・先祖もツリーとして表示させるために抽出
    const taskById = new Map(projectFiltered.map(t => [t.id, t]));
    const visibleIds = new Set(directMatchIds);
    directMatchIds.forEach(id => {
      let current = taskById.get(id);
      while (current?.parentId && taskById.has(current.parentId)) {
        visibleIds.add(current.parentId);
        current = taskById.get(current.parentId);
      }
    });

    return projectFiltered.filter(t => visibleIds.has(t.id));
  }, [approvedTasks, activeProjectId, showIncompleteOnly, filterMemberId]);

  // 担当メンバー一覧
  const currentProjectMembers = useMemo(() => {
    if (!activeProjectId) return members;
    const activeProj = projects.find(p => p.id === activeProjectId);
    if (activeProj?.stakeholders && activeProj.stakeholders.length > 0) {
      return members.filter(m => activeProj.stakeholders!.includes(m.id));
    }
    return members;
  }, [members, projects, activeProjectId]);

  // 親グループタスク (isGroup: true または子タスクがある最上位タスク、またはタイトルが【】で囲まれている) の抽出
  // ※ parentId を持つものは別のグループ配下なのでカードとしては表示しない
  const groupTasks = useMemo(() => {
    return filteredTasks.filter(t => {
      if (t.parentId) return false; // 他のグループの子になっているものはカードとして表示しない
      return (t.title && t.title.startsWith('【') && t.title.endsWith('】')) || !!t.isGroup || filteredTasks.some(c => c.parentId === t.id);
    });
  }, [filteredTasks]);

  // その他タスク (親グループ以外の最上位タスク)
  const otherTasks = useMemo(() => {
    return filteredTasks.filter(t => {
      if (t.parentId) return false;
      if (t.title && t.title.startsWith('【') && t.title.endsWith('】')) return false;
      return !t.isGroup && !filteredTasks.some(c => c.parentId === t.id);
    });
  }, [filteredTasks]);

  // 再帰的に全子孫タスクを取得するヘルパー
  const getAllDescendants = (rootId: string): TaskExtractResult[] => {
    const result: TaskExtractResult[] = [];
    const collect = (parentId: string) => {
      filteredTasks.filter(t => t.parentId === parentId).forEach(child => {
        result.push(child);
        collect(child.id);
      });
    };
    collect(rootId);
    return result;
  };

  // タスクの階層ツリー構築用
  const buildTree = (taskList: TaskExtractResult[]): TaskNode[] => {
    const taskMap = new Map<string, TaskNode>();
    taskList.forEach(t => {
      taskMap.set(t.id, { task: t, children: [] });
    });

    const roots: TaskNode[] = [];
    taskList.forEach(t => {
      const node = taskMap.get(t.id)!;
      if (t.parentId && taskMap.has(t.parentId)) {
        taskMap.get(t.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    const sortTree = (nodes: TaskNode[]) => {
      nodes.sort((a, b) => {
        const orderA = a.task.wbsOrder ?? 999999;
        const orderB = b.task.wbsOrder ?? 999999;
        if (orderA !== orderB) return orderA - orderB;
        return a.task.id.localeCompare(b.task.id);
      });
      nodes.forEach(n => sortTree(n.children));
    };

    sortTree(roots);
    return roots;
  };

  // ドラッグ＆ドロップ：グループカードの並び替えハンドラー
  const handleCardDragStart = (e: React.DragEvent, cardId: string) => {
    e.stopPropagation();
    draggedCardIdRef.current = cardId;
    setDraggedCardId(cardId);
    e.dataTransfer.setData('text/card-id', cardId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleCardDragOver = (e: React.DragEvent, cardId: string) => {
    if (draggedCardIdRef.current && draggedCardIdRef.current !== cardId) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDragOverCardId(cardId);
    }
  };

  const handleCardDrop = (e: React.DragEvent, targetCardId: string) => {
    e.preventDefault();
    const sourceCardId = draggedCardIdRef.current || e.dataTransfer.getData('text/card-id');
    if (sourceCardId && activeProjectId) {
      if (targetCardId === 'other-tasks') {
        // グループカードを「その他タスク」にドロップ → 通常タスクに戻す
        updateTask(sourceCardId, { isGroup: false, parentId: undefined });
        setCardOrder(prev => prev.filter(id => id !== sourceCardId));
        const saved = localStorage.getItem(`wbs_card_order_${activeProjectId}`);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            localStorage.setItem(`wbs_card_order_${activeProjectId}`, JSON.stringify(parsed.filter((id: string) => id !== sourceCardId)));
          } catch (err) {}
        }
        draggedCardIdRef.current = null;
        setDraggedCardId(null);
        setDragOverCardId(null);
        return;
      }

      if (sourceCardId !== targetCardId) {
        const allCardIds = [
          ...groupTasks.map(gt => gt.id),
          'other-tasks'
        ];
        
        const currentOrder = cardOrder.length > 0 
          ? [...cardOrder.filter(id => allCardIds.includes(id)), ...allCardIds.filter(id => !cardOrder.includes(id))]
          : allCardIds;

        const fromIdx = currentOrder.indexOf(sourceCardId);
        const toIdx = currentOrder.indexOf(targetCardId);

        if (fromIdx !== -1 && toIdx !== -1) {
          const newOrder = [...currentOrder];
          const [removed] = newOrder.splice(fromIdx, 1);
          newOrder.splice(toIdx, 0, removed);
          
          setCardOrder(newOrder);
          localStorage.setItem(`wbs_card_order_${activeProjectId}`, JSON.stringify(newOrder));
        }
      }
    }
    draggedCardIdRef.current = null;
    setDraggedCardId(null);
    setDragOverCardId(null);
  };

  // ドラッグ＆ドロップ：タスクのドラッグハンドラー
  const handleTaskDragStart = (e: React.DragEvent, taskId: string) => {
    e.stopPropagation();
    draggedTaskIdRef.current = taskId;
    setDraggedTaskId(taskId);
    e.dataTransfer.setData('text/task-id', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleTaskDragOver = (e: React.DragEvent, taskId: string) => {
    if (draggedTaskIdRef.current && draggedTaskIdRef.current !== taskId) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDragOverTaskId(taskId);
    }
  };

  const handleTaskDrop = (e: React.DragEvent, targetTaskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceTaskId = draggedTaskIdRef.current || e.dataTransfer.getData('text/task-id');
    if (sourceTaskId && sourceTaskId !== targetTaskId) {
      // 循環参照チェック
      if (isDescendant(sourceTaskId, targetTaskId)) {
        alert('タスクを自分自身や自分の子タスクの配下へ移動することはできません。');
        draggedTaskIdRef.current = null;
        setDragOverTaskId(null);
        setDraggedTaskId(null);
        return;
      }

      const sourceTask = tasks.find(t => t.id === sourceTaskId);
      const targetTask = tasks.find(t => t.id === targetTaskId);

      // 同じ親を持つ場合は入れ子ではなく「順序入れ替え」を行う
      if (sourceTask && targetTask && sourceTask.parentId === targetTask.parentId) {
        const siblings = tasks.filter(t => t.parentId === targetTask.parentId && t.projectId === targetTask.projectId && !t.isGroup);
        siblings.sort((a, b) => (a.wbsOrder ?? 999999) - (b.wbsOrder ?? 999999));
        const srcIdx = siblings.findIndex(t => t.id === sourceTaskId);
        const tgtIdx = siblings.findIndex(t => t.id === targetTaskId);
        if (srcIdx !== -1 && tgtIdx !== -1) {
          const reordered = [...siblings];
          const [moved] = reordered.splice(srcIdx, 1);
          reordered.splice(tgtIdx, 0, moved);
          reordered.forEach((t, i) => updateTask(t.id, { wbsOrder: i }));
        }
      } else {
        // 異なる親の場合は入れ子（子タスクとして移動）
        updateTask(sourceTaskId, { parentId: targetTaskId });
      }
    }
    draggedTaskIdRef.current = null;
    setDraggedTaskId(null);
    setDragOverTaskId(null);
  };

  // カードボディー（またはヘッダー）へのタスク/グループドロップハンドラー
  const handleTaskDropOnCard = (e: React.DragEvent, cardId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // グループカードがドロップされた場合（グループ→グループのネスト）
    const sourceCardId = draggedCardIdRef.current || e.dataTransfer.getData('text/card-id');
    if (sourceCardId && sourceCardId !== cardId && cardId !== 'other-tasks') {
      // 循環参照チェック
      if (isDescendant(sourceCardId, cardId)) {
        alert('タスクを自分自身の配下へ移動することはできません。');
      } else {
        updateTask(sourceCardId, { parentId: cardId });
        // カード順序からも除外
        setCardOrder(prev => prev.filter(id => id !== sourceCardId));
        if (activeProjectId) {
          const saved = localStorage.getItem(`wbs_card_order_${activeProjectId}`);
          if (saved) {
            try {
              const parsed = JSON.parse(saved);
              localStorage.setItem(`wbs_card_order_${activeProjectId}`, JSON.stringify(parsed.filter((id: string) => id !== sourceCardId)));
            } catch (err) {}
          }
        }
        // 折りたたまれていたら展開
        if (collapsedTaskIds[cardId]) {
          toggleCollapse(cardId);
        }
      }
      draggedCardIdRef.current = null;
      setDraggedCardId(null);
      setDragOverCardId(null);
      return;
    }
    
    // タスクがドロップされた場合
    const sourceTaskId = draggedTaskIdRef.current || e.dataTransfer.getData('text/task-id');
    if (sourceTaskId) {
      if (cardId === 'other-tasks') {
        // その他カードにドロップ -> 最上位かつグループフラグオフ
        updateTask(sourceTaskId, { parentId: undefined, isGroup: false });
      } else {
        // 特定グループにドロップ -> その親グループ配下に設定
        if (sourceTaskId === cardId || isDescendant(sourceTaskId, cardId)) {
          alert('タスクを自分自身の配下へ移動することはできません。');
          draggedTaskIdRef.current = null;
          setDragOverCardId(null);
          setDraggedTaskId(null);
          return;
        }
        updateTask(sourceTaskId, { parentId: cardId, isGroup: false });
      }
    }
    draggedTaskIdRef.current = null;
    setDraggedTaskId(null);
    setDragOverCardId(null);
    setDragOverTaskId(null);
  };

  const handleTaskDragOverCard = (e: React.DragEvent, cardId: string) => {
    if (draggedTaskIdRef.current || draggedCardIdRef.current) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDragOverCardId(cardId);
    }
  };

  // タスクをカード外（コンテナ領域）にドロップ → 親タスク（グループ）に昇格
  const handleTaskDropOnContainer = (e: React.DragEvent) => {
    e.preventDefault();
    const sourceTaskId = draggedTaskIdRef.current || e.dataTransfer.getData('text/task-id');
    if (sourceTaskId) {
      const task = tasks.find(t => t.id === sourceTaskId);
      if (task && !task.isGroup) {
        updateTask(sourceTaskId, { parentId: undefined, isGroup: true });
      }
    }
    draggedTaskIdRef.current = null;
    setDraggedTaskId(null);
    setDragOverTaskId(null);
    setDragOverCardId(null);
  };

  const handleTaskDragOverContainer = (e: React.DragEvent) => {
    if (draggedTaskIdRef.current) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };

  // ドラッグ終了時の後処理（キャンセル時など用）
  const handleTaskDragEnd = () => {
    draggedTaskIdRef.current = null;
    setDraggedTaskId(null);
    setDragOverTaskId(null);
    setDragOverCardId(null);
  };

  // ソートされたカード一覧の取得
  const sortedCards = useMemo(() => {
    const allCards = [
      ...groupTasks.map(gt => ({ id: gt.id, type: 'group' as const, task: gt })),
      { id: 'other-tasks', type: 'other' as const, title: 'その他タスク' }
    ];

    if (cardOrder.length === 0) return allCards;

    const cardMap = new Map(allCards.map(c => [c.id, c]));
    const ordered = cardOrder
      .map(id => cardMap.get(id))
      .filter((c): c is typeof allCards[number] => !!c);

    const remaining = allCards.filter(c => !cardOrder.includes(c.id));
    return [...ordered, ...remaining];
  }, [groupTasks, cardOrder]);

  // 再帰的なタスク項目の描画
  const renderTaskNode = (node: TaskNode, depth: number = 0): React.ReactNode => {
    const { task, children } = node;
    const hasChildren = children.length > 0;
    const isCollapsed = !!collapsedTaskIds[task.id];

    return (
      <div key={task.id} className="wbs-card-task-row">
        <div 
          className={`wbs-card-task-item ${draggedTaskId === task.id ? 'dragging-task' : ''} ${dragOverTaskId === task.id ? 'drag-over-task' : ''}`}
          draggable
          onDragStart={(e) => handleTaskDragStart(e, task.id)}
          onDragOver={(e) => handleTaskDragOver(e, task.id)}
          onDragLeave={() => setDragOverTaskId(null)}
          onDrop={(e) => handleTaskDrop(e, task.id)}
          onDragEnd={handleTaskDragEnd}
        >
          <div className="wbs-task-left">
            <span className="wbs-task-drag-grip"><GripVertical size={13} /></span>
            
            {hasChildren && (
              <span className="wbs-collapse-arrow" onClick={(e) => { e.stopPropagation(); toggleCollapse(task.id); }}>
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </span>
            )}
            <span className="wbs-task-title-text" onClick={() => setEditingTaskId(task.id)} title="クリックして詳細編集">
              {task.title || '無題のタスク'}
            </span>
          </div>

          <div className="wbs-task-right">
            <span className={`wbs-status-badge ${task.status}`}>
              {task.status === 'todo' ? 'To Do' : task.status === 'in-progress' ? 'In Progress' : 'Done'}
            </span>
            
            {task.parentId && (
              <button
                className="wbs-row-action-btn"
                onClick={(e) => { e.stopPropagation(); updateTask(task.id, { parentId: undefined }); }}
                title="親タスクから外す"
                style={{ color: 'var(--text-muted)' }}
              >
                <CornerUpLeft size={13} />
              </button>
            )}

            <button className="wbs-row-action-btn" onClick={(e) => { e.stopPropagation(); handleAddChild(task); }} title="子タスクを追加">
              <Plus size={14} />
            </button>
            
            <button className="wbs-row-action-btn delete" onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(`「${task.title}」を削除してもよろしいですか？\n（子タスクは親から切り離されます）`)) {
                deleteTask(task.id);
              }
            }} style={{ color: '#ef4444' }} title="タスクを削除">
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* 子タスクをインデントして再帰表示 */}
        {hasChildren && !isCollapsed && (
          <div className="wbs-nested-container">
            {children.map(child => renderTaskNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div 
      className="wbs-container"
      onDragOver={handleTaskDragOverContainer}
      onDrop={handleTaskDropOnContainer}
    >
      {/* ページヘッダー */}
      <div className="wbs-header">
        <div className="wbs-header-title">
          <div className="wbs-header-icon">
            <FolderTree size={20} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>タスク階層ビュー (WBS)</h2>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              3列のカードでグループ管理。タスクをドラッグ＆ドロップして階層化や移動を自在に行えます。
            </p>
          </div>
        </div>

        <div className="wbs-header-actions">
          <button
            className="btn-secondary wbs-export-btn"
            onClick={handleExportExcel}
            disabled={isExportingExcel || filteredTasks.length === 0}
          >
            <Download size={18} />
            <span>{isExportingExcel ? '出力中...' : '表示中プロジェクトをExcel出力'}</span>
          </button>
          <button className="btn-primary" onClick={handleAddGroup} disabled={!activeProjectId}>
            <Plus size={18} />
            <span>グループ（親タスク）を追加</span>
          </button>
        </div>
      </div>

      {(exportMessage || exportError) && (
        <div className={`wbs-export-status ${exportError ? 'is-error' : 'is-success'}`}>
          {exportError || exportMessage}
        </div>
      )}

      {/* プロジェクトタブ選択部 */}
      <div className="wbs-tab-container">
        {activeProjects.map(proj => {
          const isActive = activeProjectId === proj.id;
          return (
            <button
              key={proj.id}
              className="wbs-tab"
              onClick={() => {
                hasUserSelectedProject.current = true;
                setActiveProjectId(proj.id);
              }}
              style={{
                ...(isActive ? {
                  borderBottom: `3px solid ${proj.color || 'var(--accent-primary)'}`,
                  color: 'var(--text-primary)',
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                } : {}),
              }}
            >
              <span 
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: proj.color,
                  marginRight: '8px',
                  boxShadow: `0 0 8px ${proj.color}`
                }} 
              />
              {proj.name}
            </button>
          );
        })}
        <button
          key="unassigned"
          className="wbs-tab"
          onClick={() => {
            hasUserSelectedProject.current = true;
            setActiveProjectId(null);
          }}
          style={{
            ...(activeProjectId === null ? {
              borderBottom: `3px solid var(--text-muted)`,
              color: 'var(--text-primary)',
              backgroundColor: 'rgba(255, 255, 255, 0.04)',
            } : {}),
          }}
        >
          <span 
            style={{
              display: 'inline-block',
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: 'var(--text-muted)',
              marginRight: '8px',
            }} 
          />
          未分類
        </button>
      </div>

      {/* フィルターツールバー */}
      <div className="wbs-filter-toolbar">
        <div className="wbs-filter-group">
          <Filter size={14} className="wbs-filter-icon" />
          <label className="wbs-filter-toggle">
            <input
              type="checkbox"
              checked={showIncompleteOnly}
              onChange={e => {
                setShowIncompleteOnly(e.target.checked);
                localStorage.setItem('wbs_showIncompleteOnly', String(e.target.checked));
              }}
            />
            <span className="wbs-toggle-slider" />
            <span className="wbs-filter-label">未完了のみ</span>
          </label>
        </div>
        <div className="wbs-filter-group">
          <Filter size={14} className="wbs-filter-icon" />
          <label className="wbs-filter-toggle">
            <input
              type="checkbox"
              checked={hideClosedProjects}
              onChange={e => {
                setHideClosedProjects(e.target.checked);
                localStorage.setItem('wbs_hideClosedProjects', String(e.target.checked));
              }}
            />
            <span className="wbs-toggle-slider" />
            <span className="wbs-filter-label">クローズ済みPJ非表示</span>
          </label>
        </div>
        <div className="wbs-filter-group">
          <Users size={14} className="wbs-filter-icon" />
          <select
            className="wbs-filter-select"
            value={filterMemberId}
            onChange={e => setFilterMemberId(e.target.value)}
          >
            <option value="">すべての担当者</option>
            {currentProjectMembers.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        {(showIncompleteOnly || filterMemberId) && (
          <button
            className="wbs-filter-clear-btn"
            onClick={() => {
              setShowIncompleteOnly(false);
              localStorage.setItem('wbs_showIncompleteOnly', 'false');
              setFilterMemberId('');
            }}
          >
            フィルター解除
          </button>
        )}
      </div>

      {/* 3列カードレイアウト */}
      {activeProjectId === null ? (
        <div className="glass-panel wbs-tree-panel">
          <div className="wbs-empty-state">
            <FolderTree size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem', opacity: 0.6 }} />
            <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-secondary)' }}>未分類のタスク</h4>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              未分類タブではタスクをフラットに表示します。プロジェクトに属するタスクは、各プロジェクトのWBSカード画面でドラッグ階層化が可能です。
            </p>
          </div>
        </div>
      ) : (
        <div className="wbs-grid">
          {sortedCards.map(card => {
            const isDragOver = dragOverCardId === card.id;
            const isDragging = draggedCardId === card.id;

            if (card.type === 'group') {
              const groupTask = card.task!;
              const groupChildren = getAllDescendants(groupTask.id);
              const treeNodes = buildTree(groupChildren);

              return (
                <div 
                  key={card.id}
                  className={`wbs-group-card ${isDragging ? 'dragging-card' : ''} ${isDragOver ? 'drag-over-card' : ''}`}
                  onDragOver={(e) => handleTaskDragOverCard(e, card.id)}
                  onDragLeave={() => setDragOverCardId(null)}
                  onDrop={(e) => handleTaskDropOnCard(e, card.id)}
                >
                  {/* カードヘッダー */}
                  <div 
                    className="wbs-group-card-header"
                    draggable
                    onDragStart={(e) => handleCardDragStart(e, card.id)}
                    onDragOver={(e) => handleCardDragOver(e, card.id)}
                    onDrop={(e) => handleCardDrop(e, card.id)}
                  >
                    <input 
                      className="wbs-group-card-title-input"
                      value={groupTask.title}
                      onChange={e => updateTask(groupTask.id, { title: e.target.value })}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="wbs-group-card-actions">
                      <button className="wbs-card-action-btn" onClick={(e) => { e.stopPropagation(); toggleCollapse(groupTask.id); }} title="グループ内タスクを折りたたみ/展開">
                        {collapsedTaskIds[groupTask.id] ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      </button>
                      <button className="wbs-card-action-btn" onClick={() => setEditingTaskId(groupTask.id)} title="グループを編集">
                        <Edit3 size={15} />
                      </button>
                      <button className="wbs-card-action-btn" onClick={() => handleAddChild(groupTask)} title="このグループにタスクを追加">
                        <Plus size={16} />
                      </button>
                      <button className="wbs-card-action-btn delete" onClick={() => {
                        if (window.confirm(`グループ「${groupTask.title}」を削除してもよろしいですか？\n(配下のタスクは親から切り離されます)`)) {
                          deleteTask(groupTask.id);
                        }
                      }} title="グループを削除">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* カードボディ */}
                  {!collapsedTaskIds[groupTask.id] && (
                    <div className="wbs-group-card-body">
                      {treeNodes.length === 0 ? (
                        <div className="wbs-empty-card-state">
                          タスクがありません。<br/>右上の「+」ボタンから追加するか、他のタスクをここにドラッグしてください。
                        </div>
                      ) : (
                        treeNodes.map(node => renderTaskNode(node))
                      )}
                    </div>
                  )}
                </div>
              );
            } else {
              // その他タスクカード
              const otherChildren = otherTasks;
              const treeNodes = buildTree(otherChildren);

              return (
                <div 
                  key={card.id}
                  className={`wbs-group-card wbs-other-card ${isDragging ? 'dragging-card' : ''} ${isDragOver ? 'drag-over-card' : ''}`}
                  onDragOver={(e) => handleTaskDragOverCard(e, card.id)}
                  onDragLeave={() => setDragOverCardId(null)}
                  onDrop={(e) => handleTaskDropOnCard(e, card.id)}
                >
                  {/* カードヘッダー */}
                  <div 
                    className="wbs-group-card-header"
                    draggable
                    onDragStart={(e) => handleCardDragStart(e, card.id)}
                    onDragOver={(e) => handleCardDragOver(e, card.id)}
                    onDrop={(e) => handleCardDrop(e, card.id)}
                  >
                    <span className="wbs-other-card-title">{card.title}</span>
                    <div className="wbs-group-card-actions">
                      <button className="wbs-card-action-btn" onClick={handleAddUnparentedTask} title="タスクを新規追加">
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>

                  {/* カードボディ */}
                  <div className="wbs-group-card-body">
                    {treeNodes.length === 0 ? (
                      <div className="wbs-empty-card-state">
                        グループ未所属のタスクはありません。<br/>右上の「+」ボタンから追加するか、他のタスクをここにドラッグしてください。
                      </div>
                    ) : (
                      treeNodes.map(node => renderTaskNode(node))
                    )}
                  </div>
                </div>
              );
            }
          })}
        </div>
      )}

      {/* 詳細編集モーダル */}
      {editingTaskId && (
        <TaskEditModal taskId={editingTaskId} onClose={() => setEditingTaskId(null)} />
      )}
    </div>
  );
}
