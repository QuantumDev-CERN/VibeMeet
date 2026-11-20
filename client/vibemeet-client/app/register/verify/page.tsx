'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { ApiError } from '@/lib/api';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

function readErrorBody(err: unknown): Record<string, unknown> | null {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') {
    return err.body as Record<string, unknown>;
  }
  return null;
}

function VerifyPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';
  const { verifyRegister, resendOtp } = useAuth();

  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [expired, setExpired] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const code = digits.join('');
  const complete = code.length === CODE_LENGTH;

  function focusBox(index: number) {
    const clamped = Math.max(0, Math.min(CODE_LENGTH - 1, index));
    inputsRef.current[clamped]?.focus();
    setFocusedIndex(clamped);
  }

  function clearBoxes() {
    setDigits(Array(CODE_LENGTH).fill(''));
    focusBox(0);
  }

  function handleDigitChange(index: number, value: string) {
    if (value === '') {
      setDigits((prev) => {
        const next = [...prev];
        next[index] = '';
        return next;
      });
      return;
    }
    const digit = value.replace(/\D/g, '').slice(-1);
    if (!digit) return;
    setDigits((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (index < CODE_LENGTH - 1) focusBox(index + 1);
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && digits[index] === '') {
      e.preventDefault();
      setDigits((prev) => {
        const next = [...prev];
        next[Math.max(0, index - 1)] = '';
        return next;
      });
      focusBox(index - 1);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!pasted) return;
    setDigits((prev) => {
      const next = [...prev];
      for (let i = 0; i < pasted.length; i += 1) next[i] = pasted[i];
      return next;
    });
    focusBox(Math.min(pasted.length, CODE_LENGTH - 1));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !complete || !email) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await verifyRegister(email, code);
      router.push('/communities');
    } catch (err) {
      const body = readErrorBody(err);
      if (err instanceof ApiError && err.status === 410) {
        setExpired(true);
        setError('Code expired. Start again from the register page.');
      } else if (body?.new_code_sent) {
        setNotice('Too many tries — a new code has been sent to your email.');
        setCooldown(RESEND_COOLDOWN_SECONDS);
        clearBoxes();
      } else {
        setError(err instanceof Error ? err.message : 'Verification failed');
        clearBoxes();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (resending || cooldown > 0 || !email) return;
    setError('');
    setNotice('');
    setResending(true);
    try {
      await resendOtp(email);
      setNotice('New code sent.');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      clearBoxes();
    } catch (err) {
      const body = readErrorBody(err);
      if (err instanceof ApiError && err.status === 410) {
        setExpired(true);
        setError('Code expired. Start again from the register page.');
      } else {
        if (typeof body?.retry_after === 'number') setCooldown(body.retry_after);
        setError(err instanceof Error ? err.message : 'Could not resend the code');
      }
    } finally {
      setResending(false);
    }
  }

  if (!email) {
    return (
      <div className="otp-page">
        <div className="otp-page__inner">
          <p className="wordmark otp-page__wordmark">VibeMeet</p>
          <p className="alert alert--error" style={{ marginTop: 32 }}>
            No email found. Start again from the register page.
          </p>
          <Link href="/register" className="btn btn--dark btn--full">
            Back to register
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="otp-page">
      <button
        type="button"
        className="otp-page__back"
        aria-label="Back to register"
        onClick={() => router.push('/register')}
      >
        &larr;
      </button>

      <div className="otp-page__inner">
        <p className="wordmark otp-page__wordmark">VibeMeet</p>
        <p className="otp-page__tag">A photographic index of the night</p>

        <h1 className="otp-page__title">Enter your code to join</h1>
        <p className="otp-page__lede">
          To join, enter the code we sent to {email}.{' '}
          {cooldown > 0 ? (
            <span className="otp-page__resend--disabled">Resend code in {cooldown}s</span>
          ) : (
            <button
              type="button"
              className="otp-page__resend"
              onClick={handleResend}
              disabled={resending}
            >
              {resending ? 'Sending…' : 'Resend code'}
            </button>
          )}
        </p>

        <form onSubmit={handleSubmit}>
          {error && <p className="alert alert--error">{error}</p>}
          {notice && <p className="alert alert--success">{notice}</p>}

          <div className="otp-boxes" role="group" aria-label="6-digit verification code">
            {digits.map((digit, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputsRef.current[i] = el;
                }}
                className={`otp-box${focusedIndex === i ? ' otp-box--active' : ''}`}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={1}
                aria-label={`Digit ${i + 1}`}
                value={digit}
                disabled={busy || expired}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onPaste={handlePaste}
                onFocus={() => setFocusedIndex(i)}
              />
            ))}
          </div>

          <div className="otp-page__actions">
            <button
              type="submit"
              className="btn btn--dark btn--full"
              disabled={busy || !complete || expired}
            >
              {busy ? 'Verifying…' : 'Verify & Join'}
            </button>
          </div>
        </form>

        <p style={{ marginTop: 16 }}>
          <Link href="/register" className="link-underline">
            Wrong email? Go back to register
          </Link>
        </p>
        <p className="otp-page__hint">Code expires in 30 minutes · 5 tries per code</p>
        <p className="otp-page__foot">Set in Fraunces · Paper, ink and oxblood</p>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="otp-page">
          <div className="otp-page__inner">
            <p className="loading-line">Loading…</p>
          </div>
        </div>
      }
    >
      <VerifyPageInner />
    </Suspense>
  );
}
