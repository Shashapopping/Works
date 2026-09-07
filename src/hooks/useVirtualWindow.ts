import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Windowed list indices for fixed-height rows inside a scroll container.
 */
export function useVirtualWindow({
  count,
  rowHeight,
  gap = 0,
  overscan = 10,
  containerRef,
}: {
  count: number;
  rowHeight: number;
  gap?: number;
  overscan?: number;
  containerRef: RefObject<HTMLElement | null>;
}) {
  const [range, setRange] = useState({ start: 0, end: Math.min(count, 30) });
  const stride = rowHeight + gap;

  const recompute = useCallback(() => {
    const el = containerRef.current;
    if (!el || count === 0) {
      setRange({ start: 0, end: 0 });
      return;
    }
    const scrollTop = el.scrollTop;
    const viewHeight = el.clientHeight || 320;
    const start = Math.max(0, Math.floor(scrollTop / stride) - overscan);
    const visible = Math.ceil(viewHeight / stride) + overscan * 2;
    const end = Math.min(count, start + visible);
    setRange(prev => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [containerRef, count, stride, overscan]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    recompute();
    el.addEventListener('scroll', recompute, { passive: true });
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', recompute);
      ro.disconnect();
    };
  }, [containerRef, recompute]);

  useEffect(() => {
    recompute();
  }, [count, recompute]);

  const paddingTop = range.start * stride;
  const paddingBottom = Math.max(0, (count - range.end) * stride);

  return { ...range, paddingTop, paddingBottom };
}
