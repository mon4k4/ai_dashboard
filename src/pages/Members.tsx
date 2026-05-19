import { useState } from 'react';
import { Users, Plus, Trash2, Wand2 } from 'lucide-react';
import { useAppContext } from '../store/AppContext';

export default function Members() {
  const { members, minutes, addMember, updateMember, deleteMember } = useAppContext();
  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState('');

  const handleAdd = () => {
    if (!newName.trim()) return;
    addMember({
      id: `member-${Date.now()}`,
      name: newName.trim(),
      group: newGroup.trim() || '未分類'
    });
    setNewName('');
    setNewGroup('');
  };

  const handleExtractFromMinutes = async () => {
    const targetDir = localStorage.getItem('imageDir') || '/Users/monaka/Projects/05_pj_dashboard/議事録一覧';
    let unprocessedFiles = [];
    try {
      const res = await fetch(`/api/files/unprocessed?dir=${encodeURIComponent(targetDir)}`);
      if (res.ok) unprocessedFiles = await res.json();
    } catch (e) {
      console.error('Failed to fetch unprocessed files', e);
    }

    const speakers = new Set<string>();
    
    // Zoomや一般的な文字起こしフォーマットから発話者を抽出
    // フォーマット1: "[田中] 00:00:02"
    const regex1 = /\[([^\]\n]{1,15})\]\s*\d{2}:\d{2}/g;
    // フォーマット2: "田中: こんにちは", "00:01:23 山田: お疲れ様です"
    const regex2 = /(?:^|\n)(?:\[?\d{2}:\d{2}(?::\d{2})?\]?\s*)?([^\[\]:：\n]{1,15})[=:：]/g;
    
    unprocessedFiles.forEach((f: any) => {
      [regex1, regex2].forEach(regex => {
        let match;
        // reset lastIndex just in case
        regex.lastIndex = 0;
        const targetText = f.content || '';
        while ((match = regex.exec(targetText)) !== null) {
          // match[1] に発言者名が入る
          const name = match[1].trim();
          // 明らかに不要な語（URLや一般的な単語）やマークダウンの記号を除外
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

      <div className="card" style={{ padding: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label style={styles.label}>メンバー名</label>
          <input 
            type="text" 
            value={newName}
            onChange={e => setNewName(e.target.value)}
            style={styles.input}
            placeholder="例: 山田 太郎"
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={styles.label}>グループ</label>
          <input 
            type="text" 
            value={newGroup}
            onChange={e => setNewGroup(e.target.value)}
            style={styles.input}
            placeholder="例: 開発チーム"
          />
        </div>
        <button className="btn-primary" onClick={handleAdd} disabled={!newName.trim()}>
          <Plus size={18} />
          追加
        </button>
      </div>

      <div className="glass-panel" style={{ flex: 1, padding: '1.5rem', overflowY: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>名前</th>
              <th style={styles.th}>グループ</th>
              <th style={styles.th} style={{ width: '80px', textAlign: 'center' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  メンバーが登録されていません。
                </td>
              </tr>
            ) : (
              members.map(member => (
                <tr key={member.id} style={styles.tr}>
                  <td style={styles.td}>
                    <input 
                      value={member.name}
                      onChange={e => updateMember(member.id, { name: e.target.value })}
                      style={styles.ghostInput}
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
                    <button 
                      onClick={() => deleteMember(member.id)}
                      style={styles.iconBtn}
                      title="削除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
    padding: '1rem',
    borderBottom: '2px solid var(--border-color)',
    color: 'var(--text-muted)',
    fontWeight: 500,
  },
  tr: {
    borderBottom: '1px solid var(--border-color)',
  },
  td: {
    padding: '0.5rem 1rem',
  },
  ghostInput: {
    width: '100%',
    padding: '0.5rem',
    background: 'transparent',
    border: '1px solid transparent',
    color: 'var(--text-primary)',
    transition: 'all 0.2s',
    borderRadius: '4px',
  },
  iconBtn: {
    background: 'transparent',
    color: '#ef4444',
    padding: '0.5rem',
    borderRadius: '4px',
    cursor: 'pointer',
    border: 'none',
  }
};
