import Link from 'next/link';

export default function MatchCard({ match, onConfirm, onReject, busy }) {
  return (
    <div className="match-card">
      <div className="match-card__photo">
        {match.thumbnail_url && <img src={match.thumbnail_url} alt="" />}
      </div>
      <div className="match-card__body">
        <Link href={`/c/${match.community.slug}/t/${match.thread.id}`} className="match-card__thread">
          {match.thread.title}
        </Link>
        <div className="match-card__community">{match.community.name}</div>
        <div className="match-card__actions">
          <button
            type="button"
            className="btn btn--sm"
            style={match.confirmed === true ? { borderColor: 'var(--success)', color: 'var(--success)' } : undefined}
            onClick={() => onConfirm(match.photo_id)}
            disabled={busy}
          >
            That&apos;s me
          </button>
          <button
            type="button"
            className="btn btn--sm btn--danger"
            onClick={() => onReject(match.photo_id)}
            disabled={busy}
          >
            Not me
          </button>
        </div>
      </div>
    </div>
  );
}
