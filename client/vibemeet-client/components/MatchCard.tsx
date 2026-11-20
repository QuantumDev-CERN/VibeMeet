import Link from 'next/link';
import type { MyPhoto } from '@/lib/api';
import { formatDate, toPercent } from '@/lib/format';

export type Verdict = 'confirmed' | 'pending' | 'rejected' | 'trusted';

interface MatchCardProps {
  photo: MyPhoto;
  status: Verdict;
  onConfirm: () => void;
  onReject: () => void;
  onRestore: () => void;
  busy: boolean;
}

export default function MatchCard({
  photo,
  status,
  onConfirm,
  onReject,
  onRestore,
  busy,
}: MatchCardProps) {
  const pct = toPercent(photo.confidence);
  const date = formatDate(photo.thread.event_date);

  return (
    <article className="match-card">
      <div className="match-card__photo">
        {photo.thumbnail_url ? (
          <img src={photo.thumbnail_url} alt={`Matched photograph ${photo.photo_id}`} />
        ) : (
          <span className="frame__empty">PHOTO</span>
        )}
      </div>
      <div className="match-card__body">
        <span className="match-card__likeness">
          {pct != null ? `${pct}% LIKENESS` : 'LIKELY YOU'}
        </span>
        <Link
          href={`/c/${photo.community.slug}/t/${photo.thread.id}`}
          className="match-card__title"
        >
          {photo.thread.title}
        </Link>
        <p className="match-card__meta">{photo.community.name}</p>
        {date && <p className="match-card__meta">{date}</p>}

        {status === 'confirmed' && (
          <>
            <span className="match-card__verdict match-card__verdict--yes">
              CONFIRMED — THAT&rsquo;S YOU
            </span>
            <div className="match-card__actions">
              <button
                type="button"
                className="btn"
                onClick={onRestore}
                disabled={busy}
              >
                {busy ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          </>
        )}

        {status === 'pending' && (
          <div className="match-card__actions">
            <button
              type="button"
              className="btn btn--dark"
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? 'Saving…' : "That's me"}
            </button>
            <button
              type="button"
              className="quiet-link"
              onClick={onReject}
              disabled={busy}
            >
              Not me
            </button>
          </div>
        )}

        {status === 'trusted' && (
          <span className="match-card__verdict match-card__verdict--yes">
            TRUSTED MATCH
          </span>
        )}

        {status === 'rejected' && (
          <>
            <span className="match-card__verdict match-card__verdict--no">
              MARKED — NOT YOU
            </span>
            <div className="match-card__actions">
              <button
                type="button"
                className="btn"
                onClick={onRestore}
                disabled={busy}
              >
                {busy ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          </>
        )}
      </div>
    </article>
  );
}
