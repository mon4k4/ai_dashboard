import { useState, useEffect } from 'react';
import { Save, Server, Folder, FileText, User, Clock } from 'lucide-react';
import { useAppContext } from '../store/AppContext';

export default function Settings() {
  const { members } = useAppContext();
  const [llmEndpoint, setLlmEndpoint] = useState('http://localhost:8080/v1');
  const [imageDir, setImageDir] = useState('/Users/monaka/Pictures/Screenshots');
  const [minutesDir, setMinutesDir] = useState('/Users/monaka/Projects/05_pj_dashboard/議事録一覧');
  const [reportTemplatePath, setReportTemplatePath] = useState('');
  const [myName, setMyName] = useState('');
  const [monthlyWorkload, setMonthlyWorkload] = useState('155');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const storedEndpoint = localStorage.getItem('llmEndpoint');
    const storedImageDir = localStorage.getItem('imageDir');
    const storedMinutesDir = localStorage.getItem('minutesDir');
    const storedTemplatePath = localStorage.getItem('reportTemplatePath');
    const storedMyName = localStorage.getItem('myName');
    const storedWorkload = localStorage.getItem('monthlyWorkload');
    
    if (storedEndpoint) setLlmEndpoint(storedEndpoint);
    if (storedImageDir) setImageDir(storedImageDir);
    if (storedMinutesDir) setMinutesDir(storedMinutesDir);
    if (storedTemplatePath) setReportTemplatePath(storedTemplatePath);
    if (storedMyName) setMyName(storedMyName);
    if (storedWorkload) setMonthlyWorkload(storedWorkload);
  }, []);

  const handleSave = () => {
    localStorage.setItem('llmEndpoint', llmEndpoint);
    localStorage.setItem('imageDir', imageDir);
    localStorage.setItem('minutesDir', minutesDir);
    localStorage.setItem('reportTemplatePath', reportTemplatePath);
    localStorage.setItem('myName', myName);
    localStorage.setItem('monthlyWorkload', monthlyWorkload);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ maxWidth: '600px' }}>
      <h2 style={{ marginBottom: '1.5rem' }}>Settings</h2>
      
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        
        <div style={styles.formGroup}>
          <label style={styles.label}>
            <Server size={18} />
            ローカルLLM API エンドポイント (OpenAI互換)
          </label>
          <input 
            type="text" 
            value={llmEndpoint}
            onChange={(e) => setLlmEndpoint(e.target.value)}
            placeholder="http://localhost:8080/v1"
            style={styles.input}
          />
          <p style={styles.helpText}>llama.cpp などの OpenAI 互換サーバーのベースURLを指定してください。</p>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>
            <Folder size={18} />
            スクリーンショット保存ディレクトリ
          </label>
          <input 
            type="text" 
            value={imageDir}
            onChange={(e) => setImageDir(e.target.value)}
            placeholder="/Users/username/Pictures/Screenshots"
            style={styles.input}
          />
          <p style={styles.helpText}>会議中に保存されるスクリーンショットのローカルディレクトリパスを指定してください。</p>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>
            <Folder size={18} />
            自動一括処理 議事録フォルダパス
          </label>
          <input 
            type="text" 
            value={minutesDir}
            onChange={(e) => setMinutesDir(e.target.value)}
            placeholder="/Users/username/Projects/05_pj_dashboard/議事録一覧"
            style={styles.input}
          />
          <p style={styles.helpText}>自動一括処理で読み込む、未処理の議事録テキストファイル（.txt）が格納されたディレクトリを指定してください。</p>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>
            <FileText size={18} />
            週報テンプレートファイルパス
          </label>
          <input 
            type="text" 
            value={reportTemplatePath}
            onChange={(e) => setReportTemplatePath(e.target.value)}
            placeholder="/Users/username/Projects/template.md"
            style={styles.input}
          />
          <p style={styles.helpText}>LLMに週報のフォーマットを指示するためのテンプレートファイルの絶対パスを指定してください。</p>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>
            <User size={18} />
            自分の名前（担当者）
          </label>
          <select 
            value={myName}
            onChange={(e) => setMyName(e.target.value)}
            style={styles.input}
          >
            <option value="">-- 未設定 --</option>
            {members.map(m => (
              <option key={m.id} value={m.name}>{m.name}</option>
            ))}
          </select>
          <p style={styles.helpText}>WBSやKanbanで「自分のタスク」をフィルタリングするために使用します。</p>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>
            <Clock size={18} />
            月間100%稼働時間 (h)
          </label>
          <input 
            type="number" 
            value={monthlyWorkload}
            onChange={(e) => setMonthlyWorkload(e.target.value)}
            style={styles.input}
          />
          <p style={styles.helpText}>プロジェクト管理の稼働率計算に使用します。（デフォルト: 155時間）</p>
        </div>

        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button className="btn-primary" onClick={handleSave}>
            <Save size={18} />
            設定を保存
          </button>
          {saved && <span style={{ color: 'var(--status-done)', fontWeight: 500 }}>保存しました</span>}
        </div>
      </div>
    </div>
  );
}

const styles = {
  formGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.5rem',
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontWeight: 500,
    color: 'var(--text-primary)',
  },
  input: {
    width: '100%',
  },
  helpText: {
    fontSize: '0.875rem',
    color: 'var(--text-muted)',
    marginTop: '0.25rem',
  }
};
