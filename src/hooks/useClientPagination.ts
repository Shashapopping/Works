import { useEffect, useMemo, useState } from 'react';

/**
 * Client-side pagination over an already-complete row set.
 * KPIs / totals should use the full `rows` array, not `pageRows`.
 *
 * Pass `resetKey` (filters / date / search) to jump back to page 1.
 * Do NOT reset on every `rows` identity change — soft cache / silent
 * refresh replaces the array a few seconds later and would kick you
 * back to page 1.
 */
export function useClientPagination<T>(
  rows: T[],
  pageSize = 50,
  resetKey?: string | number | boolean | null,
) {
  const [page, setPage] = useState(0);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);

  useEffect(() => {
    setPage(0);
  }, [resetKey, pageSize]);

  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  const pageRows = useMemo(() => {
    const start = page * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize]);

  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return {
    page,
    setPage,
    pageSize,
    pageCount,
    pageRows,
    total,
    from,
    to,
    hasPrev: page > 0,
    hasNext: page < pageCount - 1,
    next: () => setPage(p => Math.min(pageCount - 1, p + 1)),
    prev: () => setPage(p => Math.max(0, p - 1)),
    goToIndex: (index: number) => {
      if (index < 0) return;
      setPage(Math.floor(index / pageSize));
    },
  };
}
