import { useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

export interface SortState<K extends string = string> {
  key: K | null;
  dir: SortDir;
}

/**
 * Click cycle: none → asc → desc → none (back to original order).
 */
export function useTableSort<T, K extends string>(
  rows: T[],
  getValue: (row: T, key: K) => string | number | null | undefined,
) {
  const [sort, setSort] = useState<SortState<K>>({ key: null, dir: 'asc' });

  const sorted = useMemo(() => {
    if (!sort.key) return rows;
    const key = sort.key;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = getValue(a, key);
      const bv = getValue(b, key);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        if (!Number.isFinite(av) && !Number.isFinite(bv)) return 0;
        if (!Number.isFinite(av)) return 1;
        if (!Number.isFinite(bv)) return -1;
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true }) * dir;
    });
  }, [rows, sort, getValue]);

  const toggle = (key: K) => {
    setSort(prev => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return { key: null, dir: 'asc' };
    });
  };

  const ariaSort = (key: K): 'ascending' | 'descending' | 'none' => {
    if (sort.key !== key) return 'none';
    return sort.dir === 'asc' ? 'ascending' : 'descending';
  };

  const indicator = (key: K) => {
    if (sort.key !== key) return '';
    return sort.dir === 'asc' ? ' ↑' : ' ↓';
  };

  return { sorted, sort, toggle, ariaSort, indicator, clear: () => setSort({ key: null, dir: 'asc' }) };
}
