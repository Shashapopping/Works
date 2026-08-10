import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  itemLabel?: string;
}

/** Shared Prev/Next pagination footer — matches the existing Fleet page pattern. */
export default function PageControls({ page, pageCount, from, to, total, hasPrev, hasNext, onPrev, onNext, itemLabel = 'items' }: Props) {
  if (total === 0) return null;

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '12px 16px', borderTop: '1px solid var(--cd-border)', flexWrap: 'wrap', gap: 10,
    }}>
      <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>
        Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} {itemLabel}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={onPrev}
          disabled={!hasPrev}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px',
            background: !hasPrev ? 'var(--cd-surface-2)' : 'var(--cd-surface)',
            border: '1px solid var(--cd-border)', borderRadius: 6,
            cursor: !hasPrev ? 'not-allowed' : 'pointer', fontSize: 12,
            color: !hasPrev ? 'var(--cd-text-soft, var(--cd-text-muted))' : 'var(--cd-text)',
          }}
        >
          <ChevronLeft size={13} /> Prev
        </button>
        <span style={{ fontSize: 12, color: 'var(--cd-text-muted)', minWidth: 70, textAlign: 'center' }}>
          Page {page + 1} of {pageCount}
        </span>
        <button
          onClick={onNext}
          disabled={!hasNext}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px',
            background: !hasNext ? 'var(--cd-surface-2)' : 'var(--cd-surface)',
            border: '1px solid var(--cd-border)', borderRadius: 6,
            cursor: !hasNext ? 'not-allowed' : 'pointer', fontSize: 12,
            color: !hasNext ? 'var(--cd-text-soft, var(--cd-text-muted))' : 'var(--cd-text)',
          }}
        >
          Next <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}
