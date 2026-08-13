import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Car, ChevronDown, Filter, LayoutGrid, List, Plus, User, X,
} from 'lucide-react';
import MixEventInsightsGrid from '../components/MixEventInsightsGrid';
import {
  DeferredTrendsExtraChart,
  TrendsSharedDataProvider,
} from '../components/TrendsExtraCharts';
import { useFleet } from '../context/FleetContext';
import type { LogEntry } from '../context/FleetContext';
import type { WidgetId } from '../lib/mixEventInsights';
import {
  PRESET_DASHBOARDS,
  TRENDS_CHART_CATALOG,
  chartDef,
  createDashboardId,
  listDashboards,
  loadTrendsState,
  resolveDashboard,
  saveTrendsState,
  type TrendsChartId,
  type TrendsDashboard,
  type TrendsGrouping,
  type TrendsLayout,
  type TrendsPeriod,
  type TrendsScope,
  type TrendsStoredState,
} from '../lib/trendsDashboard';

const HIDDEN_LABELS = [
  'Possible Power Tamper', 'Battery Disconnection', 'Battery Disconnected',
  'Front Panel Tamper', 'Back Panel Tamper', 'No Blue Key',
];

const TEAL = '#5b8f8a';
const TEAL_DARK = '#4a7a76';

function inDateRange(e: LogEntry, period: TrendsPeriod, fromDate: string, toDate: string) {
  const ts = new Date(e.eventTime || e.timestamp).getTime();
  if (!Number.isFinite(ts)) return false;
  const now = Date.now();
  if (period === 'today') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return ts >= start.getTime();
  }
  if (period === 'week') return ts >= now - 7 * 24 * 60 * 60 * 1000;
  if (period === 'month') return ts >= now - 30 * 24 * 60 * 60 * 1000;
  if (period === 'custom' && fromDate && toDate) {
    const start = new Date(fromDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);
    return ts >= start.getTime() && ts <= end.getTime();
  }
  return true;
}

function ToolbarSelect({
  value,
  onChange,
  options,
  wide,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  wide?: boolean;
}) {
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          padding: '7px 28px 7px 12px',
          borderRadius: 4,
          border: '1px solid #d1d5db',
          background: '#fff',
          color: '#374151',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          minWidth: wide ? 240 : 120,
          maxWidth: wide ? 320 : undefined,
          outline: 'none',
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown
        size={14}
        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#6b7280' }}
      />
    </div>
  );
}

function AssetDriverSlider({
  value,
  onChange,
}: {
  value: TrendsScope;
  onChange: (v: TrendsScope) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Asset or driver perspective"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        border: '1px solid #d1d5db',
        borderRadius: 4,
        overflow: 'hidden',
        background: '#fff',
        height: 34,
      }}
    >
      <button
        type="button"
        title="Asset"
        aria-pressed={value === 'asset'}
        onClick={() => onChange('asset')}
        style={{
          width: 36, height: 34, border: 'none', cursor: 'pointer',
          background: value === 'asset' ? '#eef6f5' : '#fff',
          color: value === 'asset' ? TEAL : '#6b7280',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRight: '1px solid #e5e7eb',
        }}
      >
        <Car size={16} strokeWidth={2} />
      </button>
      <button
        type="button"
        title="Driver"
        aria-pressed={value === 'driver'}
        onClick={() => onChange('driver')}
        style={{
          width: 36, height: 34, border: 'none', cursor: 'pointer',
          background: value === 'driver' ? '#eef6f5' : '#fff',
          color: value === 'driver' ? TEAL : '#6b7280',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <User size={16} strokeWidth={2} />
      </button>
    </div>
  );
}

