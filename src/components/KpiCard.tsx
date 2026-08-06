import { Info } from 'lucide-react';

/** Shared KPI tile with an info affordance explaining how the metric is calculated. */
export function KpiCard({
  label, value, sub, color, icon: Icon, tip,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  icon: React.ElementType;
  /** Plain-language explanation shown on hover of the ⓘ icon */
  tip: string;
}) {
  return (
    <div className="bpl-kpi-card" style={{ borderTop: `3px solid ${color}` }} title={tip}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <div className="bpl-kpi-label" style={{ margin: 0 }}>{label}</div>
          <span
            title={tip}
            aria-label={tip}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
              border: '1px solid var(--cd-border)', color: 'var(--cd-text-muted)',
              cursor: 'help',
            }}
          >
            <Info size={9} strokeWidth={2.5} />
          </span>
        </div>
        <Icon size={15} style={{ color, opacity: 0.65, flexShrink: 0 }} />
      </div>
      <div className="bpl-kpi-value" style={{ color }}>{value}</div>
      {sub && <div className="bpl-kpi-sub">{sub}</div>}
    </div>
  );
}
