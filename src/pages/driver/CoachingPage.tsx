import { useState, useMemo, useEffect, useDeferredValue } from 'react';
import { GraduationCap, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useFleet, authFetch } from '../../context/FleetContext';
import type { TripDriver } from '../../context/FleetContext';
import { isActiveDriver, isActiveDriverId } from '../../lib/driverUtils';
import {
  buildDriverSnapshots,
  qualifyCoaching,
  isDismissed,
  dismissFromQueue,
  getNotesForDriver,
  addCoachingNote,
  type DriverSnapshot,
} from '../../lib/driverInterventions';
import { COACHING_WINDOW_DAYS } from '../../config/interventionRules';
import { useClientPagination } from '../../hooks/useClientPagination';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import PageControls from '../../components/PageControls';

function NoteForm({ driver, onSaved }: { driver: DriverSnapshot; onSaved: () => void }) {
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const save = () => {
    if (!comment.trim()) return;
    setSaving(true);
    addCoachingNote(driver.key, driver.name, comment.trim());
    setComment('');
    setSaving(false);
    onSaved();
  };

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
      <input
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="Add a coaching note…"
        onKeyDown={e => { if (e.key === 'Enter') save(); }}
        style={{
          flex: 1, padding: '8px 12px', border: '1px solid var(--cd-border)', borderRadius: 8,
          fontSize: 13, background: 'var(--cd-surface)', color: 'var(--cd-text)', outline: 'none',
        }}
      />
      <button
        onClick={save}
        disabled={saving || !comment.trim()}
        style={{
          padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
          border: '1px solid var(--bpl-blue)', background: 'var(--bpl-blue)', color: '#fff',
          cursor: comment.trim() ? 'pointer' : 'not-allowed', opacity: comment.trim() ? 1 : 0.6,
        }}
      >
        Save note
      </button>
    </div>
  );
}

function CoachingRow({ driver, expanded, onToggle, onChanged }: {
  driver: DriverSnapshot; expanded: boolean; onToggle: () => void; onChanged: () => void;
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
          <div style={{ fontWeight: 600, color: 'var(--cd-text)', fontSize: 14 }}>{driver.name}</div>
          <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 2 }}>
            {driver.regNo} · {driver.assetName}
          </div>
        </div>
        <div style={{ textAlign: 'center', minWidth: 70 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: 'var(--cd-font-display)' }}>{consequence.displayScore}</div>
          <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>score /100</div>
        </div>
        <div style={{ textAlign: 'center', minWidth: 70 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>{consequence.counts.eventCount}</div>
          <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>events / {COACHING_WINDOW_DAYS}d</div>
        </div>
        <div style={{ textAlign: 'center', minWidth: 70 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>{notes.length}</div>
          <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>notes</div>
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
              Coaching notes
            </div>
            <button
              onClick={() => { dismissFromQueue('coaching', driver.key); onChanged(); }}
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
            <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>No notes yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {notes.map(n => (
                <div key={n.id} style={{ padding: '8px 10px', background: 'var(--cd-surface)', borderRadius: 8, border: '1px solid var(--cd-border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--cd-text)' }}>{n.comment}</div>
                  <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 4 }}>
                    {n.addedBy} · {new Date(n.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <NoteForm driver={driver} onSaved={onChanged} />
        </div>
      )}
    </div>
  );
}

export default function CoachingPage() {
  const { events } = useFleet();
  const [tripDrivers, setTripDrivers] = useState<TripDriver[]>([]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [refreshTick, setRefreshTick] = useState(0);
  const debouncedSearch = useDebouncedValue(search, 200);
  const deferredSearch = useDeferredValue(debouncedSearch);

  useEffect(() => {
    let cancelled = false;
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
            if (!prev) map.set(key, { ...d });
            else prev.totalDistanceKm += d.totalDistanceKm;
          }
        }
        if (!cancelled) setTripDrivers(Array.from(map.values()));
      } catch { /* keep empty */ }
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
    return Array.from(snapshots.values())
      .filter(d => qualifyCoaching(d) && !isDismissed('coaching', d))
      .sort((a, b) => a.consequence.displayScore - b.consequence.displayScore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, distanceByKey, refreshTick]);

  const visible = deferredSearch
    ? queue.filter(d => d.name.toLowerCase().includes(deferredSearch.toLowerCase()) || d.regNo.toLowerCase().includes(deferredSearch.toLowerCase()))
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
          <h1 className="bpl-page-title">Driver Management — Coaching</h1>
          <p className="bpl-page-subtitle">
            Drivers at or below a score of {70} or with 8+ scored events in the last {COACHING_WINDOW_DAYS} days
          </p>
        </div>

        <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 20 }}>
          <div className="bpl-kpi-card">
            <div className="bpl-kpi-label">In Coaching Queue</div>
            <div className="bpl-kpi-value">{queue.length}</div>
          </div>
          <div className="bpl-kpi-card" style={{ borderTop: '3px solid #CC0000' }}>
            <div className="bpl-kpi-label">Red Tier</div>
            <div className="bpl-kpi-value" style={{ color: '#CC0000' }}>{queue.filter(d => d.consequence.category === 'Red').length}</div>
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
          {visible.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--cd-text-muted)' }}>
              <GraduationCap size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
              <div>No drivers currently qualify for coaching</div>
            </div>
          ) : pagination.pageRows.map(d => (
            <CoachingRow
              key={d.key}
              driver={d}
              expanded={expanded.has(d.key)}
              onToggle={() => toggle(d.key)}
              onChanged={() => setRefreshTick(t => t + 1)}
            />
          ))}
        </div>

        {visible.length > 0 && (
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