function AddDashboardModal({
  open,
  mode,
  initialName,
  initialDescription,
  selected,
  onCancel,
  onSave,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  initialName: string;
  initialDescription: string;
  selected: TrendsChartId[];
  onCancel: () => void;
  onSave: (payload: { name: string; description: string; chartIds: TrendsChartId[] }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [draft, setDraft] = useState<Set<TrendsChartId>>(() => new Set(selected));

  useEffect(() => {
    if (open) {
      setName(initialName);
      setDescription(initialDescription);
      setDraft(new Set(selected));
    }
  }, [open, initialName, initialDescription, selected]);

  if (!open) return null;

  const toggle = (id: TrendsChartId) => {
    setDraft(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const canSave = name.trim().length > 0 && draft.size > 0;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(15, 23, 42, 0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(440px, 96vw)',
          maxHeight: '90vh',
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 18px 8px',
        }}>
          <strong style={{ fontSize: 18, color: '#1f2937' }}>
            {mode === 'create' ? 'Add dashboard' : 'Edit dashboard'}
          </strong>
          <button type="button" onClick={onCancel} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#9ca3af' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '4px 18px 12px' }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            Dashboard name and description
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Fuel Utilisation"
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 6, marginBottom: 8,
              border: '1px solid #d1d5db', fontSize: 13, color: '#1f2937', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Short description (optional)"
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 6,
              border: '1px solid #d1d5db', fontSize: 13, color: '#1f2937', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ padding: '0 18px 8px', fontSize: 14, fontWeight: 600, color: '#374151' }}>
          Select organisational goal charts
        </div>
        <div style={{
          margin: '0 18px',
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          background: '#f9fafb',
          maxHeight: 300,
          overflow: 'auto',
        }}>
          {TRENDS_CHART_CATALOG.map(c => {
            const checked = draft.has(c.id);
            return (
              <label
                key={c.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px',
                  borderBottom: '1px solid #eef0f2',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: '#1f2937',
                  background: '#fff',
                }}
              >
                <span style={{
                  width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                  border: `1.5px solid ${checked ? TEAL : '#d1d5db'}`,
                  background: checked ? TEAL : '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 11, fontWeight: 700,
                }}>
                  {checked ? '✓' : ''}
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(c.id)}
                  style={{ display: 'none' }}
                />
                {c.label}
              </label>
            );
          })}
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 10,
          padding: '14px 18px',
        }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '8px 18px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
              border: 'none', background: '#e5e7eb', color: '#374151', fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => onSave({
              name: name.trim(),
              description: description.trim(),
              chartIds: Array.from(draft),
            })}
            style={{
              padding: '8px 20px', borderRadius: 6, fontSize: 13, cursor: canSave ? 'pointer' : 'not-allowed',
              border: 'none', background: canSave ? TEAL : '#c5d4d2', color: '#fff', fontWeight: 600,
              opacity: canSave ? 1 : 0.7,
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TrendsPage() {
  const { events } = useFleet();
  const [layout, setLayout] = useState<TrendsLayout>('grid');
  const [period, setPeriod] = useState<TrendsPeriod>('week');
  const [grouping, setGrouping] = useState<TrendsGrouping>('day-of-week');
  const [scope, setScope] = useState<TrendsScope>('asset');
  const [state, setState] = useState<TrendsStoredState>(() => loadTrendsState());
  const [addOpen, setAddOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterOpen, setFilterOpen] = useState(false);
  const [labelFilter, setLabelFilter] = useState<Set<string> | null>(null);

  const persist = (next: TrendsStoredState) => {
    setState(next);
    saveTrendsState(next);
  };

  const dashboards = useMemo(() => listDashboards(state), [state]);
  const active = useMemo(
    () => resolveDashboard(state, state.activeId) || PRESET_DASHBOARDS[0],
    [state],
  );

  const periodEvents = useMemo(
    () => events.filter(e => {
      if (e.type === 'panic') return false;
      const label = e.label || 'Unknown';
      if (HIDDEN_LABELS.includes(label)) return false;
      return inDateRange(e, period, fromDate, toDate);
    }),
    [events, period, fromDate, toDate],
  );

  const availableLabels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of periodEvents) {
      const label = e.label || 'Unknown';
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [periodEvents]);

  const filtered = useMemo(() => {
    if (!labelFilter) return periodEvents;
    return periodEvents.filter(e => labelFilter.has(e.label || 'Unknown'));
  }, [periodEvents, labelFilter]);

  /** Keep toolbar snappy while heavy chart pipelines catch up. */
  const deferredFiltered = useDeferredValue(filtered);
  const chartsBusy = deferredFiltered !== filtered;

  const activeFilterCount = labelFilter ? labelFilter.size : 0;
  const chartResetKey = `${period}:${fromDate}:${toDate}:${activeFilterCount}:${active.id}`;

  const removeChart = (chartId: TrendsChartId) => {
    const nextIds = active.chartIds.filter(id => id !== chartId);
    if (active.preset) {
      persist({
        ...state,
        presetCharts: { ...state.presetCharts, [active.id]: nextIds },
      });
    } else {
      persist({
        ...state,
        custom: state.custom.map(d =>
          d.id === active.id ? { ...d, chartIds: nextIds } : d,
        ),
      });
    }
  };

  const mixIds = useMemo(() => {
    const ids: WidgetId[] = [];
    const seen = new Set<WidgetId>();
    for (const cid of active.chartIds) {
      const def = chartDef(cid);
      if (def?.mixWidget && !seen.has(def.mixWidget)) {
        seen.add(def.mixWidget);
        ids.push(def.mixWidget);
      }
    }
    return ids;
  }, [active.chartIds]);

  const extraIds = useMemo(
    () => active.chartIds.filter(id => chartDef(id)?.kind !== 'mix'),
    [active.chartIds],
  );

  const openCreate = () => {
    setModalMode('create');
    setAddOpen(true);
  };

  const openEdit = () => {
    setModalMode('edit');
    setAddOpen(true);
  };

  const handleSaveModal = (payload: { name: string; description: string; chartIds: TrendsChartId[] }) => {
    if (modalMode === 'create') {
      const dash: TrendsDashboard = {
        id: createDashboardId(),
        name: payload.name,
        description: payload.description,
        chartIds: payload.chartIds,
      };
      persist({
        ...state,
        custom: [...state.custom, dash],
        activeId: dash.id,
      });
    } else if (active.preset) {
      // Renaming a preset → fork into a personal named dashboard
      const presetBase = active.name.replace(/ \(Default\)$/, '');
      if (payload.name !== presetBase && payload.name !== active.name) {
        const dash: TrendsDashboard = {
          id: createDashboardId(),
          name: payload.name,
          description: payload.description,
          chartIds: payload.chartIds,
        };
        persist({
          ...state,
          custom: [...state.custom, dash],
          activeId: dash.id,
        });
      } else {
        persist({
          ...state,
          presetCharts: { ...state.presetCharts, [active.id]: payload.chartIds },
          activeId: active.id,
        });
      }
    } else {
      persist({
        ...state,
        custom: state.custom.map(d =>
          d.id === active.id
            ? { ...d, name: payload.name, description: payload.description, chartIds: payload.chartIds }
            : d,
        ),
        activeId: active.id,
      });
    }
    setAddOpen(false);
  };

  return (
    <div style={{ margin: '-4px 0 0' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 14,
        padding: '4px 0 10px',
      }}>
        <div style={{ display: 'inline-flex', border: '1px solid #d1d5db', borderRadius: 4, overflow: 'hidden' }}>
          <button
            type="button"
            title="Grid view"
            onClick={() => setLayout('grid')}
            style={{
              width: 34, height: 34, border: 'none', cursor: 'pointer',
              background: layout === 'grid' ? '#eef6f5' : '#fff',
              color: layout === 'grid' ? TEAL : '#6b7280',
              borderRight: '1px solid #e5e7eb',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            title="List view"
            onClick={() => setLayout('list')}
            style={{
              width: 34, height: 34, border: 'none', cursor: 'pointer',
              background: layout === 'list' ? '#eef6f5' : '#fff',
              color: layout === 'list' ? TEAL : '#6b7280',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <List size={15} />
          </button>
        </div>

        <ToolbarSelect
          value={period}
          onChange={v => setPeriod(v as TrendsPeriod)}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'week', label: 'This Week' },
            { value: 'month', label: 'This Month' },
            { value: 'custom', label: 'Custom' },
          ]}
        />

        <ToolbarSelect
          value={grouping}
          onChange={v => setGrouping(v as TrendsGrouping)}
          options={[
            { value: 'day-of-week', label: 'By Day of Week' },
            { value: 'day', label: 'By Day' },
            { value: 'week', label: 'By Week' },
            { value: 'month', label: 'By Month' },
          ]}
        />

        <AssetDriverSlider value={scope} onChange={setScope} />

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            title="Filters"
            onClick={() => setFilterOpen(v => !v)}
            style={{
              width: 34, height: 34, borderRadius: 4, border: '1px solid #d1d5db',
              background: filterOpen || labelFilter ? '#eef6f5' : '#fff',
              color: filterOpen || labelFilter ? TEAL : '#6b7280',
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative',
            }}
          >
            <Filter size={15} />
            {activeFilterCount > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16,
                borderRadius: 8, background: TEAL, color: '#fff', fontSize: 10, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
              }}>
                {activeFilterCount}
              </span>
            )}
          </button>

          {filterOpen && (
            <div
              style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 6,
                width: 320, maxHeight: 360, overflow: 'auto',
                background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
                boxShadow: '0 12px 28px rgba(0,0,0,0.14)',
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px', borderBottom: '1px solid #eef0f2',
              }}>
                <strong style={{ fontSize: 13, color: '#374151' }}>Filter by event type</strong>
                <button
                  type="button"
                  onClick={() => setFilterOpen(false)}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#6b7280' }}
                >
                  <X size={16} />
                </button>
              </div>
              <div style={{ padding: '8px 12px', display: 'flex', gap: 8, borderBottom: '1px solid #eef0f2' }}>
                <button
                  type="button"
                  onClick={() => setLabelFilter(new Set(availableLabels.map(([l]) => l)))}
                  style={{ border: 'none', background: 'transparent', color: TEAL, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setLabelFilter(null)}
                  style={{ border: 'none', background: 'transparent', color: '#6b7280', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >
                  Clear
                </button>
              </div>
              <div style={{ padding: '8px 0' }}>
                {availableLabels.length === 0 ? (
                  <div style={{ padding: 16, fontSize: 12, color: '#9ca3af' }}>No events in this period</div>
                ) : availableLabels.map(([label, count]) => {
                  const checked = !labelFilter || labelFilter.has(label);
                  return (
                    <label
                      key={label}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '7px 12px', cursor: 'pointer', fontSize: 13, color: '#374151',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const base = labelFilter
                            ? new Set(labelFilter)
                            : new Set(availableLabels.map(([l]) => l));
                          if (base.has(label)) base.delete(label);
                          else base.add(label);
                          if (base.size === 0 || base.size === availableLabels.length) setLabelFilter(null);
                          else setLabelFilter(base);
                        }}
                      />
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {label}
                      </span>
                      <span style={{ color: '#9ca3af', fontSize: 12 }}>{count}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 8 }} />

        <ToolbarSelect
          wide
          value={active.id}
          onChange={v => persist({ ...state, activeId: v })}
          options={dashboards.map(d => ({ value: d.id, label: d.name }))}
        />

        <button
          type="button"
          title="Add dashboard / graphs"
          onClick={openCreate}
          style={{
            width: 36, height: 36, borderRadius: 6, border: 'none',
            background: TEAL, color: '#fff', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = TEAL_DARK; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = TEAL; }}
        >
          <Plus size={20} strokeWidth={2.5} />
        </button>
      </div>

      {active.description && (
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10, marginTop: -6 }}>
          {active.description}
          {!active.preset && (
            <button
              type="button"
              onClick={openEdit}
              style={{
                marginLeft: 10, border: 'none', background: 'transparent',
                color: TEAL, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Edit charts
            </button>
          )}
          {active.preset && (
            <button
              type="button"
              onClick={openEdit}
              style={{
                marginLeft: 10, border: 'none', background: 'transparent',
                color: TEAL, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Customise charts
            </button>
          )}
        </div>
      )}

      {period === 'custom' && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#6b7280' }}>
            From
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              style={{ display: 'block', marginTop: 4, padding: '6px 10px', borderRadius: 4, border: '1px solid #d1d5db' }} />
          </label>
          <label style={{ fontSize: 12, color: '#6b7280' }}>
            To
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              style={{ display: 'block', marginTop: 4, padding: '6px 10px', borderRadius: 4, border: '1px solid #d1d5db' }} />
          </label>
        </div>
      )}

      <TrendsSharedDataProvider events={deferredFiltered}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: layout === 'list' ? '1fr' : 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
            gap: 14,
            opacity: chartsBusy ? 0.92 : 1,
            transition: 'opacity 0.15s ease',
          }}
        >
          {extraIds.map((id, index) => (
            <DeferredTrendsExtraChart
              key={`${id}:${chartResetKey}`}
              chartId={id}
              events={deferredFiltered}
              scope={scope}
              grouping={grouping}
              mountDelay={index * 45}
              onEditDashboard={openEdit}
              onRemoveChart={removeChart}
            />
          ))}
        </div>

        {mixIds.length > 0 && (
          <div style={{ marginTop: extraIds.length ? 14 : 0 }}>
            <MixEventInsightsGrid events={deferredFiltered} visibleIds={mixIds} grouping={grouping} />
          </div>
        )}
      </TrendsSharedDataProvider>

      {active.chartIds.length === 0 && (
        <div style={{
          padding: 48, textAlign: 'center', color: '#9ca3af', fontSize: 13,
          border: '1px dashed #d1d5db', borderRadius: 8, background: '#fff',
        }}>
          No charts selected. Click <strong style={{ color: TEAL }}>+</strong> to create a dashboard and pick graphs.
        </div>
      )}

      <AddDashboardModal
        open={addOpen}
        mode={modalMode}
        initialName={modalMode === 'create' ? '' : active.name.replace(/ \(Default\)$/, '')}
        initialDescription={modalMode === 'create' ? '' : active.description}
        selected={modalMode === 'create' ? [] : active.chartIds}
        onCancel={() => setAddOpen(false)}
        onSave={handleSaveModal}
      />
    </div>
  );
}
