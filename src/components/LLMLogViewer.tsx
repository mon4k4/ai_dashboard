import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../store/AppContext';
import { Terminal, ChevronDown, ChevronRight, X, Clock, AlertTriangle, BrainCircuit, Radio } from 'lucide-react';

export default function LLMLogViewer() {
  const { llmLogs, settings } = useAppContext();
  const [isOpen, setIsOpen] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const streamingRef = useRef<HTMLPreElement | null>(null);

  const streamingCount = llmLogs.filter(l => l.status === 'streaming').length;
  const isStreamingMode = settings.llmStreaming !== 'false';
  const logTitle = isStreamingMode ? 'LLM Logs (Streaming)' : 'LLM Logs (Status Mode)';

  // ストリーミング中のログを自動展開
  useEffect(() => {
    const streaming = llmLogs.find(l => l.status === 'streaming');
    if (streaming && !expandedLogId) {
      setExpandedLogId(streaming.id);
    }
  }, [llmLogs]);

  // ストリーミング中は自動スクロール
  useEffect(() => {
    if (streamingRef.current) {
      streamingRef.current.scrollTop = streamingRef.current.scrollHeight;
    }
  });

  if (!isOpen) {
    return (
      <button style={styles.floatingBtn} onClick={() => setIsOpen(true)} title="LLM Logs">
        <Terminal size={20} />
        {streamingCount > 0 && <span style={{ ...styles.badge, background: '#f59e0b', animation: 'pulse 1.5s infinite' }}>●</span>}
        {streamingCount === 0 && llmLogs.length > 0 && <span style={styles.badge}>{llmLogs.length}</span>}
      </button>
    );
  }

  return (
    <div style={styles.drawer}>
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Terminal size={20} color="var(--accent-primary)" />
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{logTitle}</h3>
          {streamingCount > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#f59e0b', fontSize: '0.8rem' }}>
              <Radio size={14} style={{ animation: 'pulse 1.5s infinite' }} /> Streaming...
            </span>
          )}
        </div>
        <button style={styles.closeBtn} onClick={() => setIsOpen(false)}><X size={20} /></button>
      </div>

      <div style={styles.content}>
        {llmLogs.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem' }}>No LLM interactions yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {llmLogs.map(log => {
              const isExpanded = expandedLogId === log.id;
              const isStreaming = log.status === 'streaming';
              return (
                <div key={log.id} style={styles.logCard(!!log.error, isStreaming)}>
                  <div style={styles.logHeader} onClick={() => setExpandedLogId(isExpanded ? null : log.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      {isStreaming && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', animation: 'pulse 1.5s infinite' }} />}
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{(log as any).label || log.endpoint.split('/').pop()}</span>
                      {log.error && <AlertTriangle size={14} color="#ef4444" />}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      {isStreaming ? (
                        <span style={{ color: '#f59e0b' }}>処理中...</span>
                      ) : (
                        <>
                          {log.statusCode !== undefined && (
                            <span style={{
                              background: log.statusCode >= 200 && log.statusCode < 300 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                              color: log.statusCode >= 200 && log.statusCode < 300 ? 'var(--status-done)' : '#ef4444',
                              padding: '0.1rem 0.45rem',
                              borderRadius: '4px',
                              fontWeight: 600,
                              fontSize: '0.75rem'
                            }}>
                              {log.statusCode}
                            </span>
                          )}
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}><Clock size={12} /> {(log.latencyMs / 60000).toFixed(2)}分</span>
                        </>
                      )}
                      <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={styles.logDetails}>
                      <div style={styles.section}>
                        <div style={styles.sectionTitle}>Request Prompt</div>
                        <pre style={styles.codeBlock}>{log.prompt}</pre>
                      </div>

                      {log.error ? (
                        <div style={styles.section}>
                          <div style={{ ...styles.sectionTitle, color: '#ef4444' }}>Error</div>
                          <pre style={{ ...styles.codeBlock, color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}>{log.error}</pre>
                        </div>
                      ) : (
                        <>
                          {log.thinkingProcess && (
                            <div style={styles.section}>
                              <div style={{ ...styles.sectionTitle, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <BrainCircuit size={16} /> Thinking Process
                                {isStreaming && <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>(streaming...)</span>}
                              </div>
                              <pre ref={isStreaming ? streamingRef : undefined} style={{ ...styles.codeBlock, color: 'var(--text-muted)', fontStyle: 'italic', background: 'rgba(245, 158, 11, 0.05)', borderColor: 'rgba(245, 158, 11, 0.2)' }}>
                                {log.thinkingProcess}
                                {isStreaming && <span style={{ animation: 'blink 1s infinite' }}>▌</span>}
                              </pre>
                            </div>
                          )}
                          <div style={styles.section}>
                            <div style={{ ...styles.sectionTitle, color: 'var(--status-done)' }}>Final Output</div>
                            <pre ref={!log.thinkingProcess && isStreaming ? streamingRef : undefined} style={{ ...styles.codeBlock, background: 'rgba(16, 185, 129, 0.05)', borderColor: 'rgba(16, 185, 129, 0.2)' }}>
                              {log.finalOutput || (isStreaming ? '' : '(empty)')}
                              {isStreaming && !log.thinkingProcess && <span style={{ animation: 'blink 1s infinite' }}>▌</span>}
                            </pre>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>
    </div>
  );
}

const styles = {
  floatingBtn: { position: 'fixed' as const, bottom: '2rem', right: '2rem', width: '48px', height: '48px', borderRadius: '50%', background: 'var(--accent-gradient)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-card)', zIndex: 1000, cursor: 'pointer' },
  badge: { position: 'absolute' as const, top: '-2px', right: '-2px', background: '#ef4444', color: 'white', fontSize: '0.65rem', fontWeight: 'bold', minWidth: '18px', height: '18px', borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' },
  drawer: { position: 'fixed' as const, top: '1rem', right: '1rem', bottom: '1rem', width: '600px', maxWidth: 'calc(100vw - 2rem)', background: 'rgba(15, 17, 23, 0.95)', backdropFilter: 'blur(16px)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column' as const, zIndex: 1000, overflow: 'hidden' },
  header: { padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)' },
  closeBtn: { background: 'transparent', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  content: { padding: '1rem', overflowY: 'auto' as const, flex: 1 },
  logCard: (isError: boolean, isStreaming: boolean) => ({ background: 'var(--bg-card)', border: `1px solid ${isError ? 'rgba(239, 68, 68, 0.3)' : isStreaming ? 'rgba(245, 158, 11, 0.4)' : 'var(--border-color)'}`, borderRadius: 'var(--radius-md)', overflow: 'hidden' }),
  logHeader: { padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: 'rgba(255,255,255,0.02)' },
  logDetails: { padding: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' as const, gap: '1rem' },
  section: { display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' },
  sectionTitle: { fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  codeBlock: { margin: 0, padding: '0.75rem', background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap' as const, wordBreak: 'break-all' as const, maxHeight: '250px', overflowY: 'auto' as const },
};
