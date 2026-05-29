import { useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, Edit2, ChevronDown, Calendar, Users, FolderTree, Filter } from 'lucide-react';
import { useAppContext } from '../store/AppContext';
import TaskEditModal from '../components/TaskEditModal';
import type { TaskExtractResult } from '../services/llmService';
import './WBS.css';

interface TaskNode {
  task: TaskExtractResult;
  children: TaskNode[];
}

export default function WBS() {
  const { tasks, projects, members, addTask, updateTask, deleteTask } = useAppContext();
  
  // アクティブなプロジェクトID
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
    if (projects.length > 0) {
      return projects[0].id;
    }
    return null;
  });

  // 折りたたみ状態 (localStorageに保存)
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

  // フィルター状態
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);
  const [filterMemberId, setFilterMemberId] = useState<string>('');

  // プロジェクト一覧に変化があった場合の安全なフォールバック
  useEffect(() => {
    if (activeProjectId && !projects.some(p => p.id === activeProjectId) && activeProjectId !== 'unassigned') {
      if (projects.length > 0) {
        setActiveProjectId(projects[0].id);
      } else {
        setActiveProjectId(null);
      }
    }
  }, [projects, activeProjectId]);

  // 折りたたみ状態をlocalStorageに保存するヘルパー
  const toggleCollapse = (taskId: string) => {
    setCollapsedTaskIds(prev => {
      const next = { ...prev, [taskId]: !prev[taskId] };
      localStorage.setItem('wbsCollapsedTaskIds', JSON.stringify(next));
      return next;
    });
  };

  // グループ（最上位の親タスク）の追加
  const handleAddGroup = () => {
    const newGroupId = `task-group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // プロジェクトの最初の担当者をデフォルトにする
    let defaultAssignee = '';
    let defaultMemberId = '';
    
    if (activeProjectId) {
      const activeProj = projects.find(p => p.id === activeProjectId);
      if (activeProj?.stakeholders && activeProj.stakeholders.length > 0) {
        const firstMember = members.find(m => m.id === activeProj.stakeholders![0]);
        if (firstMember) {
          defaultAssignee = firstMember.name;
          defaultMemberId = firstMember.id;
        }
      }
    }

    addTask({
      id: newGroupId,
      title: '新しいタスクグループ',
      status: 'todo',
      projectId: activeProjectId || undefined,
      assignee: defaultAssignee,
      memberId: defaultMemberId || undefined,
      progress: 0,
      isNew: false
    });
  };

  // 子タスクを追加するヘルパー
  const handleAddChild = (parentTask: TaskExtractResult) => {
    const newChildId = `task-child-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    addTask({
      id: newChildId,
      title: '新しい子タスク',
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

  // 承認済みタスクのみをフィルタリング
  const approvedTasks = useMemo(() => tasks.filter(t => !t.isNew), [tasks]);

  // フィルター条件にマッチするタスクIDセットを構築（祖先も含める）
  const filteredTasks = useMemo(() => {
    // まずプロジェクトで絞り込み
    const projectFiltered = approvedTasks.filter(t => {
      if (activeProjectId === null) {
        return !t.projectId;
      }
      return t.projectId === activeProjectId;
    });

    // フィルターが一切ない場合はそのまま返す
    if (!showIncompleteOnly && !filterMemberId) {
      return projectFiltered;
    }

    // フィルター条件に直接マッチするタスクを特定
    const directMatchIds = new Set<string>();
    projectFiltered.forEach(t => {
      let matches = true;
      if (showIncompleteOnly && t.status === 'done') matches = false;
      if (filterMemberId && t.memberId !== filterMemberId) matches = false;
      if (matches) directMatchIds.add(t.id);
    });

    // マッチしたタスクの祖先チェーンも表示対象に含める
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

  // アクティブなプロジェクトの担当可能なメンバー一覧
  const currentProjectMembers = useMemo(() => {
    if (!activeProjectId) return members;
    const activeProj = projects.find(p => p.id === activeProjectId);
    if (activeProj?.stakeholders && activeProj.stakeholders.length > 0) {
      return members.filter(m => activeProj.stakeholders!.includes(m.id));
    }
    return members;
  }, [members, projects, activeProjectId]);

  // タスク階層ツリーを構築
  const wbsTree = useMemo(() => {
    const taskMap = new Map<string, TaskNode>();
    
    // 全てノードを初期化
    filteredTasks.forEach(t => {
      taskMap.set(t.id, { task: t, children: [] });
    });
    
    const roots: TaskNode[] = [];
    
    filteredTasks.forEach(t => {
      const node = taskMap.get(t.id)!;
      if (t.parentId && taskMap.has(t.parentId)) {
        const parentNode = taskMap.get(t.parentId)!;
        parentNode.children.push(node);
      } else {
        roots.push(node);
      }
    });

    // ソート処理（wbsOrder優先、未設定時はIDでソート）
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
  }, [filteredTasks]);

  // 子タスクを持つグループ（roots）と、持たない独立したタスク（singles）を分割
  const { groupRoots, singleRoots } = useMemo(() => {
    const groups: TaskNode[] = [];
    const singles: TaskNode[] = [];
    wbsTree.forEach(node => {
      if (node.children.length > 0) {
        groups.push(node);
      } else {
        singles.push(node);
      }
    });
    return { groupRoots: groups, singleRoots: singles };
  }, [wbsTree]);

  // 再帰的なノード描画
  const renderTaskNode = (node: TaskNode, depth: number = 0): React.ReactNode => {
    const { task, children } = node;
    const hasChildren = children.length > 0;
    const isCollapsed = !!collapsedTaskIds[task.id];

    // ステータス別のカラー設定
    const getStatusStyles = (status: string) => {
      switch (status) {
        case 'todo': 
          return { bg: 'rgba(59, 130, 246, 0.1)', border: 'rgba(59, 130, 246, 0.2)', text: '#3b82f6' };
        case 'in-progress': 
          return { bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.2)', text: '#f59e0b' };
        case 'done': 
          return { bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.2)', text: '#10b981' };
        default: 
          return { bg: 'rgba(255, 255, 255, 0.05)', border: 'rgba(255, 255, 255, 0.1)', text: 'var(--text-muted)' };
      }
    };

    const statusStyle = getStatusStyles(task.status);
    const isGroupRoot = depth === 0 && hasChildren;

    return (
      <div key={task.id} style={{ display: 'flex', flexDirection: 'column' }}>
        {/* タスク行の本体 */}
        <div className={`wbs-task-row ${isGroupRoot ? 'wbs-parent-row' : ''}`}>
          <div style={{ display: 'flex', alignItems: 'center', flex: 1, gap: '0.5rem', minWidth: 0 }}>
            {/* インデントの幅と縦ライン */}
            {Array.from({ length: depth }).map((_, i) => (
              <div 
                key={i} 
                style={{ 
                  width: '24px', 
                  alignSelf: 'stretch', 
                  display: 'flex', 
                  justifyContent: 'center',
                  position: 'relative'
                }}
              >
                <div className="wbs-indent-line" />
              </div>
            ))}

            {/* 開閉ボタン */}
            <button
              className="wbs-collapse-btn"
              onClick={() => toggleCollapse(task.id)}
              style={{
                visibility: hasChildren ? 'visible' : 'hidden',
                transform: isCollapsed ? 'rotate(-90deg)' : 'none',
              }}
            >
              <ChevronDown size={16} />
            </button>

            {/* インラインタイトル入力 */}
            <input
              className="wbs-title-input"
              value={task.title}
              onChange={e => updateTask(task.id, { title: e.target.value })}
              placeholder="タスク名を入力してください"
            />
          </div>

          {/* 右側：属性編集コントロール */}
          <div className="wbs-meta-controls">
            {/* 担当者 */}
            <div className="wbs-control-item" title="担当者">
              <Users size={14} style={{ color: 'var(--text-muted)' }} />
              <select
                className="wbs-inline-select"
                value={task.memberId || ''}
                onChange={e => {
                  const mId = e.target.value;
                  const mem = members.find(m => m.id === mId);
                  updateTask(task.id, { 
                    memberId: mId || undefined,
                    assignee: mem ? mem.name : ''
                  });
                }}
              >
                <option value="">未割り当て</option>
                {currentProjectMembers.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>

            {/* 開始日・期限 (クリックで編集モーダル) */}
            <div 
              className="wbs-date-badge"
              onClick={() => setEditingTaskId(task.id)}
              title="日程を変更 (詳細編集)"
            >
              <Calendar size={13} style={{ color: 'var(--text-muted)' }} />
              <span style={{ fontSize: '0.8rem' }}>
                {task.startDate && task.dueDate 
                  ? `${task.startDate.slice(5)} 〜 ${task.dueDate.slice(5)}`
                  : task.dueDate 
                    ? `〆 ${task.dueDate.slice(5)}` 
                    : task.startDate
                      ? `${task.startDate.slice(5)}〜`
                      : '日程未設定'}
              </span>
            </div>

            {/* 進捗率 */}
            <div className="wbs-progress-container">
              <input
                className="wbs-progress-input"
                type="number"
                min="0"
                max="100"
                value={task.progress ?? 0}
                onChange={e => {
                  let prog = parseInt(e.target.value) || 0;
                  prog = Math.max(0, Math.min(100, prog));
                  const updates: Partial<TaskExtractResult> = { progress: prog };
                  if (prog === 100) {
                    updates.status = 'done';
                  } else if (prog > 0 && task.status === 'todo') {
                    updates.status = 'in-progress';
                  } else if (prog === 0 && task.status === 'done') {
                    updates.status = 'todo';
                  }
                  updateTask(task.id, updates);
                }}
              />
              <span className="wbs-percent-symbol">%</span>
            </div>

            {/* ステータス */}
            <select
              className="wbs-status-select"
              value={task.status}
              onChange={e => {
                const newStatus = e.target.value as 'todo' | 'in-progress' | 'done';
                const updates: Partial<TaskExtractResult> = { status: newStatus };
                if (newStatus === 'done') {
                  updates.progress = 100;
                } else if (newStatus === 'todo' && task.progress === 100) {
                  updates.progress = 0;
                }
                updateTask(task.id, updates);
              }}
              style={{
                backgroundColor: statusStyle.bg,
                borderColor: statusStyle.border,
                color: statusStyle.text,
              }}
            >
              <option value="todo" style={{ color: '#3b82f6' }}>To Do</option>
              <option value="in-progress" style={{ color: '#f59e0b' }}>In Progress</option>
              <option value="done" style={{ color: '#10b981' }}>Done</option>
            </select>

            {/* アクションボタン群 */}
            <div className="wbs-action-group">
              <button
                className="wbs-row-action-btn"
                onClick={() => handleAddChild(task)}
                title="子タスクを追加"
              >
                <Plus size={15} />
              </button>
              <button
                className="wbs-row-action-btn"
                onClick={() => setEditingTaskId(task.id)}
                title="詳細を編集"
              >
                <Edit2 size={14} />
              </button>
              <button
                className="wbs-row-action-btn"
                onClick={() => {
                  if (window.confirm(`「${task.title}」を削除してもよろしいですか？\n（子タスクは親から切り離されます）`)) {
                    deleteTask(task.id);
                  }
                }}
                style={{ color: '#ef4444' }}
                title="タスクを削除"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* 子タスクの再帰表示 */}
        {hasChildren && !isCollapsed && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {children.map(child => renderTaskNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="wbs-container">
      {/* ページヘッダー */}
      <div className="wbs-header">
        <div className="wbs-header-title">
          <div className="wbs-header-icon">
            <FolderTree size={20} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>タスク階層ビュー (WBS)</h2>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              プロジェクトを構成する親グループ・子タスクの関係をツリー階層で可視化し、自在に編集・追加します。
            </p>
          </div>
        </div>

        <button className="btn-primary" onClick={handleAddGroup}>
          <Plus size={18} />
          <span>グループ（親タスク）を追加</span>
        </button>
      </div>

      {/* プロジェクトタブ選択部 */}
      <div className="wbs-tab-container">
        {projects.map(proj => {
          const isActive = activeProjectId === proj.id;
          return (
            <button
              key={proj.id}
              className="wbs-tab"
              onClick={() => setActiveProjectId(proj.id)}
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
          onClick={() => setActiveProjectId(null)}
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
              onChange={e => setShowIncompleteOnly(e.target.checked)}
            />
            <span className="wbs-toggle-slider" />
            <span className="wbs-filter-label">未完了のみ</span>
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
              setFilterMemberId('');
            }}
          >
            フィルター解除
          </button>
        )}
      </div>

      {/* ツリーコンテンツ */}
      <div className="glass-panel wbs-tree-panel">
        {wbsTree.length === 0 ? (
          <div className="wbs-empty-state">
            <FolderTree size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem', opacity: 0.6 }} />
            <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-secondary)' }}>表示するタスクがありません</h4>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              右上のボタンから、このプロジェクトに新しいグループ（親タスク）を追加して整理を始めましょう。
            </p>
            <button 
              className="btn-secondary" 
              onClick={handleAddGroup} 
              style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <Plus size={16} />
              <span>グループを追加</span>
            </button>
          </div>
        ) : (
          <div className="wbs-tree-list">
            {/* WBSテーブルヘッダーのシミュレーション */}
            <div className="wbs-table-header">
              <span style={{ flex: 1, paddingLeft: '32px' }}>タスク構造 / タイトル</span>
              <div className="wbs-table-header-meta">
                <span style={{ width: '130px', textAlign: 'left' }}>担当者</span>
                <span style={{ width: '130px', textAlign: 'center' }}>日程</span>
                <span style={{ width: '70px', textAlign: 'center' }}>進捗</span>
                <span style={{ width: '120px', textAlign: 'center' }}>ステータス</span>
                <span style={{ width: '100px', textAlign: 'center' }}>操作</span>
              </div>
            </div>
            {/* WBSツリー本体 */}
            <div className="wbs-tree-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {/* 子タスクを持つグループのカード表示 */}
              {groupRoots.map(node => (
                <div key={node.task.id} className="wbs-group-card">
                  {renderTaskNode(node, 0)}
                </div>
              ))}

              {/* 親がなく、子もない独立したタスクを「その他」として一括カード表示 */}
              {singleRoots.length > 0 && (
                <div className="wbs-group-card wbs-other-group-card">
                  <div className="wbs-other-group-header">
                    <span className="wbs-other-group-title">その他タスク（グループ未分類）</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {singleRoots.map(node => renderTaskNode(node, 0))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 詳細編集モーダル */}
      {editingTaskId && (
        <TaskEditModal
          taskId={editingTaskId}
          onClose={() => setEditingTaskId(null)}
        />
      )}
    </div>
  );
}
