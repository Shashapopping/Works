import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Truck, Activity, Fuel, Wifi, WifiOff, ChevronDown, MapPin } from 'lucide-react';
import { useFleet, type Vehicle } from '../context/FleetContext';
import type { ConsumptionData, AssetRow } from '../lib/fuelConsumption';
import FuelChart, {
  QUARRY_SITE_KEYS,
  QUARRY_SITE_LABELS,
  fuelZoneColor,
  type QuarrySiteKey,
} from '../components/FuelChart';
import { fetchFuelConsumptionCached, peekFuelConsumption } from '../hooks/useFuelConsumption';
import { SkelValue } from '../components/data/DataBusy';
import { startJitteredInterval } from '../lib/pollSchedule';

const STATUS_COLOR: Record<string, string> = {
  Moving: '#16a34a',
  Idle: '#d97706',
  'Excessive Idle': '#CC0000',
  Stationary: '#0d9488',
  Parked: '#7C3AED',
  Offline: '#6B7A8D',
  Inactive: '#6878A0',
};

type QuarryVehicle = Vehicle & { zone?: string; fuelLevel?: { level: number } };

function vehiclesForSite(vehicles: QuarryVehicle[], site: QuarrySiteKey) {
  return vehicles.filter(v => (v.zone || '').toUpperCase() === site);
}

function KPICard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string | number; sub?: string; color?: string; icon?: React.ElementType;
}) {
  return (
    <div className="bpl-kpi-card" style={color ? { borderTop: `3px solid ${color}` } : {}}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div className="bpl-kpi-label">{label}</div>
        {Icon && <Icon size={15} style={{ color: color || 'var(--cd-text-muted)', opacity: 0.6 }} />}
      </div>
      <div className="bpl-kpi-value" style={color ? { color } : {}}>{value}</div>
      {sub && <div className="bpl-kpi-sub">{sub}</div>}
    </div>
  );
}

