import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

interface Props {
  text: string;
  /** @deprecated Prefer aria via text; kept for call sites that pass a short name. */
  label?: string;
  color?: string;
  /** Prefer popover opening toward this side of the trigger. */
  align?: 'left' | 'right';
  size?: number;
  style?: CSSProperties;
}

/** Small (i) control with click-to-open explanation — portaled so parents can't clip it. */
export default function InfoTip({
  text,
  label,
  color = 'var(--cd-text-muted)',
  align = 'right',
  size = 12,
  style,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const place = () => {
      const btn = wrapRef.current!.getBoundingClientRect();
      const pop = popRef.current?.getBoundingClientRect();
      const width = Math.min(pop?.width || 280, window.innerWidth - 16);
      const height = pop?.height ?? 80;
      const gap = 6;
      let left = align === 'left' ? btn.left : btn.right - width;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top = btn.bottom + gap;
      if (top + height > window.innerHeight - 8 && btn.top - gap - height > 8) {
        top = btn.top - gap - height;
      }
      setPos({ top, left });
    };
    place();
    requestAnimationFrame(place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, align, text]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="bpl-status-info-wrap"
      onClick={e => e.stopPropagation()}
      style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: 4, flexShrink: 0, ...style }}
    >
      <button
        type="button"
        className="bpl-status-info-btn"
        aria-label={label ? `More info: ${label}` : 'More info'}
        aria-expanded={open}
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        style={{ color, width: 18, height: 18 }}
      >
        <Info size={size} strokeWidth={2.25} />
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          className="bpl-status-info-popover bpl-status-info-popover--portal"
          role="dialog"
          style={{
            position: 'fixed',
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            right: 'auto',
            zIndex: 10000,
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          {text}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Table header cell with an info tip. */
export function ThInfo({
  label,
  tip,
  align,
  onClick,
  'aria-sort': ariaSort,
}: {
  label: string;
  tip: string;
  align?: 'left' | 'right';
  onClick?: () => void;
  'aria-sort'?: 'ascending' | 'descending' | 'none';
}) {
  return (
    <th
      aria-sort={ariaSort}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer', userSelect: 'none' } : undefined}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
        {label}
        <InfoTip text={tip} align={align} />
      </span>
    </th>
  );
}
