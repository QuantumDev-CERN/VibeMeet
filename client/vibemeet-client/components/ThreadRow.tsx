import Link from 'next/link';
import type { Thread } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface ThreadRowProps {
  thread: Thread;
  communitySlug: string;
  index: number;
  photoCount?: number | null;
}

export default function ThreadRow({ thread, communitySlug, index, photoCount }: ThreadRowProps) {
  const no = String(index + 1).padStart(2, '0');
  const date = formatDate(thread.event_date);
  return (
    <Link href={`/c/${communitySlug}/t/${thread.id}`} className="index-row">
      <span className="index-row__no">{no}</span>
      <span>
        <span className="index-row__name">{thread.title}</span>
        <span className="index-row__meta">
          {date && <span>{date}</span>}
          {thread.location && <span>{thread.location}</span>}
          {photoCount != null && (
            <span>
              {photoCount} {photoCount === 1 ? 'photograph' : 'photographs'}
            </span>
          )}
        </span>
      </span>
      <span className="index-row__arrow" aria-hidden="true">
        &rarr;
      </span>
    </Link>
  );
}