export default function FuelMonitoring() {
  const { vehicles } = useFleet();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const linkedSite = searchParams.get('site')?.toUpperCase();
  const linkedAsset = searchParams.get('asset');
  const initialSite = QUARRY_SITE_KEYS.includes(linkedSite as QuarrySiteKey)
    ? (linkedSite as QuarrySiteKey)
    : 'QUARRY EWEKORO';
  const [selectedSite, setSelectedSite] = useState<QuarrySiteKey>(initialSite);
  const [siteMenuOpen, setSiteMenuOpen] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(linkedAsset);
  const eventsPeriod: 'day' = 'day';
  const eventsUrl = `/api/fuel/consumption?period=${eventsPeriod}&trips=0`;
  const [fuelEvents, setFuelEvents] = useState<ConsumptionData | null>(
    () => peekFuelConsumption(eventsUrl),
  );
  const [eventsLoading, setEventsLoading] = useState(() => !peekFuelConsumption(eventsUrl));

  const quarryVehicles = useMemo(
    () => (vehicles as QuarryVehicle[]).filter(v => QUARRY_SITE_KEYS.includes((v.zone || '').toUpperCase() as QuarrySiteKey)),
    [vehicles],
  );

  const siteVehicles = useMemo(
    () => vehiclesForSite(vehicles as QuarryVehicle[], selectedSite).sort((a, b) => a.regNo.localeCompare(b.regNo)),
    [vehicles, selectedSite],
  );

  const selectedVehicle = siteVehicles.find(v => v.id === selectedVehicleId) ?? null;
  const siteColor = fuelZoneColor(selectedSite);

  useEffect(() => {
    if (siteVehicles.length === 0) {
      setSelectedVehicleId(null);
      return;
    }
    if (siteVehicles.some(v => v.id === selectedVehicleId)) return;
    // Prefer a quarry device with a live non-zero fuel reading
    const withFuel = siteVehicles.find(v => v.fuelLevel != null && v.fuelLevel.level > 0);
    const withReading = siteVehicles.find(v => v.fuelLevel != null);
    setSelectedVehicleId((withFuel ?? withReading ?? siteVehicles[0]).id);
  }, [selectedSite, siteVehicles, selectedVehicleId]);

  const assetsBySite = useMemo(() => {
    const counts: Record<QuarrySiteKey, number> = {
      'QUARRY EWEKORO': 0,
      'QUARRY MFAMOSING': 0,
    };
    quarryVehicles.forEach(v => {
      const z = (v.zone || '').toUpperCase() as QuarrySiteKey;
      if (z in counts) counts[z]++;
    });
    return counts;
  }, [quarryVehicles]);

  const online = quarryVehicles.filter(v => v.status !== 'Offline' && v.status !== 'Inactive').length;
  const siteOnline = siteVehicles.filter(v => v.status !== 'Offline' && v.status !== 'Inactive').length;

  useEffect(() => {
    let cancelled = false;
    const url = `/api/fuel/consumption?period=${eventsPeriod}&trips=0`;
    const cached = peekFuelConsumption(url);
    if (cached) {
      setFuelEvents(cached);
      setEventsLoading(false);
    } else {
      setFuelEvents(null);
      setEventsLoading(true);
    }

    const load = async (silent = false) => {
      if (!silent) {
        const hit = peekFuelConsumption(url);
        if (hit && !cancelled) setFuelEvents(hit);
      }
      try {
        const next = await fetchFuelConsumptionCached(url, { force: silent });
        if (next && !cancelled) setFuelEvents(next);
      } catch { /* retain prior on silent poll */ }
      finally {
        if (!cancelled && !silent) setEventsLoading(false);
      }
    };
    void load(false);
    const stop = startJitteredInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void load(true);
    }, eventsPeriod === 'day' ? 60_000 : 5 * 60_000);
    return () => { cancelled = true; stop(); };
  }, [eventsPeriod]);

  const fuelEventsByAsset = useMemo(
    () => new Map((fuelEvents?.assets ?? []).map(a => [a.assetId, a])),
    [fuelEvents],
  );

  const openFuelDetail = (asset: QuarryVehicle) => {
    const params = new URLSearchParams({
      asset: asset.id,
      site: selectedSite,
      period: eventsPeriod,
      focus: 'fuel-events',
    });
    navigate(`/fuel/consumption?${params.toString()}`);
  };

  const refuelDisplay = (row?: AssetRow) => {
    if (!row?.refuelCount) return '—';
    return row.refuelCount === 1 ? `${row.refuelLiters.toFixed(0)} L` : `${row.refuelCount} refills`;
  };

  const periodShort = '24h';

  return (
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">Fuel Monitoring</h1>
        <p className="bpl-page-subtitle">Live quarry fuel probe levels via MiX telematics</p>
      </div>

      <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        <KPICard label="Quarry Assets" value={quarryVehicles.length} icon={Truck} color="#0078D4" sub="Fuel probe fitted" />
        <KPICard label="Online Now" value={online} color="#16a34a" icon={Activity} sub="Reporting to MiX" />
        <KPICard label="Temp Inactive" value={quarryVehicles.length - online} color="#6B7A8D" sub="No recent signal" />
        <KPICard label="Quarry Zones" value={2} color="#7C3AED" sub="Ewekoro · Mfamosing" />
      </div>

      <div style={{ marginBottom: 16, position: 'relative', display: 'inline-block' }}>
        <button
          type="button"
          onClick={() => setSiteMenuOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px', borderRadius: 10, cursor: 'pointer',
            border: `1px solid ${siteColor}44`,
            background: `${siteColor}10`,
            color: 'var(--cd-text)', fontSize: 14, fontWeight: 600,
            fontFamily: 'var(--cd-font-display)', minWidth: 220,
          }}
        >
          <MapPin size={16} color={siteColor} />
          <span style={{ flex: 1, textAlign: 'left' }}>{QUARRY_SITE_LABELS[selectedSite]}</span>
          <span style={{ fontSize: 12, color: 'var(--cd-text-muted)', fontWeight: 500 }}>
            {assetsBySite[selectedSite]} assets
          </span>
          <ChevronDown size={16} color="var(--cd-text-muted)" style={{ transform: siteMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>
        {siteMenuOpen && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setSiteMenuOpen(false)} />
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 11,
              minWidth: 260, background: 'var(--cd-surface)', border: '1px solid var(--cd-border)',
              borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden',
            }}>
              {QUARRY_SITE_KEYS.map(site => {
                const c = fuelZoneColor(site);
                const active = site === selectedSite;
                return (
                  <button
                    key={site}
                    type="button"
                    onClick={() => { setSelectedSite(site); setSiteMenuOpen(false); }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '12px 16px', border: 'none', cursor: 'pointer', textAlign: 'left',
                      background: active ? `${c}12` : 'transparent',
                      borderLeft: active ? `3px solid ${c}` : '3px solid transparent',
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 13, color: active ? c : 'var(--cd-text)' }}>
                      {QUARRY_SITE_LABELS[site]}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--cd-text-muted)' }}>
                      {assetsBySite[site]} assets
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="bpl-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--cd-border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: siteColor, fontFamily: 'var(--cd-font-display)' }}>
            {QUARRY_SITE_LABELS[selectedSite]}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>
              {siteVehicles.length} assets · <span style={{ color: '#16a34a', fontWeight: 600 }}>{siteOnline} online</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 1.2fr)', minHeight: 460 }}>
          <div style={{ borderRight: '1px solid var(--cd-border)', overflow: 'auto', maxHeight: 520 }}>
            {siteVehicles.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--cd-text-muted)', fontSize: 13 }}>
                <Fuel size={28} color="var(--cd-border)" style={{ margin: '0 auto 12px' }} />
                <div style={{ fontWeight: 600, marginBottom: 4 }}>No assets in this quarry</div>
                <div style={{ fontSize: 12 }}>Fuel probe data will appear when vehicles are assigned to this zone in MiX.</div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--cd-surface-2)', position: 'sticky', top: 0, zIndex: 1 }}>
                    {['Reg No', 'Asset', 'Status', 'Signal', 'Fuel', `Refill (${periodShort})`].map(h => (
                      <th key={h} style={{
                        padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap',
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {siteVehicles.map((v, i) => {
                    const isOnline = v.status !== 'Offline' && v.status !== 'Inactive';
                    const isSelected = v.id === selectedVehicleId;
                    const events = fuelEventsByAsset.get(v.id);
                    return (
                      <tr
                        key={v.id}
                        onClick={() => setSelectedVehicleId(v.id)}
                        style={{
                          borderTop: i === 0 ? 'none' : '1px solid var(--cd-border)',
                          background: isSelected ? `${siteColor}10` : i % 2 === 0 ? 'transparent' : 'var(--cd-surface-2)',
                          cursor: 'pointer',
                          boxShadow: isSelected ? `inset 3px 0 0 ${siteColor}` : 'none',
                        }}
                      >
                        <td style={{ padding: '10px 14px', fontWeight: 700, color: isSelected ? siteColor : 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
                          {v.regNo}
                        </td>
                        <td style={{ padding: '10px 14px', color: 'var(--cd-text-muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v.assetName}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11,
                            fontWeight: 600, padding: '3px 8px', borderRadius: 99,
                            background: `${STATUS_COLOR[v.status] ?? '#6B7A8D'}18`,
                            color: STATUS_COLOR[v.status] ?? '#6B7A8D',
                          }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                            {v.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {isOnline ? <Wifi size={14} color="#16a34a" /> : <WifiOff size={14} color="#6B7A8D" />}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {v.fuelLevel != null ? (
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)' }}>
                              {v.fuelLevel.level.toFixed(0)}
                              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--cd-text-muted)', marginLeft: 2 }}>L</span>
                            </span>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--cd-text-muted)', fontStyle: 'italic' }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          {eventsLoading ? (
                            <SkelValue />
                          ) : events?.refuelCount ? (
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); openFuelDetail(v); }}
                              style={{
                                border: 'none', borderRadius: 6, padding: '4px 7px',
                                background: 'rgba(22,163,74,0.1)', color: '#16a34a',
                                fontSize: 11, fontWeight: 700, cursor: 'pointer',
                              }}
                              title="Chart-confirmed refuel — open details"
                            >
                              {refuelDisplay(events)}
                            </button>
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <FuelChart
            selectedRegNo={selectedVehicle?.regNo ?? null}
            selectedAssetId={selectedVehicle?.id ?? null}
            zone={selectedSite}
          />
        </div>
      </div>
    </div>
  );
}
