import { useState, useMemo } from 'react';
import { Users, Plus, Trash2, Wand2, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import { useAppContext } from '../store/AppContext';

export default function Members() {
  const { members, addMember, updateMember, deleteMember, reorderMembers, pendingMembers, clearPendingMembers } = useAppContext();
  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newIsInternal, setNewIsInternal] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [draggedGroup, setDraggedGroup] = useState<string | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [draggableRowId, setDraggableRowId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, idx: number, group: string) => {
    setDraggedIdx(idx);
    setDraggedGroup(group);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, idx: number, group: string) => {
    e.preventDefault();
    if (draggedGroup !== group || draggedIdx === null) return;
    setDragOverIdx(idx);
  };

  const handleDrop = (e: React.DragEvent, targetIdx: number, group: string) => {
    e.preventDefault();
    if (draggedGroup === group && draggedIdx !== null && draggedIdx !== targetIdx) {
      reorderMembers(group, draggedIdx, targetIdx);
    }
    handleDragEnd();
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDraggedGroup(null);
    setDragOverIdx(null);
    setDraggableRowId(null);
  };

  const handleAdd = () => {
    if (!newName.trim()) return;
    const group = newGroup.trim() || '未分類';
    // Calculate next order within the group
    const groupMembers = members.filter(m => m.group === group);
    const maxOrder = groupMembers.reduce((max, m) => Math.max(max, m.order ?? 0), -1);
    addMember({
      id: `member-${Date.now()}`,
      name: newName.trim(),
      group,
      title: newTitle.trim() || undefined,
      isInternal: newIsInternal,
      order: maxOrder + 1
    });
    setNewName('');
    setNewGroup('');
    setNewTitle('');
    setNewIsInternal(true);
  };

  const handleExtractFromMinutes = async () => {
    const targetDir = localStorage.getItem('minutesDir') || './議事録一覧';
    let unprocessedFiles: any[] = [];
    try {
      const res = await fetch(`/api/files/unprocessed?dir=${encodeURIComponent(targetDir)}&all=true`);
      if (res.ok) unprocessedFiles = await res.json();
    } catch (e) {
      console.error('Failed to fetch unprocessed files', e);
    }

    const speakers = new Set<string>();
    const regex1 = /\[([^\]\n]{1,15})\]\s*\d{2}:\d{2}/g;
    const regex2 = /(?:^|\n)(?:\[?\d{2}:\d{2}(?::\d{2})?\]?\s*)?([^\[\]:：\n]{1,15})[=:：]/g;
    
    unprocessedFiles.forEach((f: any) => {
      [regex1, regex2].forEach(regex => {
        let match;
        regex.lastIndex = 0;
        const targetText = f.content || '';
        while ((match = regex.exec(targetText)) !== null) {
          const name = match[1].trim();
          if (name && name.length < 15 && !name.includes('http') && !['ID', 'URL', 'Time'].includes(name) && !name.startsWith('**')) {
            speakers.add(name);
          }
        }
      });
    });

    const existingNames = new Set(members.map(m => m.name));
    let addedCount = 0;

    speakers.forEach(name => {
      if (!existingNames.has(name)) {
        addMember({
          id: `member-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          name: name,
          group: '抽出メンバー'
        });
        addedCount++;
      }
    });

    alert(addedCount > 0 ? `未処理のファイルから ${addedCount}人のメンバーを新しく抽出しました！` : '未処理のファイルから新しいメンバーは見つかりませんでした。');
  };

  // Group members by group name, sorted by order within each group
  const groupedMembers = useMemo(() => {
    const groups: Record<string, typeof members> = {};
    members.forEach(m => {
      const g = m.group || '未分類';
      if (!groups[g]) groups[g] = [];
      groups[g].push(m);
    });
    // Sort members within each group by order
    Object.values(groups).forEach(list => {
      list.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
    });
    return groups;
  }, [members]);

  const groupNames = Object.keys(groupedMembers);

  const toggleGroup = (group: string) => {
    setCollapsedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <Users size={24} color="var(--accent-primary)" />
          Team Members
        </h2>
        <button className="btn-secondary" onClick={handleExtractFromMinutes} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Wand2 size={16} />
          議事録から自動抽出
        </button>
      </div>

      {pendingMembers && pendingMembers.map(group => (
        <div 
          key={group.minuteTitle}
          style={{ 
            padding: '1rem', 
            background: 'rgba(99, 102, 241, 0.08)', 
            borderRadius: 'var(--radius-md)', 
            border: '1px solid var(--accent-primary)', 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            gap: '1rem'
          }}
        >
          <div>
            <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--accent-primary)', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>🧑‍🤝‍🧑 新しいメンバーが検出されました</span>
              <span style={{ fontSize: '0.8rem', background: 'var(--accent-primary)', color: 'var(--bg-main)', padding: '0.1rem 0.5rem', borderRadius: '4px', fontWeight: 'normal' }}>
                会議: {group.minuteTitle} ({group.names.length}件)
              </span>
            </h4>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              議事録から以下の名前が検出されました：<strong>{group.names.join('、')}</strong><br />
              チームメンバーとして追加しますか？
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <button className="btn-secondary" onClick={() => clearPendingMembers(group.minuteTitle)} style={{ padding: '0.5rem 1rem' }}>スキップ</button>
            <button className="btn-primary" onClick={() => {
              group.names.forEach((name, idx) => {
                addMember({ id: `mem-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 7)}`, name, group: '抽出メンバー' });
              });
              clearPendingMembers(group.minuteTitle);
            }} style={{ padding: '0.5rem 1rem' }}>追加する</button>
          </div>
        </div>
      ))}

      <div className="card" style={{ padding: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 140px', minWidth: '140px' }}>
          <label style={styles.label}>メンバー名</label>
          <input 
            type="text" 
            value={newName}
            onChange={e => setNewName(e.target.value)}
            style={styles.input}
            placeholder="例: BB CC"
          />
        </div>
        <div style={{ flex: '1 1 100px', minWidth: '100px' }}>
          <label style={styles.label}>グループ</label>
          <input 
            type="text" 
            value={newGroup}
            onChange={e => setNewGroup(e.target.value)}
            style={styles.input}
            placeholder="例: AAチーム"
          />
        </div>
        <div style={{ flex: '0 1 80px', minWidth: '80px' }}>
          <label style={styles.label}>役職</label>
          <input 
            type="text" 
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            style={styles.input}
            placeholder="例: T"
          />
        </div>
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBottom: '2px' }}>
          <label style={{ ...styles.label, display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', marginBottom: 0, whiteSpace: 'nowrap' }}>
            <input 
              type="checkbox"
              checked={newIsInternal}
              onChange={e => setNewIsInternal(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
            />
            内部
          </label>
        </div>
        <button className="btn-primary" onClick={handleAdd} disabled={!newName.trim()}>
          <Plus size={18} />
          追加
        </button>
      </div>

      <div className="glass-panel" style={{ flex: 1, padding: '1rem', overflowY: 'auto' }}>
        {groupNames.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            メンバーが登録されていません。
          </div>
        ) : (
          groupNames.map(groupName => {
            const groupList = groupedMembers[groupName];
            const isCollapsed = collapsedGroups[groupName];
            const internalCount = groupList.filter(m => m.isInternal).length;
            return (
              <div key={groupName} style={{ marginBottom: '0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                {/* Group Header */}
                <div 
                  onClick={() => toggleGroup(groupName)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.75rem 1rem',
                    background: 'rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    userSelect: 'none',
                    borderBottom: isCollapsed ? 'none' : '1px solid var(--border-color)'
                  }}
                >
                  {isCollapsed ? <ChevronRight size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
                  <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{groupName}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.25rem' }}>
                    ({groupList.length}名{internalCount > 0 ? ` / 内部${internalCount}名` : ''})
                  </span>
                </div>

                {!isCollapsed && (
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={{ ...styles.th, width: '6%', textAlign: 'center' }}></th>
                        <th style={{ ...styles.th, width: '29%' }}>名前</th>
                        <th style={{ ...styles.th, width: '15%' }}>役職</th>
                        <th style={{ ...styles.th, width: '10%', textAlign: 'center' }}>内部</th>
                        <th style={{ ...styles.th, width: '25%' }}>グループ</th>
                        <th style={{ ...styles.th, width: '15%', textAlign: 'center' }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupList.map((member, idx) => {
                        const isDragging = draggedGroup === groupName && draggedIdx === idx;
                        const isDragOver = draggedGroup === groupName && dragOverIdx === idx && draggedIdx !== idx;
                        return (
                          <tr 
                            key={member.id} 
                            style={{ 
                              ...styles.tr,
                              opacity: isDragging ? 0.4 : 1,
                              borderTop: isDragOver && dragOverIdx < (draggedIdx ?? 0) ? '2px solid var(--accent-primary)' : undefined,
                              borderBottom: isDragOver && dragOverIdx > (draggedIdx ?? 0) ? '2px solid var(--accent-primary)' : undefined,
                              background: isDragging ? 'rgba(255,255,255,0.02)' : undefined,
                              transition: 'all 0.1s ease',
                            }}
                            draggable={draggableRowId === member.id}
                            onDragStart={(e) => handleDragStart(e, idx, groupName)}
                            onDragOver={(e) => handleDragOver(e, idx, groupName)}
                            onDrop={(e) => handleDrop(e, idx, groupName)}
                            onDragEnd={handleDragEnd}
                          >
                            <td style={{ ...styles.td, textAlign: 'center' }}>
                              <div
                                onMouseDown={() => setDraggableRowId(member.id)}
                                onMouseUp={() => setDraggableRowId(null)}
                                style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--text-muted)', cursor: 'grab', padding: '0.2rem' }}
                                title="ドラッグして並び替え"
                              >
                                <GripVertical size={16} />
                              </div>
                            </td>
                            <td style={styles.td}>
                              <input 
                                value={member.name}
                                onChange={e => updateMember(member.id, { name: e.target.value })}
                                style={styles.ghostInput}
                              />
                            </td>
                            <td style={styles.td}>
                              <input 
                                value={member.title || ''}
                                onChange={e => updateMember(member.id, { title: e.target.value || undefined })}
                                style={{ ...styles.ghostInput, textAlign: 'center' }}
                                placeholder="—"
                              />
                            </td>
                            <td style={{ ...styles.td, textAlign: 'center' }}>
                              <input 
                                type="checkbox"
                                checked={member.isInternal ?? false}
                                onChange={e => updateMember(member.id, { isInternal: e.target.checked })}
                                style={{ width: '16px', height: '16px', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                              />
                            </td>
                            <td style={styles.td}>
                              <input 
                                value={member.group}
                                onChange={e => updateMember(member.id, { group: e.target.value })}
                                style={styles.ghostInput}
                              />
                            </td>
                            <td style={{ ...styles.td, textAlign: 'center' }}>
                              <div style={{ display: 'flex', justifyContent: 'center', gap: '0.25rem' }}>
                                <button 
                                  onClick={() => deleteMember(member.id)}
                                  style={{ ...styles.iconBtn, color: '#ef4444' }}
                                  title="削除"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const styles = {
  label: {
    display: 'block',
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
    marginBottom: '0.5rem',
  },
  input: {
    width: '100%',
    padding: '0.75rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  th: {
    textAlign: 'left' as const,
    padding: '0.6rem 0.75rem',
    borderBottom: '1px solid var(--border-color)',
    color: 'var(--text-muted)',
    fontWeight: 500,
    fontSize: '0.8rem',
  },
  tr: {
    borderBottom: '1px solid var(--border-color)',
  },
  td: {
    padding: '0.35rem 0.75rem',
  },
  ghostInput: {
    width: '100%',
    padding: '0.4rem',
    background: 'transparent',
    border: '1px solid transparent',
    color: 'var(--text-primary)',
    transition: 'all 0.2s',
    borderRadius: '4px',
    fontSize: '0.9rem',
  },
  iconBtn: {
    background: 'transparent',
    padding: '0.3rem',
    borderRadius: '4px',
    cursor: 'pointer',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }
};
