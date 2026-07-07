import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Plus, ZoomIn, ZoomOut, Maximize2, GitFork, RefreshCw, Network, History } from 'lucide-react';
import { useAppContext } from '../store/AppContext';
import TaskEditModal from '../components/TaskEditModal';
import type { TaskExtractResult } from '../services/llmService';
import './Relation.css';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 105;
const ACTION_NODE_W = 165;
const ACTION_NODE_H = 55;

export default function Relation() {
  const { tasks, projects, settings, addTask, updateTask, deleteTask, updateMultipleTasks } = useAppContext();

  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });

  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const dragStartCoords = useRef({ x: 0, y: 0 });

  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const dragGroupStartTasks = useRef<{ id: string; x: number; y: number }[]>([]);
  const dragGroupStartMouse = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectingEnd, setConnectingEnd] = useState({ x: 0, y: 0 });

  const [expandedActions, setExpandedActions] = useState<Record<string, boolean>>({});
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const [showEdgeModal, setShowEdgeModal] = useState(false);
  const [edgeProposals, setEdgeProposals] = useState<any[]>([]);
  const [selectedProposals, setSelectedProposals] = useState<Record<number, boolean>>({});
  const [isGeneratingEdges, setIsGeneratingEdges] = useState(false);

  const [hideClosedProjects, setHideClosedProjects] = useState(() => {
    return localStorage.getItem('relation_hideClosedProjects') !== 'false';
  });

  const svgRef = useRef<SVGSVGElement | null>(null);

  const activeProjects = useMemo(() => {
    return hideClosedProjects ? projects.filter(p => !p.isClosed) : projects;
  }, [projects, hideClosedProjects]);

  // 初期プロジェクト選択
  useEffect(() => {
    if (activeProjects.length > 0 && !activeProjectId) {
      setActiveProjectId(activeProjects[0].id);
    }
    if (activeProjectId && !activeProjects.some(p => p.id === activeProjectId)) {
      setActiveProjectId(activeProjects.length > 0 ? activeProjects[0].id : null);
    }
  }, [activeProjects, activeProjectId]);

  const projectTasks = useMemo(() => {
    if (!activeProjectId) return [];
    return tasks.filter(t => t.projectId === activeProjectId && !t.isNew);
  }, [tasks, activeProjectId]);

  // 座標をSVG空間に変換
  const toSvg = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    };
  }, [pan, zoom]);

  // ====== 自動初期配置 ======
  const performAutoLayout = useCallback((force = false) => {
    if (!activeProjectId || projectTasks.length === 0) return;
    const groups = projectTasks.filter(t => t.isGroup || projectTasks.some(c => c.parentId === t.id && !c.isGroup));
    const groupMap: Record<string, TaskExtractResult[]> = {};
    const orphans: TaskExtractResult[] = [];

    projectTasks.forEach(t => {
      if (t.isGroup) return;
      if (t.parentId && groupMap[t.parentId] !== undefined) {
        groupMap[t.parentId].push(t);
      } else if (t.parentId) {
        if (!groupMap[t.parentId]) groupMap[t.parentId] = [];
        groupMap[t.parentId].push(t);
      } else {
        orphans.push(t);
      }
    });

    const updates: { id: string, updates: Partial<TaskExtractResult> }[] = [];
    let curY = 100;
    const xGap = 280;
    const yGroupGap = 300;

    groups.forEach(g => {
      const children = groupMap[g.id] || [];
      children.sort((a, b) => (a.wbsOrder || 0) - (b.wbsOrder || 0));
      children.forEach((t, i) => {
        if (force || t.x == null || t.y == null) {
          updates.push({ id: t.id, updates: { x: 120 + i * xGap, y: curY + 80 } });
        }
      });
      curY += yGroupGap;
    });

    orphans.sort((a, b) => (a.wbsOrder || 0) - (b.wbsOrder || 0));
    orphans.forEach((t, i) => {
      if (force || t.x == null || t.y == null) {
        updates.push({ id: t.id, updates: { x: 120 + i * xGap, y: curY + 40 } });
      }
    });

    if (updates.length > 0) updateMultipleTasks(updates);
  }, [activeProjectId, projectTasks, updateMultipleTasks]);

  useEffect(() => {
    if (projectTasks.length > 0) {
      const needsLayout = projectTasks.some(t => !t.isGroup && t.x == null);
      if (needsLayout) performAutoLayout(false);
    }
  }, [projectTasks, performAutoLayout]);

  // ====== グループ矩形 ======
  const groupBoxes = useMemo(() => {
    const groups = projectTasks.filter(t => t.isGroup || projectTasks.some(c => c.parentId === t.id && !c.isGroup));
    return groups.map(g => {
      const children = projectTasks.filter(t => t.parentId === g.id && !t.isGroup);
      if (children.length === 0) return null;
      let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
      children.forEach(t => {
        const tx = t.x ?? 0; const ty = t.y ?? 0;
        mnx = Math.min(mnx, tx); mny = Math.min(mny, ty);
        mxx = Math.max(mxx, tx + NODE_WIDTH); mxy = Math.max(mxy, ty + NODE_HEIGHT);
      });
      const pad = 30;
      return { id: g.id, title: g.title, x: mnx - pad, y: mny - pad - 35, width: mxx - mnx + pad * 2, height: mxy - mny + pad * 2 + 35 };
    }).filter(Boolean) as { id: string; title: string; x: number; y: number; width: number; height: number }[];
  }, [projectTasks]);

  // ====== マウスイベント ======
  const handleCanvasDown = (e: React.MouseEvent) => {
    if (e.button === 0 && (e.target as Element).classList.contains('rel-bg')) {
      setIsPanning(true);
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = 1.08;
    const next = e.deltaY < 0 ? zoom * factor : zoom / factor;
    setZoom(Math.min(Math.max(next, 0.12), 3.5));
  };

  const handleNodeDown = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const task = projectTasks.find(t => t.id === id);
    const svgPt = toSvg(e.clientX, e.clientY);
    dragOffset.current = { x: svgPt.x - (task?.x ?? 0), y: svgPt.y - (task?.y ?? 0) };
    dragStartCoords.current = { x: e.clientX, y: e.clientY };
    setDraggedNodeId(id);
  };

  const handleGroupDown = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const children = projectTasks.filter(t => t.parentId === groupId && !t.isGroup);
    if (children.length === 0) return;
    dragGroupStartTasks.current = children.map(t => ({
      id: t.id,
      x: t.x ?? 0,
      y: t.y ?? 0
    }));
    const svgPt = toSvg(e.clientX, e.clientY);
    dragGroupStartMouse.current = svgPt;
    setDraggedGroupId(groupId);
  };

  const handleConnectorDown = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    const task = projectTasks.find(t => t.id === id);
    if (!task) return;
    setConnectingFrom(id);
    setConnectingEnd({ x: (task.x ?? 0) + NODE_WIDTH, y: (task.y ?? 0) + NODE_HEIGHT / 2 });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
    } else if (draggedNodeId) {
      const svgPt = toSvg(e.clientX, e.clientY);
      updateTask(draggedNodeId, { x: Math.round(svgPt.x - dragOffset.current.x), y: Math.round(svgPt.y - dragOffset.current.y) });
    } else if (draggedGroupId) {
      const svgPt = toSvg(e.clientX, e.clientY);
      const dx = svgPt.x - dragGroupStartMouse.current.x;
      const dy = svgPt.y - dragGroupStartMouse.current.y;
      const updates = dragGroupStartTasks.current.map(t => ({
        id: t.id,
        updates: {
          x: Math.round(t.x + dx),
          y: Math.round(t.y + dy)
        }
      }));
      updateMultipleTasks(updates);
    } else if (connectingFrom) {
      const svgPt = toSvg(e.clientX, e.clientY);
      setConnectingEnd({ x: svgPt.x, y: svgPt.y });
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (draggedNodeId) {
      // マウス押し下げから離すまでの距離を算出 (ドラッグ移動か単純クリックかの判定)
      const dx = Math.abs(e.clientX - dragStartCoords.current.x);
      const dy = Math.abs(e.clientY - dragStartCoords.current.y);
      const isClick = dx < 6 && dy < 6;

      if (isClick) {
        // カード全体のクリックとして対応結果表示をトグル
        toggleAction(draggedNodeId);
      }
      setDraggedNodeId(null);
    } else if (draggedGroupId) {
      setDraggedGroupId(null);
      dragGroupStartTasks.current = [];
    } else if (connectingFrom) {
      const svgPt = toSvg(e.clientX, e.clientY);
      const target = projectTasks.find(t => {
        if (t.id === connectingFrom || t.isGroup) return false;
        const tx = t.x ?? 0; const ty = t.y ?? 0;
        return svgPt.x >= tx && svgPt.x <= tx + NODE_WIDTH && svgPt.y >= ty && svgPt.y <= ty + NODE_HEIGHT;
      });
      if (target) {
        const deps = Array.from(new Set([...(target.dependencies || []), connectingFrom]));
        updateTask(target.id, { dependencies: deps });
      }
      setConnectingFrom(null);
    }
    setIsPanning(false);
  };

  const handleDeleteEdge = (targetId: string, depId: string) => {
    const target = projectTasks.find(t => t.id === targetId);
    if (target?.dependencies) updateTask(targetId, { dependencies: target.dependencies.filter(id => id !== depId) });
  };

  const handleAddTask = () => {
    if (!activeProjectId) return;
    const t: TaskExtractResult = {
      id: `task-${Date.now()}`, title: '新規タスク', details: '', assignee: '', status: 'todo',
      projectId: activeProjectId, x: 200 - pan.x / zoom, y: 200 - pan.y / zoom, updateCount: 0,
    };
    addTask(t);
    setEditingTaskId(t.id);
  };

  const handleAddGroup = () => {
    if (!activeProjectId) return;
    const g: TaskExtractResult = {
      id: `group-${Date.now()}`, title: '新規グループ', details: '', assignee: '', status: 'todo',
      projectId: activeProjectId, isGroup: true, x: 100 - pan.x / zoom, y: 100 - pan.y / zoom, updateCount: 0,
    };
    addTask(g);
    setEditingTaskId(g.id);
  };

  const toggleAction = (id: string) => setExpandedActions(prev => ({ ...prev, [id]: !prev[id] }));

  const bezier = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = Math.max(Math.abs(x2 - x1) * 0.45, 40);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  // ====== AI自動エッジ生成 ======
  const triggerAutoEdge = async () => {
    if (!activeProjectId) return;
    setIsGeneratingEdges(true);
    try {
      const ep = settings.llmEndpoint || localStorage.getItem('llmEndpoint') || 'http://localhost:8080/v1';
      const res = await fetch('/api/llm/generate-edges', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: activeProjectId, llmEndpoint: ep }),
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setEdgeProposals(data);
        const checks: Record<number, boolean> = {};
        data.forEach((_, i) => { checks[i] = true; });
        setSelectedProposals(checks);
        setShowEdgeModal(true);
      }
    } catch (e) { console.error('Edge generation failed:', e); }
    finally { setIsGeneratingEdges(false); }
  };

  const applyEdges = () => {
    const batchUpdates: { id: string, updates: Partial<TaskExtractResult> }[] = [];
    edgeProposals.forEach((prop, idx) => {
      if (selectedProposals[idx]) {
        const target = projectTasks.find(t => t.id === prop.target);
        if (target) {
          const nextDeps = Array.from(new Set([...(target.dependencies || []), prop.source]));
          batchUpdates.push({ id: target.id, updates: { dependencies: nextDeps } });
        }
      }
    });
    if (batchUpdates.length > 0) updateMultipleTasks(batchUpdates);
    setShowEdgeModal(false);
    setEdgeProposals([]);
  };

  const freqClass = (count?: number) => {
    if (!count) return ''; if (count >= 5) return 'freq-high'; if (count >= 2) return 'freq-medium'; return '';
  };

  const statusLabel = (s: string) => s === 'todo' ? 'TO DO' : s === 'in-progress' ? 'IN PROGRESS' : 'DONE';
  const statusColor = (s: string) => s === 'done' ? '#10b981' : s === 'in-progress' ? '#3b82f6' : '#94a3b8';

  return (
    <div className="relation-container">
      {/* ====== ヘッダー ====== */}
      <div className="relation-header">
        <div className="relation-header-title">
          <div className="relation-header-icon"><Network size={20} /></div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>タスク関連図 (Graph)</h2>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              タスクをノードとして描画し、依存関係をエッジで可視化します。ドラッグで自由配置。
            </p>
          </div>
        </div>
        <div className="relation-header-actions">
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={!hideClosedProjects}
              onChange={e => {
                setHideClosedProjects(!e.target.checked);
                localStorage.setItem('relation_hideClosedProjects', String(!e.target.checked));
              }}
              style={{ cursor: 'pointer', width: '15px', height: '15px', accentColor: 'var(--accent-primary)' }}
            />
            <span>クローズ済みPJを表示</span>
          </label>
          <button className="btn-secondary" onClick={handleAddTask} disabled={!activeProjectId}><Plus size={16} /> タスク追加</button>
          <button className="btn-secondary" onClick={handleAddGroup} disabled={!activeProjectId}><Plus size={16} /> グループ追加</button>
          <button className="btn-secondary" onClick={() => performAutoLayout(true)} disabled={!activeProjectId}><RefreshCw size={16} /> 自動整列</button>
          <button className="btn-primary" onClick={triggerAutoEdge} disabled={!activeProjectId || isGeneratingEdges}>
            <GitFork size={16} /> {isGeneratingEdges ? '解析中...' : 'エッジ自動生成'}
          </button>
        </div>
      </div>

      {/* ====== プロジェクトタブ ====== */}
      <div className="relation-tab-container">
        {activeProjects.map(proj => (
          <button
            key={proj.id}
            className="relation-tab"
            onClick={() => { setActiveProjectId(proj.id); setPan({ x: 0, y: 0 }); setZoom(1); setExpandedActions({}); }}
            style={activeProjectId === proj.id ? { borderBottom: `3px solid ${proj.color || 'var(--accent-primary)'}`, color: 'var(--text-primary)', backgroundColor: 'rgba(255,255,255,0.04)' } : {}}
          >
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', backgroundColor: proj.color, marginRight: 8, boxShadow: `0 0 8px ${proj.color}` }} />
            {proj.name}
          </button>
        ))}
      </div>

      {/* ====== SVGキャンバス ====== */}
      <div
        className="relation-canvas"
        onMouseDown={handleCanvasDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <svg ref={svgRef} className="relation-svg">
          <defs>
            <pattern id="rel-grid" width={30} height={30} patternUnits="userSpaceOnUse"
              patternTransform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
              <circle cx={15} cy={15} r={1.5} fill="rgba(148,163,184,0.22)" />
            </pattern>
            <pattern id="rel-grid-major" width={150} height={150} patternUnits="userSpaceOnUse"
              patternTransform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
              <line x1={0} y1={0} x2={0} y2={150} stroke="rgba(148,163,184,0.08)" strokeWidth={1} />
              <line x1={0} y1={0} x2={150} y2={0} stroke="rgba(148,163,184,0.08)" strokeWidth={1} />
            </pattern>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 8 5 L 0 9 z" fill="rgba(148,163,184,0.7)" />
            </marker>
            <marker id="arrow-green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 8 5 L 0 9 z" fill="rgba(16,185,129,0.7)" />
            </marker>
            <filter id="node-shadow">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="rgba(0,0,0,0.4)" floodOpacity="0.5" />
            </filter>
          </defs>

          {/* 背景グリッド */}
          <rect className="rel-bg" width="100%" height="100%" fill="#0c1222" />
          <rect className="rel-bg" width="100%" height="100%" fill="url(#rel-grid-major)" />
          <rect className="rel-bg" width="100%" height="100%" fill="url(#rel-grid)" />

          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>

            {/* グループ囲みボックス */}
            {groupBoxes.map(box => (
              <g key={`grp-${box.id}`}>
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  className="rel-group-rect"
                  onMouseDown={(e) => handleGroupDown(box.id, e)}
                  style={{ cursor: 'grab' }}
                />
                <text x={box.x + 14} y={box.y + 22} className="rel-group-label">{box.title}</text>
              </g>
            ))}

            {/* エッジ */}
            {projectTasks.map(task => {
              if (task.isGroup || !task.dependencies) return null;
              return task.dependencies.map(depId => {
                const dep = projectTasks.find(t => t.id === depId);
                if (!dep || dep.isGroup) return null;
                const sx = (dep.x ?? 0) + NODE_WIDTH;
                const sy = (dep.y ?? 0) + NODE_HEIGHT / 2;
                const ex = task.x ?? 0;
                const ey = (task.y ?? 0) + NODE_HEIGHT / 2;
                const mx = (sx + ex) / 2; const my = (sy + ey) / 2;
                return (
                  <g key={`e-${depId}-${task.id}`} className="rel-edge-group">
                    <path d={bezier(sx, sy, ex, ey)} className="rel-edge" />
                    <g transform={`translate(${mx},${my})`} onClick={(ev) => { ev.stopPropagation(); handleDeleteEdge(task.id, depId); }} style={{ cursor: 'pointer' }}>
                      <circle r={9} className="rel-edge-del" />
                      <text textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="10" fontWeight="bold" style={{ pointerEvents: 'none' }}>×</text>
                    </g>
                  </g>
                );
              });
            })}

            {/* ドラッグ中の一時エッジ */}
            {connectingFrom && (() => {
              const src = projectTasks.find(t => t.id === connectingFrom);
              if (!src) return null;
              const sx = (src.x ?? 0) + NODE_WIDTH;
              const sy = (src.y ?? 0) + NODE_HEIGHT / 2;
              return (
                <path d={bezier(sx, sy, connectingEnd.x, connectingEnd.y)} stroke="var(--accent-primary)" strokeWidth={2.5} strokeDasharray="6 4" fill="none" style={{ pointerEvents: 'none' }} />
              );
            })()}

            {/* 対応結果エッジ & ノード */}
            {projectTasks.map(task => {
              if (task.isGroup || !expandedActions[task.id] || !task.actionResult) return null;
              const results = task.actionResult.split(' → ').map(r => r.trim()).filter(Boolean);
              return results.map((res, idx) => {
                const nodeX = (task.x ?? 0) + NODE_WIDTH + 50 + idx * (ACTION_NODE_W + 50);
                const nodeY = (task.y ?? 0) + (NODE_HEIGHT - ACTION_NODE_H) / 2;
                const prevX = idx === 0
                  ? (task.x ?? 0) + NODE_WIDTH
                  : (task.x ?? 0) + NODE_WIDTH + 50 + (idx - 1) * (ACTION_NODE_W + 50) + ACTION_NODE_W;
                const prevY = (task.y ?? 0) + NODE_HEIGHT / 2;
                return (
                  <g key={`act-${task.id}-${idx}`}>
                    <path d={`M ${prevX} ${prevY} L ${nodeX} ${nodeY + ACTION_NODE_H / 2}`} stroke="#10b981" strokeWidth={2} fill="none" markerEnd="url(#arrow-green)" />
                    <rect x={nodeX} y={nodeY} width={ACTION_NODE_W} height={ACTION_NODE_H} className="rel-action-node" />
                    <foreignObject x={nodeX + 8} y={nodeY + 6} width={ACTION_NODE_W - 16} height={ACTION_NODE_H - 12}>
                      <div style={{ fontSize: '0.72rem', color: '#d1fae5', lineHeight: 1.35, overflow: 'hidden', wordBreak: 'break-all', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                        {res}
                      </div>
                    </foreignObject>
                  </g>
                );
              });
            })}

            {/* タスクノード */}
            {projectTasks.filter(t => !t.isGroup).map(task => {
              const tx = task.x ?? 100; const ty = task.y ?? 100;
              const uc = task.updateCount || 0;
              const hasActions = !!task.actionResult;
              const isExpanded = expandedActions[task.id];
              return (
                <g key={task.id} className="rel-node-group" onMouseDown={(e) => handleNodeDown(task.id, e)}>
                  <foreignObject
                    x={tx}
                    y={ty}
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    style={{ pointerEvents: 'none' }}
                  >
                    <div 
                      className={`rel-html-card status-${task.status} ${freqClass(uc)}`}
                      style={{ 
                        width: '100%', 
                        height: '100%', 
                        pointerEvents: 'auto' 
                      }}
                    >
                      {/* 左側のステータスカラー線 */}
                      <div className="rel-card-border-indicator" style={{ backgroundColor: statusColor(task.status) }} />
                      
                      <div className="rel-card-main-content">
                        {/* タイトル（3行表示） */}
                        <div className="rel-card-title-text" title={task.title}>
                          {task.title}
                        </div>
                        
                        {/* フッター */}
                        <div className="rel-card-footer-row">
                          {/* ステータスバッジ (●付き) */}
                          <span className="rel-card-status" style={{ color: statusColor(task.status) }}>
                            <span className="rel-status-dot" style={{ backgroundColor: statusColor(task.status) }} />
                            {statusLabel(task.status)}
                          </span>

                          {/* 履歴インジケーター */}
                          {hasActions && (
                            <span 
                              className={`rel-card-history-indicator ${isExpanded ? 'expanded' : ''}`}
                              title="対応結果（履歴）あり。クリックで展開"
                            >
                              <History size={12} />
                            </span>
                          )}

                          {/* 更新カウンター */}
                          {uc > 0 && (
                            <span className="rel-card-freq-badge" title="議事録からの更新頻度">
                              更新: {uc}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* アクションボタン (ホバーで表示) */}
                      <div className="rel-card-hover-actions">
                        <button
                          className="rel-card-action-btn-edit"
                          onMouseDown={(ev) => ev.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); setEditingTaskId(task.id); }}
                          title="編集"
                        >
                          ✎
                        </button>
                        <button
                          className="rel-card-action-btn-delete"
                          onMouseDown={(ev) => ev.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); if(window.confirm(`「${task.title}」を削除してもよろしいですか？`)) deleteTask(task.id); }}
                          title="削除"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </foreignObject>

                  {/* コネクタハンドル（右辺中央） */}
                  <circle cx={tx + NODE_WIDTH} cy={ty + NODE_HEIGHT / 2} r={6} className="rel-connector"
                    onMouseDown={(e) => handleConnectorDown(task.id, e)} />
                </g>
              );
            })}
          </g>
        </svg>

        {/* ズームコントロール */}
        <div className="rel-zoom-panel">
          <button className="rel-zoom-btn" onClick={() => setZoom(z => Math.min(z * 1.2, 3.5))} title="拡大"><ZoomIn size={16} /></button>
          <div className="rel-zoom-label">{Math.round(zoom * 100)}%</div>
          <button className="rel-zoom-btn" onClick={() => setZoom(z => Math.max(z / 1.2, 0.12))} title="縮小"><ZoomOut size={16} /></button>
          <button className="rel-zoom-btn" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="リセット"><Maximize2 size={14} /></button>
        </div>
      </div>

      {editingTaskId && <TaskEditModal taskId={editingTaskId} onClose={() => setEditingTaskId(null)} />}

      {/* エッジ提案モーダル */}
      {showEdgeModal && (
        <div className="relation-modal-overlay">
          <div className="relation-modal">
            <div className="relation-modal-header">
              <h3 style={{ margin: 0 }}>自動生成エッジの確認</h3>
              <button style={{ background: 'transparent', border: 'none', color: 'white', fontSize: '1.2rem', cursor: 'pointer' }} onClick={() => setShowEdgeModal(false)}>×</button>
            </div>
            <div className="relation-modal-body">
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                AIがタスクの内容を分析し、関連性や依存関係を提案しました。追加するエッジを選択してください。
              </p>
              {edgeProposals.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>新しい関連性は検出されませんでした。</div>
              ) : (
                <div className="edge-proposal-list">
                  {edgeProposals.map((prop, idx) => {
                    const s = projectTasks.find(t => t.id === prop.source);
                    const tgt = projectTasks.find(t => t.id === prop.target);
                    if (!s || !tgt) return null;
                    return (
                      <div key={idx} className="edge-proposal-item">
                        <input type="checkbox" className="edge-proposal-check" checked={!!selectedProposals[idx]}
                          onChange={(e) => setSelectedProposals(prev => ({ ...prev, [idx]: e.target.checked }))} />
                        <div>
                          <div className="edge-proposal-flow">
                            <span>{s.title}</span><span className="edge-proposal-arrow">➔</span><span>{tgt.title}</span>
                          </div>
                          <div className="edge-proposal-reason">理由: {prop.reason || '特になし'}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="relation-modal-footer">
              <button className="btn-secondary" onClick={() => setShowEdgeModal(false)}>キャンセル</button>
              <button className="btn-primary" onClick={applyEdges} disabled={edgeProposals.length === 0}>選択したエッジを適用</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
