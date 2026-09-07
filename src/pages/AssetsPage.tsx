import { useEffect, useMemo, useState, useDeferredValue } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Search, Truck } from 'lucide-react';
import { useFleet, authFetch, type LogEntry } from '../context/FleetContext';
import MockNamesBadge from '../components/MockNamesBadge';
import ExpandedEventsList from '../components/risk/ExpandedEventsList';
import CustomDateTimeRange, { ensureCustomRangeDefaults } from '../components/CustomDateTimeRange';
import TablePaginationBar from '../components/TablePaginationBar';
import { SkelTable, SkelValue } from '../components/data/DataBusy';
import { useClientPagination } from '../hooks/useClientPagination';
import {
  type PageDateRange,
  defaultPageCustomRange,
  pagePeriodIsoBounds,
} from '../lib/pagePeriod';
import { presetDateBounds } from '../lib/dateRange';
import { authCachedJson, cachePeek, CACHE_TTL } from '../lib/apiCache';
import { brandLabel } from '../lib/branding';
import { statusDisplayLabel } from '../lib/metricDefinitions';
import { parseEventsLogPayload } from '../lib/riskExpandEvents';

type AssetRiskRow = {
  assetId: string;
  regNo?: string;
  assetName?: string;
  total?: number;
  harshBraking?: number;
  harshAcceleration?: number;
  overspeeding?: number;
  overspeedTiered?: number;
  harshCornering?: number;
};

type AssetsDateRange = PageDateRange | 'alltime';

const ASSETS_PAGE_SIZE = 50;

function assetsPeriodBounds(range: AssetsDateRange, customFrom: string, customTo: string) {
  if (range === 'alltime') return presetDateBounds('alltime', customFrom, customTo);
  return pagePeriodIsoBounds(range, customFrom, customTo);
}

function riskAssetsUrl(range: AssetsDateRange, customFrom: string, customTo: string) {
  const params = new URLSearchParams();
  params.set('groupBy', 'asset');
  if (range === 'today') params.set('range', 'today');
  else if (range === '7days') params.set('range', '7d');
  else if (range === '30days') params.set('range', '30d');
  else if (range === 'custom' || range === 'alltime') {
    const b = assetsPeriodBounds(range, customFrom, customTo);
    if (b.from) params.set('from', b.from);
    if (b.to) params.set('to', b.to);
  }
  return `/api/risk/drivers?${params}`;
}

function assetEventsUrl(
  asset: { assetId: string; regNo: string },
  range: AssetsDateRange,
  customFrom: string,
  customTo: string,
) {
  const b = assetsPeriodBounds(range, customFrom, customTo);
  const params = new URLSearchParams();
  params.set('limit', 'all');
  if (asset.assetId) params.set('assetId', asset.assetId);
  else if (asset.regNo) params.set('q', asset.regNo.trim());
  if (b.from) params.set('from', b.from);
  if (b.to) params.set('to', b.to);
  return `/api/events/log?${params}`;
}

function InfractionBadge({ label, count }: { label: string; count: number }) {
  if (count <= 0) return null;
  return <span className="bpl-asset-badge">{label} {count}</span>;
}

function peekRiskAssets(url: string) {
  return cachePeek<{ assets?: AssetRiskRow[]; drivers?: AssetRiskRow[] }>(url);
}

