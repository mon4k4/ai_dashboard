import { useState, useEffect } from 'react';
import { Save, Server, Folder, User, Clock, Palette, Database, RotateCcw } from 'lucide-react';
import { useAppContext } from '../store/AppContext';

export default function Settings() {
  const { members, settings, saveSettings } = useAppContext();
  const [llmEndpoint, setLlmEndpoint] = useState('http://localhost:8080/v1');
  const [llmStreaming, setLlmStreaming] = useState(true);
  const [imageDir, setImageDir] = useState('/Users/monaka/Pictures/Screenshots');
  const [minutesDir, setMinutesDir] = useState('./議事録一覧');
  const [wbsExcelOutputDir, setWbsExcelOutputDir] = useState('./exports');
  const [reportOutputDir, setReportOutputDir] = useState('');
  const [myName, setMyName] = useState('');
  const [monthlyWorkload, setMonthlyWorkload] = useState('155');
  const [colorContrastMode, setColorContrastMode] = useState('auto');
  const [saved, setSaved] = useState(false);
  const [backups, setBackups] = useState<any[]>([]);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupSuccess, setBackupSuccess] = useState(false);

  const fetchBackups = async () => {
    try {
      const res = await fetch('/api/backup/list');
      const data = await res.json();
      if (Array.isArray(data)) setBackups(data);
    } catch (e) {
      console.error('Failed to fetch backups:', e);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const handleCreateBackup = async () => {
    setIsBackingUp(true);
    try {
      const res = await fetch('/api/backup/create', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setBackupSuccess(true);
        setTimeout(() => setBackupSuccess(false), 3000);
        fetchBackups();
      }
    } catch (e) {
      console.error('Failed to create backup:', e);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestoreBackup = async (filename: string) => {
    if (confirm(`本当にバックアップ「${filename}」から復元しますか？\n現在のデータ（タスク、メンバー、プロジェクト、議事録など）はすべて上書きされます。`)) {
      try {
        const res = await fetch('/api/backup/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename })
        });
        const data = await res.json();
        if (data.success) {
          alert('復元が完了しました。ページをリロードして最新のデータを読み込みます。');
          window.location.reload();
        }
      } catch (e) {
        console.error('Failed to restore backup:', e);
        alert('復元に失敗しました。');
      }
    }
  };

  // Load from AppContext settings state
  useEffect(() => {
    if (settings.llmEndpoint) setLlmEndpoint(settings.llmEndpoint);
    setLlmStreaming(settings.llmStreaming !== 'false');
    if (settings.imageDir) setImageDir(settings.imageDir);
    if (settings.minutesDir) setMinutesDir(settings.minutesDir);
    if (settings.wbsExcelOutputDir) setWbsExcelOutputDir(settings.wbsExcelOutputDir);
    if (settings.reportOutputDir) setReportOutputDir(settings.reportOutputDir);
    if (settings.myName) setMyName(settings.myName);
    if (settings.monthlyWorkload) setMonthlyWorkload(settings.monthlyWorkload);
    if (settings.colorContrastMode) setColorContrastMode(settings.colorContrastMode);
  }, [settings]);

  const handleSave = () => {
    saveSettings({
      llmEndpoint,
      llmStreaming: String(llmStreaming),
      imageDir,
      minutesDir,
      wbsExcelOutputDir,
      reportOutputDir,
      myName,
      monthlyWorkload,
      colorContrastMode
    });
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
          <label style={{ ...styles.label, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <input 
              type="checkbox" 
              checked={llmStreaming}
              onChange={(e) => setLlmStreaming(e.target.checked)}
              style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent-primary)' }}
            />
            LLMのストリーミング出力を有効にする
          </label>
          <p style={styles.helpText}>有効にするとLLMの応答と思考ログをリアルタイムに描画します。無効にすると一括で取得します。</p>
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
          <p style={styles.helpText}>自動一括処理で読み込む、未処理の議事録ファイル（.txt / .vtt）が格納されたディレクトリを指定してください。</p>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>
            <Folder size={18} />
            WBS Excel出力先ディレクトリ
          </label>
          <input
            type="text"
            value={wbsExcelOutputDir}
            onChange={(e) => setWbsExcelOutputDir(e.target.value)}
            placeholder="/Users/username/Projects/05_pj_dashboard/exports"
            style={styles.input}
          />
          <p style={styles.helpText}>WBS画面のExcel出力で保存するディレクトリパスを指定してください。相対パスはプロジェクトフォルダ基準です。</p>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>
            <Folder size={18} />
            週報テキスト出力先ディレクトリ
          </label>
          <input 
            type="text" 
            value={reportOutputDir}
            onChange={(e) => setReportOutputDir(e.target.value)}
            placeholder="./exports"
            style={styles.input}
          />
          <p style={styles.helpText}>週報テキストファイルを出力するディレクトリパスを指定してください。相対パスはプロジェクトフォルダ基準です。</p>
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
              <option key={m.id} value={m.id}>{m.name}</option>
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

        <div style={styles.formGroup}>
          <label style={styles.label}>
            <Palette size={18} />
            画面コントラスト調整（Windows最適化）
          </label>
          <select 
            value={colorContrastMode}
            onChange={(e) => setColorContrastMode(e.target.value)}
            style={styles.input}
          >
            <option value="auto">自動（OSを判別して最適化）</option>
            <option value="mac">macOS向け（標準・高品質グラスマフィズム）</option>
            <option value="win">Windows向け（高輝度・くっきり表示）</option>
          </select>
          <p style={styles.helpText}>macOSとWindowsでの描画・フォントのかすれ特性の違いを調整します。「Windows向け」にするとテキストや境界線が明るく際立つようになります。</p>
        </div>

        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button className="btn-primary" onClick={handleSave}>
            <Save size={18} />
            設定を保存
          </button>
          {saved && <span style={{ color: 'var(--status-done)', fontWeight: 500 }}>保存しました</span>}
        </div>
      </div>

      <h2 style={{ marginBottom: '1.5rem', marginTop: '2rem' }}>データバックアップと復元</h2>
      
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>
          現在の全データ（タスク、メンバー、プロジェクト、議事録、設定）のバックアップを作成・復元できます。
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button 
            className="btn-primary" 
            onClick={handleCreateBackup}
            disabled={isBackingUp}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <Database size={18} />
            {isBackingUp ? 'バックアップ中...' : 'バックアップを作成'}
          </button>
          {backupSuccess && <span style={{ color: 'var(--status-done)', fontWeight: 500 }}>バックアップが完了しました</span>}
        </div>

        {backups.length > 0 && (
          <div style={{ marginTop: '0.5rem' }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
              バックアップ履歴一覧 ({backups.length}件)
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.5rem' }}>
              {backups.map((b) => (
                <div key={b.filename} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '4px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{b.filename}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      作成日時: {new Date(b.createdAt).toLocaleString()} | サイズ: {(b.size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                  <button 
                    className="btn-secondary" 
                    onClick={() => handleRestoreBackup(b.filename)}
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}
                  >
                    <RotateCcw size={12} />
                    復元
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
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
