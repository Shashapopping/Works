import { useEffect, useMemo, useState } from 'react';

/**
 * Client-side pagination over an already-complete row set.
 * KPIs / totals should be computed from the full `rows` array passed in,
 * not from `pageRows` — this hook only slices what gets rendered.
 */
export function useClientPagination<T>(rows: T[], pageSize = 50) {
  const [page, setPage] = useState(0);

  // Reset to page 0 whenever the underlying (filtered) row count changes,
  // so a search/filter change never leaves the user stranded on an empty page.
  useEffect(() => {
    setPage(0);
  }, [rows.length]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));

  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [pageCount, page]);

  const pageRows = useMemo(() => {
    const start = page * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize]);

  const total = rows.length;
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, page * pageSize + pageSize);
  const hasPrev = page > 0;
  const hasNext = page < pageCount - 1;

  return {
    page,
    setPage,
    pageCount,
    pageRows,
    total,
    from,
    to,
    hasPrev,
    hasNext,
    prev: () => setPage(p => Math.max(0, p - 1)),
    next: () => setPage(p => Math.min(pageCount - 1, p + 1)),
    /** Jump to whichever page contains the given row index (e.g. for deep-links). */
    goToIndex: (index: number) => {
      if (index < 0) return;
      setPage(Math.floor(index / pageSize));
    },
  };
}
