'use client';

interface ClientPagination {
  page: number;
  total_pages: number;
  total: number;
  has_next: boolean;
  has_prev: boolean;
}

interface PaginationProps {
  pagination: ClientPagination | null;
  onPage: (page: number) => void;
  itemWord?: string;
}

export default function Pagination({ pagination, onPage, itemWord = 'frames' }: PaginationProps) {
  if (!pagination || pagination.total_pages <= 1) return null;
  const singular = itemWord.endsWith('s') ? itemWord.slice(0, -1) : itemWord;
  return (
    <div className="sheet-foot">
      <p className="sheet-foot__line">
        Page {pagination.page} of {pagination.total_pages} — {pagination.total}{' '}
        {pagination.total === 1 ? singular : itemWord}
      </p>
      <div className="pager">
        <button
          className="btn btn--sm"
          type="button"
          disabled={!pagination.has_prev}
          onClick={() => onPage(pagination.page - 1)}
        >
          &larr; Previous
        </button>
        <button
          className="btn btn--sm"
          type="button"
          disabled={!pagination.has_next}
          onClick={() => onPage(pagination.page + 1)}
        >
          Next &rarr;
        </button>
      </div>
    </div>
  );
}
