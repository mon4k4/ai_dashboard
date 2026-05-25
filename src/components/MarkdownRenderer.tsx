import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
});

interface MermaidProps {
  chart: string;
}

const Mermaid: React.FC<MermaidProps> = ({ chart }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const renderChart = async () => {
      if (!containerRef.current) return;
      try {
        const id = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
        // Clean up chart syntax a bit if there's markdown wrapping
        const cleanChart = chart.trim();
        const { svg: renderedSvg } = await mermaid.render(id, cleanChart);
        if (isMounted) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err: any) {
        console.error('Mermaid render error:', err);
        if (isMounted) {
          setError(err.message || 'Mermaidの描画に失敗しました。');
        }
      }
    };

    renderChart();

    return () => {
      isMounted = false;
    };
  }, [chart]);

  if (error) {
    return (
      <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--status-todo)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--status-todo)', fontSize: '0.9rem', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
        Mermaid Error: {error}
      </div>
    );
  }

  return (
    <div 
      ref={containerRef} 
      className="mermaid-chart" 
      style={{ display: 'flex', justifyContent: 'center', background: 'rgba(255, 255, 255, 0.02)', padding: '1rem', borderRadius: 'var(--radius-md)', margin: '1rem 0', overflowX: 'auto', border: '1px solid var(--border-color)' }}
      dangerouslySetInnerHTML={{ __html: svg || 'Loading diagram...' }} 
    />
  );
};

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);

  return (
    <>
      <div className="markdown-content" style={{ lineHeight: '1.7', fontSize: '0.95rem' }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
          code({ inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const value = String(children).replace(/\n$/, '');
            
            if (!inline && match && match[1] === 'mermaid') {
              return <Mermaid chart={value} />;
            }
            
            return inline ? (
              <code style={{ background: 'rgba(255,255,255,0.1)', padding: '0.2rem 0.4rem', borderRadius: '4px', fontFamily: 'monospace' }} {...props}>
                {children}
              </code>
            ) : (
              <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-md)', overflowX: 'auto', border: '1px solid var(--border-color)' }} {...props}>
                <code className={className} style={{ fontFamily: 'monospace' }}>{children}</code>
              </pre>
            );
          },
          h1: ({ children }) => <h1 style={{ fontSize: '1.6rem', marginTop: '1.5rem', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.3rem', fontWeight: 600 }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ fontSize: '1.3rem', marginTop: '1.25rem', marginBottom: '0.5rem', fontWeight: 600 }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ fontSize: '1.1rem', marginTop: '1rem', marginBottom: '0.5rem', fontWeight: 600 }}>{children}</h3>,
          p: ({ children }) => <p style={{ marginBottom: '1rem', margin: '0.5rem 0' }}>{children}</p>,
          ul: ({ children }) => <ul style={{ listStyleType: 'disc', paddingLeft: '1.5rem', marginBottom: '1rem' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ listStyleType: 'decimal', paddingLeft: '1.5rem', marginBottom: '1rem' }}>{children}</ol>,
          li: ({ children }) => <li style={{ marginBottom: '0.25rem' }}>{children}</li>,
          a: ({ href, children }) => <a href={href} style={{ color: 'var(--accent-primary)', textDecoration: 'underline' }}>{children}</a>,
          table: ({ children }) => <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>{children}</table>,
          thead: ({ children }) => <thead style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '2px solid var(--border-color)' }}>{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr style={{ borderBottom: '1px solid var(--border-color)' }}>{children}</tr>,
          th: ({ children }) => <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>{children}</th>,
          td: ({ children }) => <td style={{ padding: '0.75rem', textAlign: 'left' }}>{children}</td>,
          blockquote: ({ children }) => <blockquote style={{ borderLeft: '4px solid var(--accent-primary)', paddingLeft: '1rem', color: 'var(--text-muted)', margin: '1rem 0' }}>{children}</blockquote>,
            img: ({ src, alt }) => (
              <img
                src={src}
                alt={alt || ''}
                style={{
                  maxHeight: '160px',
                  maxWidth: '280px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  objectFit: 'cover',
                  margin: '0.5rem 0',
                  cursor: 'zoom-in',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'scale(1.05)';
                  e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
                }}
                onClick={() => {
                  if (src) setPreviewImage({ src, alt: alt || '' });
                }}
              />
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>

      {previewImage && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(0, 0, 0, 0.78)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            cursor: 'zoom-out'
          }}
        >
          <button
            type="button"
            className="btn-secondary"
            onClick={(e) => {
              e.stopPropagation();
              setPreviewImage(null);
            }}
            style={{ position: 'absolute', top: '1rem', right: '1rem', padding: '0.5rem 0.75rem' }}
          >
            閉じる
          </button>
          <img
            src={previewImage.src}
            alt={previewImage.alt}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 'min(96vw, 1400px)',
              maxHeight: '90vh',
              objectFit: 'contain',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
              cursor: 'default'
            }}
          />
        </div>
      )}
    </>
  );
};
