'use client';

import { useRef, useState } from 'react';
import * as api from '@/lib/api';

interface UploadPanelProps {
  token: string;
  threadId: string;
  onUploaded: () => void;
}

export default function UploadPanel({ token, threadId, onUploaded }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');

  async function uploadFiles(fileList: FileList | null) {
    const files = Array.from(fileList || []);
    if (files.length === 0 || status === 'uploading') return;
    setError('');
    setStatus('uploading');
    setProgress({ done: 0, total: files.length });

    for (let i = 0; i < files.length; i++) {
      try {
        await api.uploadPhoto(token, threadId, files[i]);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        setError((prev) => (prev ? `${prev} ` : '') + `${files[i].name}: ${message}`);
      }
      setProgress({ done: i + 1, total: files.length });
    }

    setStatus('done');
    onUploaded();
    window.setTimeout(() => setStatus('idle'), 4000);
  }

  return (
    <div
      className={`dropzone${dragging ? ' dropzone--active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void uploadFiles(e.dataTransfer.files);
      }}
    >
      <p className="dropzone__title">File your photographs</p>
      <p className="dropzone__sub">
        {status === 'uploading'
          ? `Uploading ${progress.done} of ${progress.total}…`
          : status === 'done'
            ? error
              ? 'Some frames could not be filed — see below.'
              : 'Filed.'
            : 'Drop the evening\u2019s roll here — it will be developed, indexed, and laid on the sheet below.'}
      </p>
      <div className="dropzone__action">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => {
            void uploadFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="btn"
          onClick={() => inputRef.current?.click()}
          disabled={status === 'uploading'}
        >
          {status === 'uploading'
            ? `Uploading ${progress.done}/${progress.total}`
            : 'Choose files'}
        </button>
      </div>
      {error && status !== 'uploading' && <span className="alert alert--error" style={{ margin: 0, flexBasis: '100%' }}>{error}</span>}
    </div>
  );
}
