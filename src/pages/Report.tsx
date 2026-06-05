import { useState } from 'react';
import { useAppContext } from '../store/AppContext';
import { FileBarChart, Loader2, RefreshCw } from 'lucide-react';
import { subDays, format } from 'date-fns';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { buildWeeklyReportTxt } from '../prompts/reportPrompts';

export default function Report() {
  const { minutes, reports, addReport, projects, members } = useAppContext();
  const [isLoading, setIsLoading] = useState(false);

  // 直近7日間の議事録を対象とする
  const recentMinutes = minutes.filter(m => {
    const minDate = new Date(m.date);
    const aWeekAgo = subDays(new Date(), 7);
    return minDate >= aWeekAgo;
  });

  const handleGenerate = async () => {
    if (recentMinutes.length === 0) {
      alert('直近7日間の議事録がありません。');
      return;
    }
    
    setIsLoading(true);
    try {
      // 1. Update the template based on current projects and members
      const customTemplate = buildWeeklyReportTxt(projects, members);

      const minutesText = recentMinutes.map(m => `■${m.date} ${m.title}\n${m.summary}`).join('\n\n');
      const llmEndpoint = localStorage.getItem('llmEndpoint') || 'http://localhost:8080/v1';

      // 2. Automatically generate the report via LLM using the updated template
      const res = await fetch('/api/report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutesText, templateText: customTemplate, llmEndpoint }),
      });
      if (!res.ok) throw new Error('Report generation failed');
      const data = await res.json();
      
      const generatedContent = data.output;

      // 3. Render / save in context (which draws it on the page)
      addReport({
        id: `report-${Date.now()}`,
        date: format(new Date(), 'yyyy-MM-dd'),
        content: generatedContent,
      });

      // 4. Automatically export the generated report to a text file
      const outputDir = localStorage.getItem('reportOutputDir') || './exports';
      const exportRes = await fetch('/api/report/export-txt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: generatedContent, outputDir }),
      });
      
      if (!exportRes.ok) throw new Error('Failed to export txt report automatically');
      const exportData = await exportRes.json();

      alert(`週報の自動生成が完了し、テキストファイルを保存しました:\n${exportData.filePath}`);
    } catch (err) {
      console.error(err);
      alert('週報の生成またはテキスト保存に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  };



  // 年月でグループ化
  const grouped = reports.reduce((acc, r) => {
    const key = r.date ? r.date.substring(0, 7) : 'Unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {} as Record<string, typeof reports>);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1.5rem' }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
        <FileBarChart size={24} color="var(--accent-primary)" />
        Weekly Report
      </h2>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.5rem', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0, marginBottom: '0.5rem' }}>週報の自動生成 (Markdown)</h3>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>
              直近7日間（{recentMinutes.length}件）の議事録要約を元に、今週の週報を作成します。
            </p>
          </div>
          
          <button 
            className="btn-primary" 
            onClick={handleGenerate} 
            disabled={isLoading || recentMinutes.length === 0}
          >
            {isLoading ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
            週報を生成する
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          <Loader2 size={32} className="spin" style={{ marginBottom: '1rem', color: 'var(--accent-primary)' }} />
          <span>LLMが週報を生成中です...</span>
        </div>
      )}

      {/* 週報一覧（年月アコーディオン） */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {reports.length === 0 && !isLoading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem' }}>
            週報がありません。上のボタンから生成してください。
          </div>
        ) : (
          Object.keys(grouped).sort().reverse().map(month => (
            <details key={month} open={month === Object.keys(grouped).sort().reverse()[0]} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <summary style={{ padding: '1rem', fontWeight: 'bold', cursor: 'pointer', outline: 'none', display: 'flex', alignItems: 'center' }}>
                {month === 'Unknown' ? '日付未設定' : `${month.replace('-', '年')}月`}
                <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>({grouped[month].length}件)</span>
              </summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1rem', borderTop: '1px solid var(--border-color)' }}>
                {grouped[month].map(report => (
                  <ReportCard key={report.id} report={report} />
                ))}
              </div>
            </details>
          ))
        )}
      </div>

      <style>{`.spin { animation: spin 1s linear infinite; }`}</style>
    </div>
  );
}

function ReportCard({ report }: { report: any }) {
  const { updateReport } = useAppContext();
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(report.content);

  const handleSave = () => {
    updateReport(report.id, { content: editContent });
    setIsEditing(false);
  };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>週報</h3>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>{report.date}</span>
          <button className="btn-secondary" onClick={() => setIsEditing(!isEditing)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}>
            {isEditing ? 'キャンセル' : '編集'}
          </button>
        </div>
      </div>

      {isEditing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={12}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.9rem' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-primary" onClick={handleSave}>保存</button>
          </div>
        </div>
      ) : (
        <MarkdownRenderer content={report.content} />
      )}
    </div>
  );
}
