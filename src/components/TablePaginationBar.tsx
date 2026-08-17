type Props = {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  prev: () => void;
  next: () => void;
  /** Only show bar when total exceeds this (default 50). */
  minTotal?: number;
};

/** Shared client-pagination footer (Trips-style). */
export default function TablePaginationBar({
  page,
  pageCount,
  from,
  to,
  total,
  hasPrev,
  hasNext,
  prev,
  next,
  minTotal = 50,
}: Props) {
  if (total <= minTotal) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap',
      padding: '10px 16px', borderTop: '1px solid var(--cd-border)', fontSize: 11, color: 'var(--cd-text-muted)',
    }}>
      <span>Showing {from}–{to} of {total}</span>
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <button
          type="button"
          disabled={!hasPrev}
          onClick={prev}
          style={{
            padding: '2px 8px', borderRadius: 6, fontSize: 11,
            cursor: hasPrev ? 'pointer' : 'default',
            border: '1px solid var(--cd-border)',
            background: 'var(--cd-surface-2)',
            color: hasPrev ? 'var(--cd-text)' : 'var(--cd-text-soft)',
          }}
        >
          Prev
        </button>
        <span>Page {page + 1} / {pageCount}</span>
        <button
          type="button"
          disabled={!hasNext}
          onClick={next}
          style={{
            padding: '2px 8px', borderRadius: 6, fontSize: 11,
            cursor: hasNext ? 'pointer' : 'default',
            border: '1px solid var(--cd-border)',
            background: 'var(--cd-surface-2)',
            color: hasNext ? 'var(--cd-text)' : 'var(--cd-text-soft)',
          }}
        >
          Next
        </button>
      </span>
    </div>
  );
}
