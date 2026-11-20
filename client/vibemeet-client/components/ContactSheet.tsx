'use client';

import type { Photo, SearchMatch } from '@/lib/api';
import { toPercent } from '@/lib/format';

interface ContactSheetProps {
  photos: Photo[];
  matches: SearchMatch[];
  offset?: number;
  numberOf?: (photo: Photo, index: number) => number;
  onOpen: (photo: Photo) => void;
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: (photoId: string) => void;
  showScores?: boolean;
}

export default function ContactSheet({
  photos,
  matches,
  offset = 0,
  numberOf,
  onOpen,
  selectMode,
  selected,
  onToggleSelect,
  showScores = true,
}: ContactSheetProps) {
  const matchById = new Map(matches.map((m) => [m.photo_id, m]));

  return (
    <div className="sheet-grid">
      {photos.map((photo, i) => {
        const frameNo = numberOf ? numberOf(photo, i) : offset + i + 1;
        const no = String(frameNo).padStart(3, '0');
        const match = matchById.get(photo.id);
        const isMatch = Boolean(match);
        const isSelected = selected.has(photo.id);
        const pct = toPercent(match?.similarity);

        const label = showScores
          ? isMatch
            ? pct != null
              ? `YOU — ${pct}%`
              : 'YOU'
            : photo.indexed
              ? photo.face_count === 1
                ? '1 FACE'
                : `${photo.face_count} FACES`
              : 'STILL INDEXING'
          : isMatch
            ? 'YOU'
            : photo.indexed
              ? ''
              : 'STILL INDEXING';

        function handleClick() {
          if (selectMode && isMatch) onToggleSelect(photo.id);
          else onOpen(photo);
        }

        return (
          <button
            key={photo.id}
            type="button"
            className={`frame${isMatch ? ' frame--match' : ''}`}
            onClick={handleClick}
            aria-label={
              isMatch
                ? `Frame ${no}, ${label}, select for download`
                : `Frame ${no}, open lightbox`
            }
          >
            <span className="frame__no">{no}</span>
            {photo.thumbnail_url ? (
              <img src={photo.thumbnail_url} alt="" loading="lazy" />
            ) : (
              <span className="frame__empty">PHOTO</span>
            )}
            {label !== '' && (
              <span
                className={`frame__label${isMatch ? ' frame__label--match' : ''}`}
              >
                {label}
              </span>
            )}
            {selectMode && isMatch && (
              <input
                className="frame__check"
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggleSelect(photo.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Select frame ${no} for download`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
