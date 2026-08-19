import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Truck, Activity, TrendingUp, DollarSign, AlertCircle, Wifi, WifiOff, Route, BarChart2, Fuel } from 'lucide-react';
import { useFleet } from '../context/FleetContext';

const QUARRY_ZONES = ['lh quarry', 'quarry ewekoro', 'quarry mfamosing'];

const STATUS_COLOR: Record<string, string> = {
  Moving: '#16a34a',
  Idle: '#d97706',
  'Excessive Idle': '#CC0000',
  Stationary: '#0d9488',
  Parked: '#7C3AED',
  Offline: '#6B7A8D',
  Inactive: '#6878A0',
};

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

function KPICard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string | number; sub?: string; color?: string; icon?: any;
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


function UtilizationSection() {
  const { metadata, vehicles } = useFleet();
  const total = vehicles.length || 1;
  const deployable = total - metadata.offline - metadata.inactive;
  const utilizationPct = Math.round((metadata.moving / Math.max(deployable, 1)) * 100);
  const availabilityPct = Math.round((deployable / total) * 100);

  const bars = [
    { label: 'Moving', value: metadata.moving, color: '#16a34a', pct: (metadata.moving / total) * 100 },
    { label: 'Parked', value: metadata.parked, color: '#7C3AED', pct: (metadata.parked / total) * 100 },
    { label: 'Idle', value: metadata.idle + metadata.excessiveIdle, color: '#d97706', pct: ((metadata.idle + metadata.excessiveIdle) / total) * 100 },
    { label: 'Stationary', value: metadata.stationary, color: '#0d9488', pct: (metadata.stationary / total) * 100 },
    { label: 'Temp Inactive', value: metadata.offline, color: '#6B7A8D', pct: (metadata.offline / total) * 100 },
    { label: 'Inactive', value: metadata.inactive, color: '#6878A0', pct: (metadata.inactive / total) * 100 },
  ];

  return (
    <div>
      <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <KPICard label="Total Fleet" value={vehicles.length} icon={Truck} color="#0078D4" />
        <KPICard label="Asset Availability" value={`${availabilityPct}%`} sub={`${deployable} of ${total} deployable`} color="#16a34a" icon={Activity} />
        <KPICard label="Active Utilisation" value={`${utilizationPct}%`} sub="Moving / deployable fleet" color={utilizationPct > 50 ? '#16a34a' : '#d97706'} />
        <KPICard label="Vehicles Moving" value={metadata.moving} sub="Currently on road" color="#16a34a" icon={TrendingUp} />
      </div>

      <div className="bpl-card" style={{ padding: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 16, fontFamily: 'var(--cd-font-display)' }}>
          Fleet Status Breakdown
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {bars.map(b => (
            <div key={b.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 13 }}>
                <span style={{ fontWeight: 500, color: 'var(--cd-text)' }}>{b.label}</span>
                <span style={{ color: b.color, fontWeight: 700 }}>{b.value} <span style={{ color: 'var(--cd-text-muted)', fontWeight: 400 }}>({Math.round(b.pct)}%)</span></span>
              </div>
              <div style={{ height: 8, background: 'var(--cd-border)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${b.pct}%`, background: b.color, borderRadius: 99, transition: 'width 0.4s ease' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type DistanceRange = '24h' | 'currentMonth' | 'lastMonth';

function useDistanceData(range: DistanceRange) {
  const { authFetch } = useFleet();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    authFetch(`/api/driver-distance?range=${range}&trips=0`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, authFetch]);

  return { data, loading };
}

function RangeTabs({ value, onChange }: { value: DistanceRange; onChange: (r: DistanceRange) => void }) {
  const tabs: { key: DistanceRange; label: string }[] = [
    { key: '24h', label: 'Today' },
    { key: 'currentMonth', label: 'This Month' },
    { key: 'lastMonth', label: 'Last Month' },
  ];
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)} className="bpl-btn-secondary" style={{
          padding: '5px 14px', fontSize: 12,
          background: value === t.key ? 'var(--bpl-blue-soft)' : undefined,
          borderColor: value === t.key ? 'var(--bpl-blue)' : undefined,
          color: value === t.key ? 'var(--bpl-blue)' : undefined,
        }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ProductivitySection() {
  const [range, setRange] = useState<DistanceRange>('24h');
  const { data, loading } = useDistanceData(range);

  const assets: any[] = data?.assets || [];
  const totalDist = data?.totalDistanceKm ?? 0;
  const journeyCount = data?.journeyCount ?? 0;
  const assetCount = data?.assetCount ?? 0;
  const avgPerAsset = assetCount > 0 ? (totalDist / assetCount).toFixed(1) : '—';

  return (
    <div>
      <RangeTabs value={range} onChange={setRange} />

      <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <KPICard label="Total Distance" value={`${totalDist.toLocaleString()} km`} icon={Route} color="#0078D4" sub="All assets combined" />
        <KPICard label="Journeys" value={journeyCount.toLocaleString()} icon={TrendingUp} color="#16a34a" sub="Merged trip segments" />
        <KPICard label="Active Assets" value={assetCount} icon={Truck} color="#7C3AED" sub="With recorded trips" />
        <KPICard label="Avg Distance / Asset" value={`${avgPerAsset} km`} icon={BarChart2} color="#0d9488" sub="Across active assets" />
      </div>

      <div className="bpl-card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--cd-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>Distance by Asset</span>
          <span style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>Top {Math.min(assets.length, 20)} of {assets.length}</span>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--cd-text-muted)', fontSize: 13 }}>Loading trip data…</div>
        ) : assets.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--cd-text-muted)', fontSize: 13 }}>No trip data for this period</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--cd-surface-2)' }}>
                {['#', 'Reg No', 'Asset', 'Journeys', 'Distance', 'Avg Speed', 'Longest Run'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assets.slice(0, 20).map((a: any, i: number) => {
                const distPct = totalDist > 0 ? (a.totalDistanceKm / totalDist) * 100 : 0;
                return (
                  <tr key={a.assetId} style={{ borderTop: '1px solid var(--cd-border)', background: i % 2 === 0 ? 'transparent' : 'var(--cd-surface-2)' }}>
                    <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', fontWeight: 600, width: 32 }}>{i + 1}</td>
                    <td style={{ padding: '11px 16px', fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)', whiteSpace: 'nowrap' }}>{a.regNo}</td>
                    <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.assetName}</td>
                    <td style={{ padding: '11px 16px', color: 'var(--cd-text)', textAlign: 'right' }}>{a.journeyCount}</td>
                    <td style={{ padding: '11px 16px', minWidth: 140 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, color: '#0078D4', whiteSpace: 'nowrap' }}>{a.totalDistanceKm.toLocaleString()} km</span>
                        <div style={{ flex: 1, height: 4, background: 'var(--cd-border)', borderRadius: 99, overflow: 'hidden', minWidth: 40 }}>
                          <div style={{ height: '100%', width: `${distPct}%`, background: '#0078D4', borderRadius: 99 }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', textAlign: 'right' }}>{a.avgSpeedKph != null ? `${a.avgSpeedKph} km/h` : '—'}</td>
                    <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', textAlign: 'right' }}>{a.longestJourneyKm > 0 ? `${a.longestJourneyKm} km` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function AssetEconomics() {
  const [range, setRange] = useState<DistanceRange>('currentMonth');
  const { data, loading } = useDistanceData(range);
  const assets: any[] = data?.assets || [];

  return (
    <div>
      <div style={{
        padding: '14px 18px', marginBottom: 16, borderRadius: 10,
        background: 'rgba(100,116,139,0.07)', border: '1px dashed var(--cd-border)',
        display: 'flex', alignItems: 'flex-start', gap: 10,
      }}>
        <AlertCircle size={15} color="var(--cd-text-muted)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 13, color: 'var(--cd-text-muted)', lineHeight: 1.5 }}>
          Revenue and cost data requires ERP integration. Distance covered per asset is live from MiX trips. Cost per km and ROI will populate once your logistics system is connected.
        </div>
      </div>

      <RangeTabs value={range} onChange={setRange} />

      <div className="bpl-card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--cd-border)' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>Distance Covered vs Cost — Per Asset</span>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--cd-text-muted)', fontSize: 13 }}>Loading…</div>
        ) : assets.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--cd-text-muted)', fontSize: 13 }}>No trip data for this period</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--cd-surface-2)' }}>
                {['Reg No', 'Asset', 'Distance Covered', 'Journeys', 'Avg Speed', 'Cost / km', 'Revenue / Vehicle'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assets.slice(0, 20).map((a: any, i: number) => (
                <tr key={a.assetId} style={{ borderTop: '1px solid var(--cd-border)', background: i % 2 === 0 ? 'transparent' : 'var(--cd-surface-2)' }}>
                  <td style={{ padding: '11px 16px', fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)', whiteSpace: 'nowrap' }}>{a.regNo}</td>
                  <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.assetName}</td>
                  <td style={{ padding: '11px 16px', fontWeight: 700, color: '#0078D4' }}>{a.totalDistanceKm.toLocaleString()} km</td>
                  <td style={{ padding: '11px 16px', color: 'var(--cd-text)', textAlign: 'right' }}>{a.journeyCount}</td>
                  <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', textAlign: 'right' }}>{a.avgSpeedKph != null ? `${a.avgSpeedKph} km/h` : '—'}</td>
                  <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', fontStyle: 'italic' }}>—</td>
                  <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', fontStyle: 'italic' }}>—</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FuelMonitorSection() {
  const { vehicles } = useFleet();

  const quarryVehicles = vehicles.filter(v =>
    QUARRY_ZONES.some(z => v.zone?.toLowerCase().includes(z))
  );

  const byZone: Record<string, typeof quarryVehicles> = {};
  quarryVehicles.forEach(v => {
    const z = v.zone || 'Unknown Zone';
    if (!byZone[z]) byZone[z] = [];
    byZone[z].push(v);
  });

  const online = quarryVehicles.filter(v => v.status !== 'Offline' && v.status !== 'Inactive').length;

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--cd-text-muted)', marginBottom: 16 }}>
        Fuel probe monitors are fitted to quarry assets only. Live fuel level data streams via the MiX Fuel Probe 1min Ticker event.
      </div>

      <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        <KPICard label="Quarry Assets" value={quarryVehicles.length} icon={Truck} color="#0078D4" sub="Fuel probe fitted" />
        <KPICard label="Online Now" value={online} color="#16a34a" icon={Activity} sub="Reporting to MiX" />
        <KPICard label="Temp Inactive" value={quarryVehicles.length - online} color="#6B7A8D" sub="No recent signal" />
        <KPICard label="Quarry Zones" value={Object.keys(byZone).length} color="#7C3AED" sub="LH · Ewekoro · Mfamosing" />
      </div>

      <div className="bpl-card" style={{ padding: 20, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Fuel size={18} color="#0078D4" />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cd-text)' }}>Fuel monitoring & consumption</div>
            <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>Live probe levels and trip fuel estimates are on the Fuel pages.</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/fuel/monitoring" className="bpl-card-link" style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--cd-border)' }}>Monitoring</Link>
          <Link to="/fuel/consumption" className="bpl-card-link" style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--cd-border)' }}>Consumption</Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, alignItems: 'start', marginTop: 20 }}>
        {Object.entries(byZone).sort(([a], [b]) => a.localeCompare(b)).map(([zone, zVehicles]) => {
          const zOnline = zVehicles.filter(v => v.status !== 'Offline' && v.status !== 'Inactive').length;
          return (
            <div key={zone} className="bpl-card" style={{ overflow: 'hidden' }}>
              <div style={{
                padding: '14px 20px', borderBottom: '1px solid var(--cd-border)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
                  {zone}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: 'var(--cd-text-muted)' }}>
                  <span>{zVehicles.length} assets</span>
                  <span style={{ color: '#16a34a', fontWeight: 600 }}>{zOnline} online</span>
                </div>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--cd-surface-2)' }}>
                    {['Reg No', 'Asset', 'Status', 'Signal', 'Fuel Level'].map(h => (
                      <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {zVehicles.sort((a, b) => a.regNo.localeCompare(b.regNo)).map((v, i) => {
                    const isOnline = v.status !== 'Offline' && v.status !== 'Inactive';
                    return (
                      <tr key={v.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--cd-border)', background: i % 2 === 0 ? 'transparent' : 'var(--cd-surface-2)' }}>
                        <td style={{ padding: '11px 20px', fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>{v.regNo}</td>
                        <td style={{ padding: '11px 20px', color: 'var(--cd-text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.assetName}</td>
                        <td style={{ padding: '11px 20px' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11,
                            fontWeight: 600, padding: '3px 9px', borderRadius: 99,
                            background: `${STATUS_COLOR[v.status] ?? '#6B7A8D'}18`,
                            color: STATUS_COLOR[v.status] ?? '#6B7A8D',
                          }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                            {v.status}
                          </span>
                        </td>
                        <td style={{ padding: '11px 20px' }}>
                          {isOnline
                            ? <Wifi size={14} color="#16a34a" />
                            : <WifiOff size={14} color="#6B7A8D" />}
                        </td>
                        <td style={{ padding: '11px 20px' }}>
                          {(v as any).fuelLevel != null ? (
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)' }}>
                              {(v as any).fuelLevel.level.toFixed(0)}
                              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--cd-text-muted)', marginLeft: 3 }}>L</span>
                            </span>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--cd-text-muted)', fontStyle: 'italic' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Operations() {
  return (
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">Operations</h1>
        <p className="bpl-page-subtitle">Fleet utilisation, productivity, asset economics, and fuel monitoring</p>
      </div>

      <div style={{ marginBottom: 32 }}>
        <SectionHeading title="Fleet Utilisation" subtitle="Real-time asset status and deployment breakdown" />
        <UtilizationSection />
      </div>

      <div style={{ marginBottom: 32 }}>
        <SectionHeading title="Productivity" subtitle="Turnaround time, route performance, and driver output" />
        <ProductivitySection />
      </div>

      <div style={{ marginBottom: 32 }}>
        <SectionHeading title="Asset Economics" subtitle="Revenue per vehicle, cost per km, and fleet ROI" />
        <AssetEconomics />
      </div>

      <div style={{ marginBottom: 16 }}>
        <SectionHeading title="Fuel Monitoring" subtitle="Quarry fuel probe data — LH · Ewekoro · Mfamosing" />
        <FuelMonitorSection />
      </div>
    </div>
  );
}
