import Link from 'next/link';

function formatDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ThreadRow({ thread, communitySlug }) {
  const date = formatDate(thread.event_date);
  return (
    <Link href={`/c/${communitySlug}/t/${thread.id}`} className="thread-row">
      <div>
        <div className="thread-row__title">{thread.title}</div>
        <div className="thread-row__meta">
          {date || thread.location ? (
            <span className="tag-row">
              {date && <span className="tag">{date}</span>}
              {thread.location && <span className="tag">{thread.location}</span>}
            </span>
          ) : (
            'Details coming soon'
          )}
        </div>
      </div>
      <span className="thread-row__go">View photos</span>
    </Link>
  );
}
