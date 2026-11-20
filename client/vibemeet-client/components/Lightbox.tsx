'use client';

import { useEffect } from 'react';
import * as api from '@/lib/api';
import type { Photo } from '@/lib/api';

interface LightboxProps {
  token: string;
  photo: Photo;
  frameNo: number;
  dateLabel: string | null;
  threadTitle: string;
  communityName: string;
  onClose: () => void;
}

export default function Lightbox({
  token,
  photo,
  frameNo,
  dateLabel,
  threadTitle,
  communityName,
  onClose,
}: LightboxProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  async function handleFullSize() {
    try {
      const data = await api.recoverPhotoDownload(token, photo.id);
      window.open(data.download_url, '_blank', 'noopener,noreferrer');
    } catch {
    }
  }

  const no = String(frameNo).padStart(3, '0');

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Frame ${no}`}
      onClick={onClose}
    >
      <span className="lightbox__esc" aria-hidden="true">
        ESC TO CLOSE
      </span>
      <div className="lightbox__card" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox__img">
          {photo.thumbnail_url ? (
            <img src={photo.thumbnail_url} alt={`Frame ${no}`} />
          ) : (
            <span className="frame__empty">PHOTO</span>
          )}
        </div>
        <div className="lightbox__caption">
          <div>
            <h3 className="lightbox__title">
              Frame {no}
              {dateLabel ? ` — ${dateLabel}` : ''}
            </h3>
            <p className="lightbox__sub">
              {threadTitle} · {communityName}
            </p>
          </div>
          <div className="lightbox__buttons">
            <button
              type="button"
              className="btn btn--dark"
              onClick={handleFullSize}
            >
              Full size
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
