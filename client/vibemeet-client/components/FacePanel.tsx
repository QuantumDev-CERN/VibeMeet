'use client';

import { useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { hasFaceOnFile, markFaceOnFile, clearFaceOnFile, fetchFaceOnFile } from '@/lib/faceStatus';

const MIN_SELFIES = 2;
const MAX_SELFIES = 5;

interface FacePanelProps {
  token: string;
  userId: string;
}

export default function FacePanel({ token, userId }: FacePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done'>('idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  const [onFile, setOnFile] = useState(false);
  const [mode, setMode] = useState<'pick' | 'just-registered' | 'registered'>('pick');


  useEffect(() => {
    setOnFile(hasFaceOnFile(userId));
    setMode(hasFaceOnFile(userId) ? 'registered' : 'pick');
    let cancelled = false;
    fetchFaceOnFile(token, userId)
      .then((registered) => {
        if (cancelled) return;
        setOnFile(registered);
        setMode(registered ? 'registered' : 'pick');
      })
      .catch(() => {
      });
    return () => {
      cancelled = true;
    };
  }, [token, userId]);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  function handlePick(fileList: FileList | null) {
    const chosen = Array.from(fileList || []).slice(0, MAX_SELFIES);
    setFiles(chosen);
    setStatus('idle');
    setMode('pick');
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
    setMessage('');
    try {
        const data = await api.registerFace(token, files);
        setMessage(data.message);
        setStatus('done');
        setMode('just-registered');
        markFaceOnFile(userId);
        setOnFile(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
      setStatus('idle');
    }
  }

  function handleReRegister() {
    setFiles([]);
    setStatus('idle');
    setMessage('');
    setError('');
    setMode('pick');
  }

  async function handleRemove() {
    setRemoving(true);
    setError('');
    setMessage('');
    try {
        const data = await api.deleteFace(token);
        setMessage(data.message);
        clearFaceOnFile(userId);
        setOnFile(false);
        setMode('pick');
        setFiles([]);
        setStatus('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Withdrawal failed');
    } finally {
      setRemoving(false);
    }
  }

  const slots = Array.from({ length: 3 });

  return (
    <div className="sitting">
      <h3>The sitting</h3>
      <p className="sitting__lede">
        Submit {MIN_SELFIES} to {MAX_SELFIES} clear selfies. VibeMeet studies them into a
        single reference of your face, used only when you search a thread — never a
        global lookup, never without your say.
      </p>

      {error && <p className="alert alert--error" style={{ marginTop: 16 }}>{error}</p>}
      {message && <p className="alert alert--success" style={{ marginTop: 16 }}>{message}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => {
          handlePick(e.target.files);
          e.target.value = '';
        }}
      />
      {mode !== 'registered' && (
      <div className="selfies">
        {slots.map((_, i) =>
          previews[i] ? (
            <span className="selfie" key={i}>
              <img src={previews[i]} alt={`Selfie ${i + 1}`} />
            </span>
          ) : (
            <span className="selfie" key={i} aria-hidden="true">
              <span className="selfie__empty">SELFIE</span>
            </span>
          )
        )}
      </div>
      )}
      {mode === 'pick' && (
      <p className="sitting__count">
        {files.length > 0
          ? `${files.length} ${files.length === 1 ? 'portrait' : 'portraits'} selected`
          : 'No portraits selected yet'}
      </p>
      )}

      <div className="sitting__buttons">
        {mode === 'registered' ? (
          <button type="button" className="btn" onClick={handleReRegister}>
            Re-Register
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
              Choose portraits
            </button>
            <button
              type="button"
              className="btn btn--dark"
              onClick={handleSubmit}
              disabled={status === 'submitting' || files.length === 0}
            >
              {status === 'submitting' ? 'Registering…' : 'Register face'}
            </button>
          </>
        )}
      </div>
      <hr className="sitting__divider" />

      <button
        type="button"
        className="sitting__withdraw"
        onClick={handleRemove}
        disabled={removing}
      >
        {removing ? 'Withdrawing…' : 'Withdraw my face'}
      </button>
      <p className="sitting__note">
        Withdrawing stops future matches. It does not unfind photographs already matched
        to you.
      </p>

      {onFile && <p className="sitting__onfile">FACE ON FILE</p>}
    </div>
  );
}
