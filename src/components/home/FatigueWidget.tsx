import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useFleet } from '../../context/FleetContext';
import { fmtHosMinutes, type HosRecord } from '../../lib/hos';
import { DEMO_BRANDING, demoDriverLabel } from '../../config/demoBranding';
import { isActiveDriver } from '../../lib/driverUtils';
import { SkelValue } from '../data/DataBusy';

const HOME_FATIGUE_SLOTS = 4;

const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  compliant: { label: 'Compliant', bg: 'rgba(22,163,74,0.12)', color: '#16a34a' },
  warning: { label: 'At risk', bg: 'rgba(217,119,6,0.12)', color: '#d97706' },
  violation: { label: 'Violation', bg: 'rgba(204,0,0,0.12)', color: '#CC0000' },
};

function scrub(list: HosRecord[]): HosRecord[] {
  if (!DEMO_BRANDING) return list;
  return list.map(r => ({
    ...r,
    driverName: isActiveDriver(r.driverName, r.id) ? demoDriverLabel(r.driverName) : r.driverName,
  }));
}

function continuousMinutes(r: HosRecord) {
  return Math.max(
    r.maxContinuousMinutes ?? 0,
    r.currentBlockMinutes ?? 0,
    (r.continuousMinutes && r.continuousMinutes > 0) ? r.continuousMinutes : 0,
  );
}

function rank(r: HosRecord) {
  return (r.breaches ?? 0) * 1_000_000
    + (r.status === 'violation' ? 100_000 : r.status === 'warning' ? 50_000 : 0)
    + continuousMinutes(r);
}

/** Home Fatigue card — same HOS records as Fatigue page (FleetContext). */
export default function FatigueWidget() {
  const { hosRecords: raw, hosLoading: loading } = useFleet();

  const hosRecords = useMemo(() => scrub(raw), [raw]);

  const filtered = useMemo(() => {
    const list = [...hosRecords].sort((a, b) => rank(b) - rank(a));
    return list.slice(0, HOME_FATIGUE_SLOTS);
  }, [hosRecords]);

  const counts = useMemo(() => ({
    warning: hosRecords.filter(r => r.status === 'warning').length,
    violation: hosRecords.filter(r => (r.breaches ?? 0) > 0 || r.status === 'violation').length,
  }), [hosRecords]);

  return (
    <div className="bpl-card bpl-home-mid-panel">
      <div className="bpl-card-header bpl-trips-header">
        <span className="bpl-card-title">Fatigue</span>
        <div className="bpl-trips-header-right">
          <Link to="/drivers/fatigue" className="bpl-card-link">See all</Link>
        </div>
      </div>
      <div className="bpl-card-body bpl-trips-body">
        {loading && filtered.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--cd-text-muted)', padding: '12px 0' }}>
            <SkelValue wide />
          </div>
        ) : (
          <>
            {(counts.warning > 0 || counts.violation > 0) && (
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginBottom: 8 }}>
                {counts.violation > 0 && (
                  <span style={{ color: '#CC0000', fontWeight: 600 }}>
                    {counts.violation} violation{counts.violation === 1 ? '' : 's'}
                  </span>
                )}
                {counts.violation > 0 && counts.warning > 0 && ' · '}
                {counts.warning > 0 && (
                  <span style={{ color: '#d97706', fontWeight: 600 }}>
                    {counts.warning} at risk
                  </span>
                )}
              </div>
            )}
            {filtered.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--cd-text-muted)', padding: '12px 0' }}>
                No fatigue records for today yet.
              </div>
            ) : filtered.map(r => {
              const meta = STATUS_META[r.status] ?? STATUS_META.compliant;
              const continuous = continuousMinutes(r);
              return (
                <Link key={r.id} to="/drivers/fatigue" className="bpl-trip-item bpl-widget-row-link">
                  <div className="bpl-trip-top">
                    <div>
                      <div className="bpl-trip-vehicle">{r.driverName}</div>
                      <div className="bpl-trip-driver">
                        {r.vehicleReg || '—'}{r.site ? ` · ${r.site}` : ''}
                      </div>
                    </div>
                    <span className="bpl-trip-status" style={{ background: meta.bg, color: meta.color }}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="bpl-trip-eta">
                    Drive block {fmtHosMinutes(continuous)}
                    {r.driveLimitMinutes ? ` / ${fmtHosMinutes(r.driveLimitMinutes)}` : ''}
                    {(r.breaches ?? 0) > 0 ? ` · ${r.breaches} breach${r.breaches === 1 ? '' : 'es'}` : ''}
                  </div>
                </Link>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
