import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../store/AppContext';
import { summarizeMeeting, startBatchProcess } from '../services/llmService';
import { FileText, Loader2, Image as ImageIcon, Play, CheckCircle2, CheckSquare } from 'lucide-react';
import { format } from 'date-fns';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

export default function Minutes() {
  const { minutes, addMinute, batchStatus, pendingMembers, clearPendingMembers, addMember } = useAppContext();
  const [transcript, setTranscript] = useState('');
  const [title, setTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [images, setImages] = useState<string[]>([]);

  const targetDir = localStorage.getItem('minutesDir') || '/Users/monaka/Projects/05_pj_dashboard/議事録一覧';

  const handleBatchProcess = async () => {
    try {
      await startBatchProcess(targetDir);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const urls = Array.from(e.target.files).map(file => URL.createObjectURL(file));
      setImages(prev => [...prev, ...urls]);
    }
  };

  const handleSummarize = async () => {
    if (!transcript.trim() || !title.trim()) return;
    setIsLoading(true);
    try {
      const summaryText = await summarizeMeeting(transcript);
      let extractedDate = format(new Date(), 'yyyy-MM-dd');
      const dateMatch = title.match(/^(\d{4})(\d{2})(\d{2})/);
      if (dateMatch) {
        extractedDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
      }
      addMinute({
        id: `min-${Date.now()}`,
        date: extractedDate,
        title, summary: summaryText, extractedTasks: []
      });
      setTranscript(''); setTitle(''); setImages([]);
    } catch (err) {
      alert('要約に失敗しました。LLMが起動しているか確認してください。');
    } finally { setIsLoading(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1.5rem' }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, justifyContent: 'space-between', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FileText size={24} color="var(--accent-primary)" />
          Meeting Minutes
        </div>
        <button className="btn-primary" onClick={handleBatchProcess} disabled={batchStatus.isProcessing} style={{ fontSize: '0.9rem', padding: '0.5rem 1rem' }}>
          {batchStatus.isProcessing ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
          自動一括処理を実行
        </button>
      </h2>

      {batchStatus.message && (
        <div style={{ background: batchStatus.isProcessing ? 'rgba(99, 102, 241, 0.1)' : 'rgba(16, 185, 129, 0.1)', color: batchStatus.isProcessing ? 'var(--accent-primary)' : 'var(--status-done)', padding: '0.75rem', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {batchStatus.isProcessing ? <Loader2 size={18} className="spin" /> : <CheckCircle2 size={18} />}
          {batchStatus.message}
          {batchStatus.isProcessing && batchStatus.totalCount > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: '0.85rem' }}>
              {batchStatus.processedCount}/{batchStatus.totalCount}
            </span>
          )}
        </div>
      )}

      {pendingMembers && pendingMembers.length > 0 && (
        <div style={{ padding: '1rem', background: 'rgba(99, 102, 241, 0.1)', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
          <div>
            <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--accent-primary)', fontSize: '1rem' }}>🧑‍🤝‍🧑 新しいメンバーが検出されました</h4>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              議事録から以下の名前が検出されました：<strong>{pendingMembers.join('、')}</strong><br />
              チームメンバーとして追加しますか？
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <button className="btn-secondary" onClick={() => clearPendingMembers()} style={{ padding: '0.5rem 1rem' }}>スキップ</button>
            <button className="btn-primary" onClick={() => {
              pendingMembers.forEach(name => {
                addMember({ id: `mem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`, name, group: '未分類' });
              });
              clearPendingMembers();
            }} style={{ padding: '0.5rem 1rem' }}>追加する</button>
          </div>
        </div>
      )}

      {/* 議事録追加フォーム */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>新規議事録の要約</h3>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="会議のタイトル" style={{ fontWeight: 'bold' }} />
        <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Zoomの文字起こしを貼り付けてください..." rows={3} style={{ resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
            <ImageIcon size={18} /> スクショを選択
            <input type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
          </label>
          <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={handleSummarize} disabled={isLoading || !transcript.trim() || !title.trim()}>
            {isLoading ? <Loader2 size={18} className="spin" /> : <FileText size={18} />}
            AI要約を生成
          </button>
        </div>
        {images.length > 0 && (
          <div style={styles.imageGallery}>
            {images.map((src, i) => (<img key={i} src={src} alt="screenshot" style={styles.thumbnail} />))}
          </div>
        )}
      </div>

      {/* 議事録一覧 */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {(() => {
          if (minutes.length === 0) return <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem' }}>議事録がありません。</div>;
          
          const grouped = minutes.reduce((acc, m) => {
            const key = m.date ? m.date.substring(0, 7) : 'Unknown';
            if (!acc[key]) acc[key] = [];
            acc[key].push(m);
            return acc;
          }, {} as Record<string, any[]>);

          return Object.keys(grouped).sort().reverse().map(month => (
            <details key={month} open style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <summary style={{ padding: '1rem', fontWeight: 'bold', cursor: 'pointer', outline: 'none', display: 'flex', alignItems: 'center' }}>
                {month === 'Unknown' ? '日付未設定' : `${month.replace('-', '年')}月`} <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>({grouped[month].length}件)</span>
              </summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1rem', borderTop: '1px solid var(--border-color)' }}>
                {grouped[month].map(m => (
                  <MinuteCard key={m.id} minute={m} />
                ))}
              </div>
            </details>
          ));
        })()}
      </div>
      <style>{`.spin { animation: spin 1s linear infinite; }`}</style>
    </div>
  );
}

function MinuteCard({ minute }: { minute: any }) {
  const { updateMinute } = useAppContext();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [editSummary, setEditSummary] = useState(minute.summary);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      files.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          updateMinute(minute.id, { images: [...(minute.images || []), base64] });
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleSave = () => {
    updateMinute(minute.id, { summary: editSummary });
    setIsEditing(false);
  };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.25rem' }}>{minute.title}</h3>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>{minute.date}</span>
          <button className="btn-secondary" onClick={() => setIsEditing(!isEditing)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}>
            {isEditing ? 'キャンセル' : '編集'}
          </button>
        </div>
      </div>
      
      {isEditing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <textarea
            value={editSummary}
            onChange={(e) => setEditSummary(e.target.value)}
            rows={6}
            style={{ width: '100%', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <label className="btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
              <ImageIcon size={16} /> 画像を追加
              <input type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
            </label>
            <button className="btn-primary" onClick={handleSave}>保存</button>
          </div>
        </div>
      ) : (
        <MarkdownRenderer content={minute.summary} />
      )}

      {minute.extractedTasks && minute.extractedTasks.length > 0 && (
        <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem' }}>
            <CheckSquare size={16} color="var(--accent-primary)" />
            抽出されたタスク
          </h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {minute.extractedTasks.map((t: any) => (
              <button 
                key={t.id} 
                onClick={() => navigate('/kanban')}
                style={{ 
                  background: 'var(--bg-card)', 
                  border: '1px solid var(--border-color)', 
                  padding: '0.5rem 0.75rem', 
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.85rem',
                  color: 'var(--text-primary)',
                  transition: 'background-color 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-main)'}
                onMouseOut={(e) => e.currentTarget.style.background = 'var(--bg-card)'}
              >
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-primary)' }}></div>
                {t.title}
                {t.assignee && <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>({t.assignee})</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {minute.images && minute.images.length > 0 && (
        <div style={{ ...styles.imageGallery, marginTop: '1rem' }}>
          {minute.images.map((src: string, i: number) => (
            <img key={i} src={src} alt="attached" style={styles.thumbnail} />
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  imageGallery: { display: 'flex', gap: '0.5rem', overflowX: 'auto' as const, paddingBottom: '0.5rem' },
  thumbnail: { height: '80px', borderRadius: '4px', objectFit: 'cover' as const, border: '1px solid var(--border-color)' },
};
