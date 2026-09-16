import Link from 'next/link';

export default function CommunityCard({ community }) {
  return (
    <Link href={`/c/${community.slug}`} className="ticket">
      <div className="ticket__title">{community.name}</div>
      <p className="ticket__desc">{community.description}</p>
      <div className="ticket__meta">
        <span className="tag tag--gold">
          {community.member_count} {community.member_count === 1 ? 'member' : 'members'}
        </span>
      </div>
    </Link>
  );
}
