import { SEGMENT_PERIOD_OPTIONS, type SegmentPeriod } from '../lib/segmentPeriod';

interface Props {
  period: SegmentPeriod;
  customRange: { from: string; to: string };
  onPeriod: (period: SegmentPeriod) => void;
  onCustomRange: (range: { from: string; to: string }) => void;
}

export default function SegmentPeriodBar({
  period,
  customRange,
  onPeriod,
  onCustomRange,
}: Props) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {SEGMENT_PERIOD_OPTIONS.map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onPeriod(opt.id)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              border: period === opt.id ? '1px solid #0078D4' : '1px solid var(--cd-border)',
              background: period === opt.id ? 'rgba(0,120,212,0.12)' : 'transparent',
              color: period === opt.id ? '#0078D4' : 'var(--cd-text-muted)',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="date"
            value={customRange.from}
            max={customRange.to}
            onChange={e => onCustomRange({ ...customRange, from: e.target.value })}
            style={{
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--cd-border)',
              fontSize: 12,
              background: 'var(--cd-surface-2)',
              color: 'var(--cd-text)',
            }}
          />
          <span style={{ color: 'var(--cd-text-muted)', fontSize: 12 }}>to</span>
          <input
            type="date"
            value={customRange.to}
            min={customRange.from}
            onChange={e => onCustomRange({ ...customRange, to: e.target.value })}
            style={{
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--cd-border)',
              fontSize: 12,
              background: 'var(--cd-surface-2)',
              color: 'var(--cd-text)',
            }}
          />
        </div>
      )}
    </div>
  );
}
