import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  AlertTriangle, Car, Download, FileText, Maximize2, Minimize2, Settings, Shield, X,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { authFetch } from '../context/FleetContext';
import type { LogEntry } from '../context/FleetContext';
import {
  EVENT_METRICS,
  RELATABLE_EVENTS,
  WIDGET_DEFAULTS,
  buildRankFromAggregate,
  buildStackedFromAggregate,
  defaultSettings,
  formatDateCaptionFromAggregate,
  formatMetricValue,
  legendSeries,
  needsDistanceMetric,
  preaggregateRelatableEvents,
  type EventDayAggregate,
  type WidgetId,
  type WidgetSettings,
} from '../lib/mixEventInsights';

const ICON_MAP = {
  file: FileText,
  warning: AlertTriangle,
  car: Car,
  shield: Shield,
};

function MixSettingsModal({
  open,
  settings,
  onCancel,
  onApply,
}: {
  open: boolean;
  settings: WidgetSettings;
  onCancel: () => void;
  onApply: (next: WidgetSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setSearch('');
    }
  }, [open, settings]);

  if (!open) return null;

  const filtered = RELATABLE_EVENTS.filter(e =>
    e.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const toggleEvent = (label: (typeof RELATABLE_EVENTS)[number]) => {
    setDraft(prev => {
      const has = prev.selectedEvents.includes(label);
      if (has) return { ...prev, selectedEvents: prev.selectedEvents.filter(x => x !== label) };
      if (prev.selectedEvents.length >= 25) return prev;
      return { ...prev, selectedEvents: [...prev.selectedEvents, label] };
    });
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        className="bpl-card"
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(440px, 96vw)', maxHeight: '90vh', overflow: 'hidden',
          display: 'flex', flexDirection: 'column', borderRadius: 8,
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderBottom: '1px solid var(--cd-border)',
        }}>
          <strong style={{ fontSize: 16, color: 'var(--cd-text)' }}>Events</strong>
          <button type="button" onClick={onCancel} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--cd-text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 16, overflow: 'auto' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 10 }}>
            Select event metric to display
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
            {EVENT_METRICS.map(m => {
              const selected = draft.metric === m.id;
              return (
                <label
                  key={m.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                    fontSize: 13, color: 'var(--cd-text)',
                  }}
                >
                  <span style={{
                    width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                    border: `1.5px solid ${selected ? '#0d9488' : 'var(--cd-border)'}`,
                    background: selected ? '#0d9488' : 'var(--cd-surface)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 12, fontWeight: 700,
                  }}>
                    {selected ? '✓' : ''}
                  </span>
                  <input
                    type="radio"
                    name="event-metric"
                    checked={selected}
                    onChange={() => setDraft(prev => ({ ...prev, metric: m.id }))}
                    style={{ display: 'none' }}
                  />
                  {m.label}
                </label>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cd-text)' }}>
              Select events (max. 25)
            </div>
            <button
              type="button"
              onClick={() => setDraft(prev => ({ ...prev, selectedEvents: [] }))}
              style={{ border: 'none', background: 'transparent', color: '#0d9488', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
            >
              Clear all
            </button>
          </div>

          <input
            type="search"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', marginBottom: 10, padding: '8px 10px', borderRadius: 6,
              border: '1px solid var(--cd-border)', background: 'var(--cd-surface-2)',
              color: 'var(--cd-text)', fontSize: 13, outline: 'none',
            }}
          />

          <div style={{
            border: '1px solid var(--cd-border)', borderRadius: 6,
            maxHeight: 220, overflow: 'auto', background: 'var(--cd-surface)',
          }}>
            {filtered.map(label => {
              const checked = draft.selectedEvents.includes(label);
              return (
                <label
                  key={label}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderBottom: '1px solid var(--cd-border)',
                    cursor: 'pointer', fontSize: 13, color: 'var(--cd-text)',
                  }}
                >
                  <span style={{
                    width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                    border: `1.5px solid ${checked ? '#0d9488' : 'var(--cd-border)'}`,
                    background: checked ? '#0d9488' : 'var(--cd-surface)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 11, fontWeight: 700,
                  }}>
                    {checked ? '✓' : ''}
                  </span>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleEvent(label)}
                    style={{ display: 'none' }}
                  />
                  {label}
                </label>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--cd-text-muted)', fontSize: 12 }}>
                No matching events
              </div>
            )}
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 10,
          padding: '12px 16px', borderTop: '1px solid var(--cd-border)',
        }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '8px 16px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
              border: '1px solid var(--cd-border)', background: 'var(--cd-surface)', color: 'var(--cd-text-muted)',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onApply(draft)}
            style={{
              padding: '8px 18px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
              border: 'none', background: '#0d9488', color: '#fff', fontWeight: 600,
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function MixWidgetCard({
  id,
  agg,
  caption,
  chartsReady,
  distanceKm,
  settings,
  onChangeSettings,
}: {
  id: WidgetId;
  agg: EventDayAggregate;
  caption: string;
  chartsReady: boolean;
  distanceKm: number;
  settings: WidgetSettings;
  onChangeSettings: (next: WidgetSettings) => void;
}) {
  const meta = WIDGET_DEFAULTS[id];
  const Icon = ICON_MAP[meta.icon];
  const [fullscreen, setFullscreen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const series = useMemo(() => legendSeries(settings.selectedEvents), [settings.selectedEvents]);

  const stacked = useMemo(
    () => buildStackedFromAggregate(agg, settings.selectedEvents, settings.metric, distanceKm),
    [agg, settings, distanceKm],
  );
  const ranked = useMemo(
    () => buildRankFromAggregate(agg, settings.selectedEvents, settings.metric, distanceKm),
    [agg, settings, distanceKm],
  );

  const downloadCsv = () => {
    let csv = '';
    if (meta.chart === 'rank') {
      csv = ['Event,Value,Occurrences', ...ranked.map(r => `${r.name},${r.value},${r.raw}`)].join('\n');
    } else {
      const header = ['Day', ...series.map(s => s.legend)];
      const lines = stacked.map(row => [row.label, ...series.map(s => row[s.stackKey] ?? 0)].join(','));
      csv = [header.join(','), ...lines].join('\n');
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const yFmt = (v: number) => formatMetricValue(Number(v) || 0, settings.metric);

  const chartBody = !chartsReady ? (
    <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>
      Loading chart…
    </div>
  ) : meta.chart === 'rank' ? (
    ranked.length === 0 ? (
      <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--cd-text-muted)', fontSize: 13 }}>No events</div>
    ) : (
      <ResponsiveContainer width="100%" height={fullscreen ? 420 : 260}>
        <BarChart data={ranked} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.08)" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={yFmt} />
          <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(v: number) => [yFmt(v), EVENT_METRICS.find(m => m.id === settings.metric)?.label || 'Value']}
            contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12 }}
          />
          <Bar dataKey="value" name="Events" fill="#368ddd" maxBarSize={14} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    )
  ) : (
    stacked.length === 0 ? (
      <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--cd-text-muted)', fontSize: 13 }}>No events</div>
    ) : (
      <>
        <ResponsiveContainer width="100%" height={fullscreen ? 420 : 240}>
          <BarChart data={stacked} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="rgba(0,0,0,0.08)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#1b1d1c' }} />
            <YAxis tick={{ fontSize: 11, fill: '#1b1d1c' }} tickFormatter={yFmt} width={48} />
            <Tooltip
              formatter={(v: number, name: string) => [yFmt(Number(v)), name]}
              contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12 }}
            />
            {series.map(s => (
              <Bar
                key={s.stackKey}
                dataKey={s.stackKey}
                name={s.legend}
                stackId="a"
                fill={s.color}
                maxBarSize={72}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center', marginTop: 6 }}>
          {series.map(s => (
            <span key={s.stackKey} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#333' }}>
              <span style={{ width: 14, height: 3, background: s.color, display: 'inline-block' }} />
              {s.legend}
            </span>
          ))}
        </div>
      </>
    )
  );

  const card = (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minHeight: fullscreen ? undefined : 360,
        ...(fullscreen ? { width: 'min(960px, 96vw)', maxHeight: '92vh' } : {}),
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderBottom: '1px solid #eef0f2', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Icon size={15} color="#6b7280" />
          <strong style={{
            fontSize: 12, letterSpacing: '0.02em', color: '#374151',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {meta.title}
          </strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {[
            { title: 'Take snapshot', Icon: Download, onClick: downloadCsv },
            { title: fullscreen ? 'Exit fullscreen' : 'Fullscreen', Icon: fullscreen ? Minimize2 : Maximize2, onClick: () => setFullscreen(f => !f) },
            { title: 'Settings', Icon: Settings, onClick: () => setSettingsOpen(true) },
          ].map((a, i) => (
            <button
              key={a.title}
              type="button"
              title={a.title}
              onClick={a.onClick}
              style={{
                width: 34, height: 30, border: 'none', cursor: 'pointer',
                borderLeft: i === 0 ? 'none' : '1px solid #e5e7eb',
                background: 'transparent', color: '#6b7280',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <a.Icon size={14} />
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '12px 14px 16px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1f2937' }}>{meta.subtitle}</div>
          <Car size={13} color="#9ca3af" />
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{caption}</div>
        {chartBody}
      </div>

      <MixSettingsModal
        open={settingsOpen}
        settings={settings}
        onCancel={() => setSettingsOpen(false)}
        onApply={next => {
          onChangeSettings(next);
          setSettingsOpen(false);
        }}
      />
    </div>
  );

  if (!fullscreen) return card;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 85,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={() => setFullscreen(false)}
    >
      <div onClick={e => e.stopPropagation()} style={{ overflow: 'auto', maxHeight: '94vh' }}>{card}</div>
    </div>
  );
}

const EMPTY_AGG: EventDayAggregate = {
  byDay: {},
  byLegend: {},
  minDay: '',
  maxDay: '',
  eventCount: 0,
};

export default function MixEventInsightsGrid({ events }: { events: LogEntry[] }) {
  const [distanceKm, setDistanceKm] = useState(0);
  const [distanceLoaded, setDistanceLoaded] = useState(false);
  const [chartsReady, setChartsReady] = useState(false);
  const [agg, setAgg] = useState<EventDayAggregate>(EMPTY_AGG);
  const [, startTransition] = useTransition();
  const [settings, setSettings] = useState<Record<WidgetId, WidgetSettings>>(() => ({
    driverScores: defaultSettings('driverScores'),
    occurMost: defaultSettings('occurMost'),
    assetCosts: defaultSettings('assetCosts'),
    riskSafety: defaultSettings('riskSafety'),
  }));

  // Aggregate once off the critical paint path (same pattern as other pages: show shell first)
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      const next = preaggregateRelatableEvents(events);
      if (cancelled) return;
      startTransition(() => setAgg(next));
      requestAnimationFrame(() => {
        if (!cancelled) setChartsReady(true);
      });
    };
    // Yield so KPI chrome / route paint can finish first
    const t = window.setTimeout(run, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [events]);

  const needsDistance = Object.values(settings).some(s => needsDistanceMetric(s.metric));

  // Only hit heavy driver-distance when a rate metric is actually selected
  useEffect(() => {
    if (!needsDistance || distanceLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/api/driver-distance?range=currentMonth');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          setDistanceKm(Number(data.totalDistanceKm || 0));
          setDistanceLoaded(true);
        }
      } catch { /* keep 0 */ }
    })();
    return () => { cancelled = true; };
  }, [needsDistance, distanceLoaded]);

  const caption = useMemo(() => formatDateCaptionFromAggregate(agg), [agg]);
  const ids = Object.keys(WIDGET_DEFAULTS) as WidgetId[];

  return (
    <div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
        gap: 14,
      }}>
        {ids.map(id => (
          <MixWidgetCard
            key={id}
            id={id}
            agg={agg}
            caption={caption}
            chartsReady={chartsReady}
            distanceKm={distanceKm}
            settings={settings[id]}
            onChangeSettings={next => setSettings(prev => ({ ...prev, [id]: next }))}
          />
        ))}
      </div>
      <p style={{ marginTop: 10, fontSize: 11, color: 'var(--cd-text-muted)' }}>
        Settings match MiX Events modal (metric + event multi-select). Catalog limited to events we ingest.
        Distance-rate metrics use trip kilometres when selected.
      </p>
    </div>
  );
}
