import { useState, useMemo, useEffect, useDeferredValue } from 'react';
import { Award, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useFleet, authFetch } from '../../context/FleetContext';
import type { TripDriver } from '../../context/FleetContext';
import { isActiveDriver, isActiveDriverId, displayDriverName } from '../../lib/driverUtils';
import { sanitizeTripDriver } from '../../lib/demoSanitize';
import MockNamesBadge from '../../components/MockNamesBadge';
import {
  buildDriverSnapshots,
  qualifyTraining,
  isDismissed,
  dismissFromQueue,
  getNotesForDriver,
  type DriverSnapshot,
} from '../../lib/driverInterventions';
import { COACHING_WINDOW_DAYS, TRAINING_SAME_LABEL_COUNT, TRAINING_SAME_LABEL_DAYS } from '../../config/interventionRules';
import { useClientPagination } from '../../hooks/useClientPagination';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import PageControls from '../../components/PageControls';
import { brandLabel } from '../../lib/branding';
import { SkelValue, SkelTable } from '../../components/data/DataBusy';

function TrainingRow({ driver, recurring, expanded, onToggle, onChanged }: {
  driver: DriverSnapshot; recurring: { label: string; count: number }; expanded: boolean; onToggle: () => void; onChanged: () => void;
}) {
  const { consequence } = driver;
  const color = consequence.categoryColor;
  const notes = getNotesForDriver(driver.key);

  return (
    <div className="bpl-card" style={{ overflow: 'hidden', borderLeft: `4px solid ${color}` }}>
      <div
        onClick={onToggle}
        style={{ padding: '14px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}
      >
        <div style={{ flex: '1 1 180px', minWidth: 160 }}>
          <div style={{ fontWeight: 600, color: 'var(--cd-text)', fontSize: 14 }}>{displayDriverName(driver.name)}</div>
          <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 2 }}>
            {driver.regNo} · {brandLabel(driver.assetName)}
          </div>
        </div>
        <div style={{ textAlign: 'center', minWidth: 150 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cd-text)' }}>{recurring.label}</div>
          <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>
            ×{recurring.count} in {TRAINING_SAME_LABEL_DAYS}d
          </div>
        </div>
        <div style={{ textAlign: 'center', minWidth: 70 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: 'var(--cd-font-display)' }}>{consequence.displayScore}</div>
          <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>score /100</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ padding: '3px 8px', borderRadius: 9999, fontSize: 10, fontWeight: 700, background: `${color}15`, color }}>
            {consequence.categoryLabel}
          </span>
          {expanded ? <ChevronUp size={16} color="var(--cd-text-muted)" /> : <ChevronDown size={16} color="var(--cd-text-muted)" />}
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--cd-border)', background: 'var(--cd-surface-2)', padding: '14px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Prior coaching notes
            </div>
            <button
              onClick={() => { dismissFromQueue('training', driver.key); onChanged(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6,
                fontSize: 11, fontWeight: 600, border: '1px solid var(--cd-border)', background: 'var(--cd-surface)',
                color: 'var(--cd-text-muted)', cursor: 'pointer',
              }}
            >
              <X size={11} /> Dismiss from queue
            </button>
          </div>

          {notes.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>No prior coaching notes for this driver.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {notes.slice(0, 5).map(n => (
                <div key={n.id} style={{ padding: '8px 10px', background: 'var(--cd-surface)', borderRadius: 8, border: '1px solid var(--cd-border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--cd-text)' }}>{n.comment}</div>
                  <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 4 }}>
                    {n.addedBy} · {new Date(n.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 8,
            background: `${color}10`, border: `1px solid ${color}25`, fontSize: 12, color: 'var(--cd-text)',
          }}>
            Recommended: enrol in refresher training for <strong>{recurring.label}</strong> — this driver repeated the same
            violation {recurring.count} times within {TRAINING_SAME_LABEL_DAYS} days.
          </div>
        </div>
      )}
    </div>
  );
}