export default function AssetsPage() {
  const { vehicles } = useFleet();
  const [searchParams] = useSearchParams();
  const [dateRange, setDateRange] = useState<AssetsDateRange>('7days');
  const [customRange, setCustomRange] = useState(defaultPageCustomRange);
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [showQuiet, setShowQuiet] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandEvents, setExpandEvents] = useState<Record<string, LogEntry[]>>({});
  const [expandLoading, setExpandLoading] = useState<Record<string, boolean>>({});

  const deferredSearch = useDeferredValue(search);

  const url = riskAssetsUrl(dateRange, customRange.from, customRange.to);
  const [rows, setRows] = useState<AssetRiskRow[]>(() => {
    const cached = peekRiskAssets(url);
    return cached?.assets ?? cached?.drivers ?? [];
  });
  const [loading, setLoading] = useState(() => {
    const cached = peekRiskAssets(url);
    return !(cached?.assets?.length || cached?.drivers?.length);
  });

  useEffect(() => {
    let cancelled = false;
    const nextUrl = riskAssetsUrl(dateRange, customRange.from, customRange.to);
    const cached = peekRiskAssets(nextUrl);
    const seed = cached?.assets ?? cached?.drivers;
    if (seed?.length) {
      setRows(seed);
      setLoading(false);
    } else {
      // Keep prior rows painted; skeleton only when rows empty (see render).
      setLoading(true);
    }
    authCachedJson<{ assets?: AssetRiskRow[]; drivers?: AssetRiskRow[] }>(nextUrl, authFetch, {
      ttlMs: CACHE_TTL.riskDrivers,
    })
      .then(data => {
        if (cancelled || !data) return;
        setRows(data.assets ?? data.drivers ?? []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dateRange, customRange.from, customRange.to]);

  const vehicleById = useMemo(() => {
    const m = new Map<string, typeof vehicles[number]>();
    vehicles.forEach(v => { if (v.id) m.set(String(v.id), v); });
    return m;
  }, [vehicles]);

  const usingFleetFallback = loading && rows.length === 0 && vehicles.length > 0;

  const merged = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const sourceRows = rows.length > 0
      ? rows
      : vehicles.map(v => ({
          assetId: String(v.id),
          regNo: v.regNo,
          assetName: v.assetName,
          total: 0,
        }));
    return sourceRows
      .map(r => {
        const v = vehicleById.get(String(r.assetId));
        const reg = r.regNo || v?.regNo || '—';
        const name = r.assetName || v?.assetName || '—';
        const site = v?.site || v?.zone || '—';
        const address = v?.position?.address;
        return {
          id: String(r.assetId),
          reg,
          name,
          site,
          address: address && address !== 'N/A' ? address : null,
          transporter: v?.transporter,
          status: v?.status ?? '—',
          total: r.total ?? 0,
          harshBraking: r.harshBraking ?? 0,
          harshAcceleration: r.harshAcceleration ?? 0,
          overspeeding: r.overspeeding ?? 0,
          overspeedTiered: r.overspeedTiered ?? 0,
          harshCornering: r.harshCornering ?? 0,
        };
      })
      .filter(a => usingFleetFallback || showQuiet || a.total > 0)
      .filter(a => {
        if (!q) return true;
        return a.reg.toLowerCase().includes(q)
          || a.name.toLowerCase().includes(q)
          || a.site.toLowerCase().includes(q);
      })
      .sort((a, b) => b.total - a.total);
  }, [rows, vehicles, deferredSearch, vehicleById, showQuiet, usingFleetFallback]);

  const {
    pageRows,
    page,
    pageCount,
    from: pageFrom,
    to: pageTo,
    total: pageTotal,
    hasPrev,
    hasNext,
    prev,
    next,
  } = useClientPagination(
    merged,
    ASSETS_PAGE_SIZE,
    `${dateRange}|${customRange.from}|${customRange.to}|${deferredSearch}|${showQuiet}`,
  );

  const loadExpandEvents = (asset: typeof merged[number]) => {
    if (expandEvents[asset.id] || expandLoading[asset.id]) return;
    const eventsUrl = assetEventsUrl(
      { assetId: asset.id, regNo: asset.reg },
      dateRange,
      customRange.from,
      customRange.to,
    );
    const cached = cachePeek(eventsUrl);
    if (cached) {
      setExpandEvents(prev => ({ ...prev, [asset.id]: parseEventsLogPayload(cached) }));
      return;
    }
    setExpandLoading(prev => ({ ...prev, [asset.id]: true }));
    authCachedJson(eventsUrl, authFetch, { ttlMs: CACHE_TTL.fleetEvents })
      .then(data => {
        setExpandEvents(prev => ({ ...prev, [asset.id]: parseEventsLogPayload(data) }));
      })
      .catch(() => {
        setExpandEvents(prev => ({ ...prev, [asset.id]: [] }));
      })
      .finally(() => {
        setExpandLoading(prev => ({ ...prev, [asset.id]: false }));
      });
  };

  const toggle = (asset: typeof merged[number]) => {
    setExpanded(prev => {
      const n = new Set(prev);
      const isOpen = n.has(asset.id);
      if (isOpen) {
        n.delete(asset.id);
      } else {
        n.add(asset.id);
        if (asset.total > 0) loadExpandEvents(asset);
      }
      return n;
    });
  };

  return (
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">
          <Truck size={18} color="#c8102e" style={{ display: 'inline', marginRight: 8, verticalAlign: -3 }} />
          Assets <MockNamesBadge />
        </h1>
        <p className="bpl-page-subtitle">Fleet assets ranked by scored IVMS events in the selected period</p>
      </div>

      <div className="bpl-card bpl-asset-page" style={{ display: 'flex', flexDirection: 'column', minHeight: 520, overflow: 'hidden' }}>
        <div className="bpl-asset-toolbar">
          <div className="bpl-asset-toolbar-row">
            {(['today', '7days', '30days', 'alltime', 'custom'] as AssetsDateRange[]).map(r => (
              <button
                key={r}
                type="button"
                className={`bpl-asset-pill${dateRange === r ? ' active' : ''}`}
                onClick={() => {
                  if (r === 'custom') {
                    ensureCustomRangeDefaults(
                      customRange.from,
                      customRange.to,
                      f => setCustomRange(prev => ({ ...prev, from: f })),
                      t => setCustomRange(prev => ({ ...prev, to: t })),
                    );
                  }
                  setDateRange(r);
                }}
              >
                {r === 'today' ? 'Today' : r === '7days' ? '7 days' : r === '30days' ? '30 days' : r === 'alltime' ? 'All time' : 'Custom'}
              </button>
            ))}
            <button
              type="button"
              className={`bpl-asset-pill bpl-asset-pill--end${showQuiet ? ' active' : ''}`}
              onClick={() => setShowQuiet(v => !v)}
              title="Include vehicles with zero infractions in the selected period"
            >
              {showQuiet ? 'All fleet vehicles' : 'With events only'}
            </button>
          </div>
          {dateRange === 'custom' && (
            <CustomDateTimeRange
              stacked
              from={customRange.from}
              to={customRange.to}
              onFromChange={f => setCustomRange(r => ({ ...r, from: f }))}
              onToChange={t => setCustomRange(r => ({ ...r, to: t }))}
              style={{ marginTop: 8 }}
            />
          )}
        </div>

        <div className="bpl-asset-searchbar">
          <div className="bpl-asset-search">
            <Search size={14} />
            <input
              type="text"
              placeholder="Search reg no, asset, driver or site…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="bpl-asset-list">
          {loading && merged.length === 0 ? (
            <div style={{ padding: 16 }}><SkelTable rows={6} /></div>
          ) : pageRows.length === 0 ? (
            <div className="bpl-asset-empty">
              No data found{!showQuiet ? ' — try “All fleet vehicles”' : ''}
            </div>
          ) : pageRows.map((asset, idx) => {
            const open = expanded.has(asset.id);
            const hasInfractions = asset.total > 0;
            return (
              <div
                key={asset.id}
                className={`bpl-asset-card${hasInfractions ? ' has-events' : ''}${open ? ' is-open' : ''}`}
              >
                <button type="button" className="bpl-asset-card-head" onClick={() => toggle(asset)}>
                  <span className="bpl-asset-rank">#{pageFrom + idx}</span>
                  <div className="bpl-asset-meta">
                    <div className="bpl-asset-title">
                      {asset.reg}
                      <span className="bpl-asset-name">· {brandLabel(asset.name)}</span>
                    </div>
                    <div className="bpl-asset-sub">
                      {[
                        asset.site !== '—' ? brandLabel(asset.site) : null,
                        asset.transporter && asset.transporter !== 'N/A' ? brandLabel(asset.transporter) : null,
                        asset.status !== '—' ? statusDisplayLabel(asset.status) : null,
                        asset.address,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="bpl-asset-badges">
                    {!usingFleetFallback && (
                      <>
                        <InfractionBadge label="Harsh Braking" count={asset.harshBraking} />
                        <InfractionBadge label="Harsh Acceleration" count={asset.harshAcceleration} />
                        <InfractionBadge label="Overspeeding" count={asset.overspeeding} />
                        <InfractionBadge label="Overspeed Tiered" count={asset.overspeedTiered} />
                        <InfractionBadge label="Harsh Cornering" count={asset.harshCornering} />
                      </>
                    )}
                    <span className="bpl-asset-total" title="Warning count">
                      {usingFleetFallback ? <SkelValue /> : asset.total}
                    </span>
                    {open
                      ? <ChevronUp size={14} className="bpl-asset-chevron" />
                      : <ChevronDown size={14} className="bpl-asset-chevron" />}
                  </div>
                </button>
                {open && (
                  <ExpandedEventsList
                    events={expandEvents[asset.id] ?? []}
                    loading={!!expandLoading[asset.id]}
                    emptyMessage={hasInfractions ? 'No event detail loaded.' : 'No infractions in this period.'}
                  />
                )}
              </div>
            );
          })}
        </div>

        <TablePaginationBar
          from={pageFrom}
          to={pageTo}
          total={pageTotal}
          page={page}
          pageCount={pageCount}
          hasPrev={hasPrev}
          hasNext={hasNext}
          prev={prev}
          next={next}
          minTotal={0}
        />

        <div className="bpl-asset-footer">
          {pageTotal} asset{pageTotal !== 1 ? 's' : ''} in view
        </div>
      </div>
    </div>
  );
}
