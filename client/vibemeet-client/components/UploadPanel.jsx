'use client';

import { useRef, useState } from 'react';
import * as api from '@/lib/api';

export default function UploadPanel({ token, threadId, onUploaded }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState(''); // '', 'uploading', 'done'
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setError('');
    setStatus('uploading');
    setProgress({ done: 0, total: files.length });

    // The API accepts one file per request — send them one at a time so a
    // single bad file doesn't fail the whole batch, and so progress is honest.
    for (let i = 0; i < files.length; i++) {
      try {
        await api.uploadPhoto(token, threadId, files[i]);
      } catch (err) {
        setError(`${files[i].name}: ${err.message}`);
      }
      setProgress({ done: i + 1, total: files.length });
    }

    setStatus('done');
    onUploaded?.();
    setTimeout(() => setStatus(''), 2000);
  }

  return (
    <div
      className={`dropzone ${dragging ? 'dropzone--active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        uploadFiles(e.dataTransfer.files);
      }}
    >
      <div>
        <strong>Add photos from this event</strong>
        <p>
          {status === 'uploading'
            ? `Uploading ${progress.done}/${progress.total}…`
            : status === 'done'
            ? 'Uploaded. New photos are being indexed for search now.'
            : error || 'Drop images here, or choose files. JPEG, PNG, or WebP, up to 10MB each.'}
        </p>
      </div>
      <div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => uploadFiles(e.target.files)}
        />
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => inputRef.current?.click()}
          disabled={status === 'uploading'}
        >
          Choose photos
        </button>
      </div>
    </div>
  );
}
