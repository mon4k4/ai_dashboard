import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ImageLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function ImageLightbox({ src, alt = '', onClose }: ImageLightboxProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={styles.overlay}
    >
      <button
        type="button"
        aria-label="画像プレビューを閉じる"
        title="閉じる"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        style={styles.closeButton}
      >
        <X size={28} />
      </button>
      <img
        src={src}
        alt={alt}
        onClick={(event) => event.stopPropagation()}
        style={styles.image}
      />
    </div>,
    document.body
  );
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    zIndex: 20000,
    background: 'rgba(0, 0, 0, 0.92)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'zoom-out',
  },
  closeButton: {
    position: 'fixed' as const,
    top: '1rem',
    right: '1rem',
    zIndex: 1,
    width: '44px',
    height: '44px',
    borderRadius: '999px',
    background: 'rgba(15, 17, 23, 0.72)',
    border: '1px solid rgba(255, 255, 255, 0.18)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 12px 36px rgba(0, 0, 0, 0.4)',
    cursor: 'pointer',
  },
  image: {
    width: '100vw',
    height: '100vh',
    objectFit: 'contain' as const,
    cursor: 'default',
  },
};