export default function TrainingPage() {
  const { events, eventsLoading } = useFleet();
  const [tripDrivers, setTripDrivers] = useState<TripDriver[]>([]);
  const [tripLoading, setTripLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [refreshTick, setRefreshTick] = useState(0);
  const debouncedSearch = useDebouncedValue(search, 200);
  const deferredSearch = useDeferredValue(debouncedSearch);
  const seedBusy = eventsLoading || tripLoading;

  useEffect(() => {
    let cancelled = false;
    setTripLoading(true);
    (async () => {
      try {
        const [cur, last] = await Promise.all([
          authFetch('/api/driver-distance?range=currentMonth'),
          authFetch('/api/driver-distance?range=lastMonth'),
        ]);
        const map = new Map<string, TripDriver>();
        for (const res of [cur, last]) {
          if (!res.ok) continue;
          const data = await res.json();
          for (const d of (data.drivers || []) as TripDriver[]) {
            if (!isActiveDriver(d.driverName, d.driverId)) continue;
            const key = d.driverId || d.driverName;
            if (!key) continue;
            const prev = map.get(key);
            if (!prev) map.set(key, sanitizeTripDriver({ ...d }));
            else prev.totalDistanceKm += d.totalDistanceKm;
          }
        }
        if (!cancelled) setTripDrivers(Array.from(map.values()));
      } catch { /* keep empty */ }
      finally {
        if (!cancelled) setTripLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const distanceByKey = useMemo(() => {
    const m = new Map<string, number>();
    tripDrivers.forEach(t => {
      const key = (t.driverId && isActiveDriverId(t.driverId)) ? t.driverId : t.driverName;
      m.set(key, (m.get(key) || 0) + (t.totalDistanceKm || 0));
    });
    return m;
  }, [tripDrivers]);

  const queue = useMemo(() => {
    const snapshots = buildDriverSnapshots(events, distanceByKey, COACHING_WINDOW_DAYS);
    const list: { driver: DriverSnapshot; recurring: { label: string; count: number } }[] = [];
    for (const d of snapshots.values()) {
      if (isDismissed('training', d)) continue;
      const recurring = qualifyTraining(d);
      if (recurring) list.push({ driver: d, recurring });
    }
    return list.sort((a, b) => b.recurring.count - a.recurring.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, distanceByKey, refreshTick]);

  const visible = deferredSearch
    ? queue.filter(row => row.driver.name.toLowerCase().includes(deferredSearch.toLowerCase()) || row.driver.regNo.toLowerCase().includes(deferredSearch.toLowerCase()))
    : queue;

  const pagination = useClientPagination(visible, 25);

  const toggle = (key: string) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });

  return (
      <div>
        <div className="bpl-page-header">
          <h1 className="bpl-page-title">Driver Management — Training <MockNamesBadge /></h1>
          <p className="bpl-page-subtitle">
            Drivers repeating the same violation {TRAINING_SAME_LABEL_COUNT}+ times within {TRAINING_SAME_LABEL_DAYS} days
          </p>
        </div>

        <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 20 }}>
          <div className="bpl-kpi-card">
            <div className="bpl-kpi-label">In Training Queue</div>
            <div className="bpl-kpi-value">{seedBusy ? <SkelValue wide /> : queue.length}</div>
          </div>
          <div className="bpl-kpi-card" style={{ borderTop: '3px solid #d97706' }}>
            <div className="bpl-kpi-label">Needs Priority Review</div>
            <div className="bpl-kpi-value" style={{ color: '#d97706' }}>
              {seedBusy ? <SkelValue /> : queue.filter(r => r.driver.consequence.category !== 'Green').length}
            </div>
          </div>
        </div>

        <div style={{ position: 'relative', marginBottom: 16, maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--cd-text-muted)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search driver or vehicle..."
            style={{
              width: '100%', paddingLeft: 34, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
              border: '1px solid var(--cd-border)', borderRadius: 8, fontSize: 13,
              background: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {seedBusy ? (
            <div className="bpl-card" style={{ padding: 16 }}><SkelTable rows={6} /></div>
          ) : visible.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--cd-text-muted)' }}>
              <Award size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
              <div>No drivers currently qualify for training</div>
            </div>
          ) : pagination.pageRows.map(row => (
            <TrainingRow
              key={row.driver.key}
              driver={row.driver}
              recurring={row.recurring}
              expanded={expanded.has(row.driver.key)}
              onToggle={() => toggle(row.driver.key)}
              onChanged={() => setRefreshTick(t => t + 1)}
            />
          ))}
        </div>

        {!seedBusy && visible.length > 0 && (
          <div className="bpl-card" style={{ marginTop: 10, padding: 0 }}>
            <PageControls
              page={pagination.page} pageCount={pagination.pageCount}
              from={pagination.from} to={pagination.to} total={pagination.total}
              hasPrev={pagination.hasPrev} hasNext={pagination.hasNext}
              onPrev={pagination.prev} onNext={pagination.next}
              itemLabel="drivers"
            />
          </div>
        )}
      </div>
  );
}
