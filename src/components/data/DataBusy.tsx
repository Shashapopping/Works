import type { CSSProperties, ReactNode } from 'react';

type SkelTone = 'label' | 'value' | 'sub' | 'line' | 'line-short' | 'line-mid' | 'block' | 'title';

const SKEL_CLASS: Record<SkelTone, string> = {
  label: 'bpl-skel bpl-skel--label',
  value: 'bpl-skel bpl-skel--value',
  sub: 'bpl-skel bpl-skel--sub',
  line: 'bpl-skel bpl-skel--line',
  'line-short': 'bpl-skel bpl-skel--line bpl-skel--line-short',
  'line-mid': 'bpl-skel bpl-skel--line bpl-skel--line-mid',
  block: 'bpl-skel bpl-skel--block',
  title: 'bpl-skel bpl-skel--title',
};

/** Raw shimmer bar — matches PageLoader / Trends chart language. */
export function Skel({
  tone = 'line',
  className = '',
  style,
}: {
  tone?: SkelTone;
  className?: string;
  style?: CSSProperties;
}) {
  return <span className={`${SKEL_CLASS[tone]} ${className}`.trim()} style={style} aria-hidden />;
}

/** Compact KPI number placeholder for metric cards. */
export function SkelValue({ wide }: { wide?: boolean } = {}) {
  return (
    <span
      className="bpl-skel bpl-skel--value bpl-data-skel-value"
      style={wide ? { width: '4.5rem' } : undefined}
      aria-hidden
    />
  );
}

/** Compact strip of KPI card skeletons. */
export function SkelKpiRow({ count = 4 }: { count?: number }) {
  return (
    <div className="bpl-data-skel-kpi-row" role="status" aria-label="Loading metrics">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bpl-data-skel-kpi" style={{ animationDelay: `${i * 50}ms` }}>
          <Skel tone="label" />
          <Skel tone="value" />
          <Skel tone="line-short" />
        </div>
      ))}
    </div>
  );
}

/** Chart body skeleton (reuses .bpl-chart-skel bars). */
export function SkelChart({ tall, label = 'Loading chart' }: { tall?: boolean; label?: string }) {
  const heights = [42, 68, 55, 82, 48, 74, 60, 36];
  return (
    <div
      className={`bpl-chart-skel${tall ? ' bpl-chart-skel--tall' : ''} bpl-data-skel-chart`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="bpl-chart-skel__bars" aria-hidden>
        {heights.map((h, i) => (
          <span key={i} style={{ height: `${h}%`, animationDelay: `${i * 70}ms` }} />
        ))}
      </div>
      <div className="bpl-chart-skel__footer">
        <span className="bpl-chart-skel__label">Preparing chart…</span>
      </div>
    </div>
  );
}

/** Table / list line skeletons. */
export function SkelTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bpl-data-skel-table" role="status" aria-label="Loading table">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="bpl-data-skel-table-row" style={{ animationDelay: `${i * 40}ms` }}>
          <Skel tone={i % 3 === 1 ? 'line-short' : i % 3 === 2 ? 'line-mid' : 'line'} />
        </div>
      ))}
    </div>
  );
}

type DataRegionVariant = 'value' | 'chart' | 'table' | 'kpi-row' | 'custom';

/**
 * Keep card chrome; replace body with skeleton while busy.
 * Never leave stale period numbers visible.
 */
export function DataRegion({
  busy,
  variant = 'custom',
  fallback,
  children,
  className = '',
  style,
  label = 'Loading',
  rows,
  kpiCount,
  tall,
}: {
  busy: boolean;
  variant?: DataRegionVariant;
  /** Used when variant is custom */
  fallback?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  label?: string;
  rows?: number;
  kpiCount?: number;
  tall?: boolean;
}) {
  let skeleton: ReactNode = fallback ?? null;
  if (busy) {
    if (variant === 'value') skeleton = <SkelValue />;
    else if (variant === 'chart') skeleton = <SkelChart tall={tall} label={label} />;
    else if (variant === 'table') skeleton = <SkelTable rows={rows} />;
    else if (variant === 'kpi-row') skeleton = <SkelKpiRow count={kpiCount} />;
    else if (!fallback) skeleton = <SkelTable rows={rows ?? 4} />;
  }

  return (
    <div
      className={`bpl-data-region${busy ? ' is-busy' : ''} ${className}`.trim()}
      style={style}
      aria-busy={busy || undefined}
      aria-live={busy ? 'polite' : undefined}
    >
      {busy ? (
        <>
          <div className="bpl-data-region__progress" aria-hidden />
          <div className="bpl-data-region__body">{skeleton}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
}
