'use client';

import { useRef, useState } from 'react';
import * as api from '@/lib/api';

const MIN_SELFIES = 2;
const MAX_SELFIES = 5;

export default function FaceRegistrationPanel({ token }) {
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | submitting | done
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);

  function handlePick(fileList) {
    const chosen = Array.from(fileList || []).slice(0, MAX_SELFIES);
    setFiles(chosen);
    setError('');
    setMessage('');
  }

  async function handleSubmit() {
    if (files.length < MIN_SELFIES) {
      setError(`Choose at least ${MIN_SELFIES} selfies.`);
      return;
    }
    setStatus('submitting');
    setError('');
    try {
      const data = await api.registerFace(token, files);
      setMessage(data.message);
      setStatus('done');
      setFiles([]);
    } catch (err) {
      setError(err.message);
      setStatus('idle');
    }
  }

  async function handleRemove() {
    setRemoving(true);
    setError('');
    setMessage('');
    try {
      const data = await api.deleteFace(token);
      setMessage(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="form-card">
      <h3 style={{ fontSize: 22, marginBottom: 8 }}>Face registration</h3>
      <p className="field-hint" style={{ marginBottom: 18 }}>
        Submit {MIN_SELFIES}–{MAX_SELFIES} clear selfies. VibeMeet averages them into one
        reference so it can recognize you in event photos — this only happens inside threads
        you search, never a global lookup.
      </p>

      {error && <p className="alert">{error}</p>}
      {message && <p className="alert alert--success">{message}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => handlePick(e.target.files)}
      />

      <div className="field-hint" style={{ marginBottom: 12 }}>
        {files.length > 0 ? `${files.length} selfie(s) selected` : 'No selfies selected yet'}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
          Choose selfies
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleSubmit}
          disabled={status === 'submitting' || files.length === 0}
        >
          {status === 'submitting' ? 'Submitting…' : 'Save face'}
        </button>
        <button type="button" className="btn btn--danger" onClick={handleRemove} disabled={removing}>
          {removing ? 'Removing…' : 'Remove registration'}
        </button>
      </div>
      <p className="field-hint" style={{ marginTop: 14 }}>
        Removing stops future matches. It won&apos;t erase photos you&apos;ve already been found in.
      </p>
    </div>
  );
}
