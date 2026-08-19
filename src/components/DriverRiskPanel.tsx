/* eslint-disable @typescript-eslint/no-unused-vars */

import { useState, useEffect } from 'react';
import { X, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { isKnownDriver, displayDriverName } from '../lib/driverUtils';
import { brandLabel } from '../lib/branding';
import { DEMO_BRANDING } from '../config/demoBranding';

declare const jspdf: any;

const PANIC_EVENT_TYPE_ID = '-4444421556390778105';

interface LogEntry {
  timestamp: string;
  assetId: string;
  regNo?: string;
  assetName?: string;
  transporter?: string;
  driverName?: string;
  driverPhone?: string;
  address?: string;
  eventId: string;
  eventType?: string;
  label?: string;
  eventTime: string;
  rawEvent?: any;
}

interface DriverRisk {
  driverName: string;
  driverPhone: string;
  assetName: string;
  regNo: string;
  transporter: string;
  harshBraking: number;
  harshAcceleration: number;
  overspeeding: number;
  overspeedTiered: number;
  harshCornering: number;
  total: number;
  panic: number;
  events: LogEntry[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  isMobile: boolean;
}

type DateRange = 'today' | '7days' | '30days' | 'alltime' | 'custom';
type Format = 'csv' | 'excel' | 'pdf';
type TopN = 10 | 20 | 50 | 'all';

function isoLogRange(dateRange: DateRange, fromDate: string, toDate: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  if (dateRange === 'today') {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to };
  }
  if (dateRange === '7days') return { from: new Date(now.getTime() - 7 * 86400000).toISOString(), to };
  if (dateRange === '30days') return { from: new Date(now.getTime() - 30 * 86400000).toISOString(), to };
  if (dateRange === 'custom' && fromDate && toDate) {
    return {
      from: new Date(fromDate).toISOString(),
      to: new Date(new Date(toDate).getTime() + 86400000 - 1).toISOString(),
    };
  }
  return { from: '2020-01-01T00:00:00.000Z', to };
}

const HIDDEN_LABELS = ['Possible Power Tamper', 'Battery Disconnection', 'Battery Disconnected', 'Front Panel Tamper', 'Back Panel Tamper', 'No Blue Key'];

const LABEL_TO_KEY: Record<string, keyof Pick<DriverRisk, 'harshBraking' | 'harshAcceleration' | 'overspeeding' | 'overspeedTiered' | 'harshCornering'>> = {
  'Harsh Braking': 'harshBraking',
  'Harsh Acceleration': 'harshAcceleration',
  'Overspeeding': 'overspeeding',
  'Overspeed Tiered': 'overspeedTiered',
  'Harsh Cornering': 'harshCornering',
};

function isPanicEntry(entry: LogEntry): boolean {
  return entry.eventType === PANIC_EVENT_TYPE_ID || (!entry.label && !entry.eventType);
}

function getLocation(entry: LogEntry): string {
  if (entry.address && entry.address !== 'N/A' && entry.address !== 'null') return entry.address;
  const addr = entry.rawEvent?.Position?.FormattedAddress;
  if (addr && addr !== 'null') return addr;
  const lat = entry.rawEvent?.Position?.Latitude;
  const lng = entry.rawEvent?.Position?.Longitude;
  if (lat && lng) return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  return 'N/A';
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export default function DriverRiskPanel({ open, onClose, authFetch, isMobile }: Props) {
  const [driversRaw, setDriversRaw] = useState<DriverRisk[]>([]);
  const [eventPages, setEventPages] = useState<Record<string, LogEntry[]>>({});
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('7days');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [topN, setTopN] = useState<TopN>('all');
  const [expandedDrivers, setExpandedDrivers] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<Format>('csv');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (dateRange === 'custom' && (!fromDate || !toDate)) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const { from, to } = isoLogRange(dateRange, fromDate, toDate);
        const params = new URLSearchParams({ from, to });
        const res = await authFetch(`/api/risk/drivers?${params}`);
        if (!res.ok) return;
        const data = await res.json();
        const rows = Array.isArray(data?.drivers) ? data.drivers : [];
        if (cancelled) return;
        setDriversRaw(rows
          .filter((d: { driverName?: string }) => isKnownDriver(d.driverName))
          .map((d: {
            driverName?: string;
            assetId?: string | null;
            harshBraking?: number;
            harshAcceleration?: number;
            overspeeding?: number;
            overspeedTiered?: number;
            harshCornering?: number;
            total?: number;
          }) => ({
            driverName: d.driverName || 'N/A',
            driverPhone: 'N/A',
            assetName: d.assetId || 'N/A',
            regNo: 'N/A',
            transporter: 'N/A',
            harshBraking: d.harshBraking || 0,
            harshAcceleration: d.harshAcceleration || 0,
            overspeeding: d.overspeeding || 0,
            overspeedTiered: d.overspeedTiered || 0,
            harshCornering: d.harshCornering || 0,
            total: d.total || 0,
            panic: 0,
            events: [],
          })));
        setEventPages({});
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [open, dateRange, fromDate, toDate, authFetch]);

  if (!open) return null;

  let drivers = [...driversRaw].sort((a, b) => b.total - a.total);

  if (searchTerm) {
    const s = searchTerm.toLowerCase();
    drivers = drivers.filter(d =>
      d.driverName.toLowerCase().includes(s) ||
      d.regNo.toLowerCase().includes(s) ||
      d.assetName.toLowerCase().includes(s) ||
      d.transporter.toLowerCase().includes(s)
    );
  }

  if (topN !== 'all') {
    drivers = drivers.slice(0, topN);
  }

  const toggleExpanded = (key: string, driverName: string) => {
    setExpandedDrivers(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    if (eventPages[key]) return;
    const { from, to } = isoLogRange(dateRange, fromDate, toDate);
    const params = new URLSearchParams({
      format: 'page',
      limit: '40',
      from,
      to,
      driver: driverName,
    });
    void authFetch(`/api/events/log?${params}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data) return;
        const rows = Array.isArray(data) ? data : data.entries ?? [];
        setEventPages(prev => ({ ...prev, [key]: rows }));
      })
      .catch(() => { /* ignore */ });
  };

  const COLUMNS = [
    { header: 'Type', getSummary: (_d: DriverRisk) => 'SUMMARY', getEvent: (_d: DriverRisk, _e: LogEntry) => 'EVENT' },
    { header: 'Asset Name', getSummary: (d: DriverRisk) => d.assetName, getEvent: (_d: DriverRisk, e: LogEntry) => e.assetName || 'N/A' },
    { header: 'Reg No', getSummary: (d: DriverRisk) => d.regNo, getEvent: (_d: DriverRisk, e: LogEntry) => e.regNo || 'N/A' },
    { header: 'Transporter', getSummary: (d: DriverRisk) => d.transporter, getEvent: (_d: DriverRisk, e: LogEntry) => e.transporter || 'N/A' },
    { header: 'Driver', getSummary: (d: DriverRisk) => displayDriverName(d.driverName), getEvent: (d: DriverRisk, _e: LogEntry) => displayDriverName(d.driverName) },
    { header: 'Phone', getSummary: (d: DriverRisk) => d.driverPhone, getEvent: (d: DriverRisk, _e: LogEntry) => d.driverPhone },
    { header: 'H.Brake', getSummary: (d: DriverRisk) => String(d.harshBraking), getEvent: (_d: DriverRisk, e: LogEntry) => e.label === 'Harsh Braking' ? '1' : '—' },
    { header: 'H.Accel', getSummary: (d: DriverRisk) => String(d.harshAcceleration), getEvent: (_d: DriverRisk, e: LogEntry) => e.label === 'Harsh Acceleration' ? '1' : '—' },
    { header: 'Overspeeding', getSummary: (d: DriverRisk) => String(d.overspeeding), getEvent: (_d: DriverRisk, e: LogEntry) => e.label === 'Overspeeding' ? '1' : '—' },
    { header: 'Ovr.Tiered', getSummary: (d: DriverRisk) => String(d.overspeedTiered), getEvent: (_d: DriverRisk, e: LogEntry) => e.label === 'Overspeed Tiered' ? '1' : '—' },
    { header: 'Corner', getSummary: (d: DriverRisk) => String(d.harshCornering), getEvent: (_d: DriverRisk, e: LogEntry) => e.label === 'Harsh Cornering' ? '1' : '—' },
    { header: 'Total', getSummary: (d: DriverRisk) => String(d.total), getEvent: (_d: DriverRisk, e: LogEntry) => (e.label && LABEL_TO_KEY[e.label]) ? '1' : '—' },
    { header: 'Panic', getSummary: (d: DriverRisk) => String(d.panic), getEvent: (_d: DriverRisk, e: LogEntry) => isPanicEntry(e) ? '1' : '—' },
    { header: 'Event', getSummary: (_d: DriverRisk) => '—', getEvent: (_d: DriverRisk, e: LogEntry) => e.label || 'Panic' },
    { header: 'Event Time', getSummary: (_d: DriverRisk) => '—', getEvent: (_d: DriverRisk, e: LogEntry) => e.eventTime ? formatTime(e.eventTime) : 'N/A' },
    { header: 'Location', getSummary: (_d: DriverRisk) => '—', getEvent: (_d: DriverRisk, e: LogEntry) => getLocation(e) },
  ];

  const buildRows = () => drivers.map(d => COLUMNS.map(c => c.getSummary(d)));

  const downloadCSV = () => {
    const headers = COLUMNS.map(c => `"${c.header}"`);
    const rows = buildRows().map(row => row.map((val, i) => {
      const escaped = val.replace(/"/g, '""');
      if ((COLUMNS[i].header === 'Phone' || COLUMNS[i].header === 'Reg No') && val !== 'N/A' && val !== '—') {
        return `"=""${escaped}"""`;
      }
      return `"${escaped}"`;
    }));
    const csv = '\uFEFF' + [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cnl-driver-risk-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadExcel = () => {
    const wb = (window as any).XLSX.utils.book_new();
    const wsData = [
      COLUMNS.map(c => c.header),
      ...buildRows().map(row => row.map((val, i) => {
        if (COLUMNS[i].header === 'Phone' && val !== 'N/A' && val !== '—') return { v: val, t: 's' };
        return val;
      }))
    ];
    const ws = (window as any).XLSX.utils.aoa_to_sheet(wsData);
    (window as any).XLSX.utils.book_append_sheet(wb, ws, 'Driver Risk');
    (window as any).XLSX.writeFile(wb, `cnl-driver-risk-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const downloadPDF = () => {
    try {
      const { jsPDF } = jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      doc.setFontSize(16);
      doc.setTextColor(200, 16, 46);
      doc.text('CNL Driver Risk Report', 14, 16);

      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(`Generated: ${new Date().toLocaleString('en-GB')} • ${drivers.length} driver${drivers.length !== 1 ? 's' : ''}`, 14, 23);

      const dateLabel = dateRange === 'today' ? 'Today' : dateRange === '7days' ? 'Last 7 days' : dateRange === '30days' ? 'Last 30 days' : dateRange === 'alltime' ? 'All time' : `${fromDate} to ${toDate}`;
      doc.text(`Date: ${dateLabel}  •  Showing: ${topN === 'all' ? 'All drivers' : `Top ${topN}`}`, 14, 29);

      let y = 34;

      drivers.forEach(d => {
        if (y > 175) { doc.addPage(); y = 14; }

        (doc as any).autoTable({
          startY: y,
          body: [[
            `${displayDriverName(d.driverName)}  •  ${DEMO_BRANDING ? '***' : d.driverPhone}`,
            `H.Brk: ${d.harshBraking}  H.Acc: ${d.harshAcceleration}  Ovspd: ${d.overspeeding}  Tier: ${d.overspeedTiered}  Cnr: ${d.harshCornering}  Panic: ${d.panic}`,
            `Total: ${d.total}`
          ]],
          theme: 'plain',
          styles: { fontSize: 8, cellPadding: 3, fillColor: [255, 251, 235], textColor: [133, 79, 11], fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 140 }, 2: { cellWidth: 30, halign: 'right' } },
          tableLineColor: [253, 230, 138],
          tableLineWidth: 0.3,
          margin: { left: 14, right: 14 },
        });

        y = (doc as any).lastAutoTable.finalY + 6;
      });

      doc.save(`cnl-driver-risk-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error('PDF generation failed:', err);
    }
  };

  const handleDownload = () => {
    setDownloading(true);
    try {
      if (format === 'csv') downloadCSV();
      else if (format === 'excel') downloadExcel();
      else if (format === 'pdf') downloadPDF();
    } finally {
      setDownloading(false);
    }
  };

  const panelStyle: React.CSSProperties = isMobile ? {
    position: 'fixed', inset: 0, zIndex: 1001,
    backgroundColor: 'var(--cd-surface)',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  } : {
    position: 'fixed', top: 0, right: 0, bottom: 0,
    width: '60%',
    minWidth: '600px',
    zIndex: 1001,
    backgroundColor: 'var(--cd-surface)',
    borderLeft: '1px solid var(--cd-border)',
    boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 1000 }} />
      <div style={panelStyle}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--cd-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: '16px', fontWeight: '600', color: 'var(--cd-text)' }}>Driver Risk</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cd-text-muted)', padding: '4px' }}>
            <X style={{ width: '20px', height: '20px' }} />
          </button>
        </div>

        {/* Date Range */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--cd-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: dateRange === 'custom' ? '8px' : '0' }}>
            {(['today', '7days', '30days', 'alltime', 'custom'] as DateRange[]).map(r => (
              <button key={r} onClick={() => setDateRange(r)}
                style={{ padding: '4px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: dateRange === r ? '500' : '400', cursor: 'pointer', border: dateRange === r ? '0.5px solid var(--cd-accent-2)' : '0.5px solid var(--cd-border)', background: dateRange === r ? '#eff6ff' : 'var(--cd-surface-2)', color: dateRange === r ? '#2563eb' : 'var(--cd-text-muted)' }}>
                {r === 'today' ? 'Today' : r === '7days' ? '7 days' : r === '30days' ? '30 days' : r === 'alltime' ? 'All time' : 'Custom'}
              </button>
            ))}
          </div>
          {dateRange === 'custom' && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '11px', color: 'var(--cd-text-muted)', display: 'block', marginBottom: '3px' }}>From</label>
                <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--cd-border)', borderRadius: '8px', fontSize: '12px', backgroundColor: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '11px', color: 'var(--cd-text-muted)', display: 'block', marginBottom: '3px' }}>To</label>
                <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--cd-border)', borderRadius: '8px', fontSize: '12px', backgroundColor: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none' }} />
              </div>
            </div>
          )}
        </div>

        {/* Search + Top N + Download */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--cd-border)', display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
            <Search style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', width: '14px', height: '14px', color: 'var(--cd-text-soft)' }} />
            <input type="text" placeholder="Search driver, reg no or asset..." value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ width: '100%', paddingLeft: '32px', paddingRight: '12px', paddingTop: '7px', paddingBottom: '7px', border: '1px solid var(--cd-border)', borderRadius: '8px', fontSize: '13px', outline: 'none', backgroundColor: 'var(--cd-surface-2)', color: 'var(--cd-text)' }} />
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {([10, 20, 50, 'all'] as TopN[]).map(n => (
              <button key={n} onClick={() => setTopN(n)}
                style={{ padding: '4px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: topN === n ? '500' : '400', cursor: 'pointer', border: topN === n ? '0.5px solid var(--cd-accent-2)' : '0.5px solid var(--cd-border)', background: topN === n ? '#eff6ff' : 'var(--cd-surface-2)', color: topN === n ? '#2563eb' : 'var(--cd-text-muted)' }}>
                {n === 'all' ? 'All' : `Top ${n}`}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {(['csv', 'excel', 'pdf'] as Format[]).map(f => (
              <button key={f} onClick={() => setFormat(f)}
                style={{ padding: '4px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: format === f ? '500' : '400', cursor: 'pointer', border: format === f ? '0.5px solid var(--cd-accent-2)' : '0.5px solid var(--cd-border)', background: format === f ? '#eff6ff' : 'var(--cd-surface-2)', color: format === f ? '#2563eb' : 'var(--cd-text-muted)', textTransform: 'uppercase' }}>
                {f}
              </button>
            ))}
            <button onClick={handleDownload} disabled={downloading || drivers.length === 0}
              style={{ padding: '6px 14px', borderRadius: '8px', border: 'none', background: downloading || drivers.length === 0 ? 'var(--cd-surface-2)' : '#c8102e', color: downloading || drivers.length === 0 ? 'var(--cd-text-muted)' : '#fff', fontSize: '12px', fontWeight: '600', cursor: downloading || drivers.length === 0 ? 'not-allowed' : 'pointer' }}>
              {downloading ? 'Preparing...' : 'Download'}
            </button>
          </div>
        </div>

        {/* Driver List */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {loading && driversRaw.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--cd-text-muted)', fontSize: '13px' }}>Loading...</div>
          ) : drivers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--cd-text-muted)', fontSize: '13px' }}>No data found</div>
          ) : drivers.map((driver, idx) => {
            const key = `${driver.driverName}-${driver.regNo}`;
            const isExpanded = expandedDrivers.has(key);
            const hasInfractions = driver.total > 0 || driver.panic > 0;
            return (
              <div key={key} style={{ borderRadius: '8px', border: `0.5px solid ${hasInfractions ? '#fde68a' : 'var(--cd-border)'}`, backgroundColor: hasInfractions ? '#fffbeb' : 'var(--cd-surface-2)', overflow: 'hidden', flexShrink: 0 }}>

                {/* Summary Row */}
                <div onClick={() => toggleExpanded(key, driver.driverName)} style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>

                  {/* Rank */}
                  <span style={{ fontSize: '11px', fontWeight: '600', color: hasInfractions ? '#854F0B' : 'var(--cd-text-muted)', minWidth: '24px' }}>
                    #{idx + 1}
                  </span>

                  {/* Driver + Asset info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: hasInfractions ? '#854F0B' : 'var(--cd-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {displayDriverName(driver.driverName)}
                      {driver.driverPhone && driver.driverPhone !== 'N/A' && (
                        <span style={{ fontSize: '11px', fontWeight: '400', color: 'var(--cd-text-muted)', marginLeft: '8px' }}>
                          · {DEMO_BRANDING ? '***' : driver.driverPhone}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {driver.regNo} · {brandLabel(driver.assetName)} · {brandLabel(driver.transporter)}
                    </div>
                  </div>

                  {/* Infraction counts */}
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '60%' }}>
                    {driver.harshBraking > 0 && <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '9999px', background: '#fef3c7', color: '#854F0B', border: '0.5px solid #fde68a' }}>Harsh Braking {driver.harshBraking}</span>}
                    {driver.harshAcceleration > 0 && <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '9999px', background: '#fef3c7', color: '#854F0B', border: '0.5px solid #fde68a' }}>Harsh Acceleration {driver.harshAcceleration}</span>}
                    {driver.overspeeding > 0 && <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '9999px', background: '#fef3c7', color: '#854F0B', border: '0.5px solid #fde68a' }}>Overspeeding {driver.overspeeding}</span>}
                    {driver.overspeedTiered > 0 && <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '9999px', background: '#fef3c7', color: '#854F0B', border: '0.5px solid #fde68a' }}>Overspeed Tiered {driver.overspeedTiered}</span>}
                    {driver.harshCornering > 0 && <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '9999px', background: '#fef3c7', color: '#854F0B', border: '0.5px solid #fde68a' }}>Harsh Cornering {driver.harshCornering}</span>}
                    {driver.panic > 0 && <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '9999px', background: '#fff1f2', color: '#c8102e', border: '0.5px solid #fecdd3' }}>🚨 {driver.panic}</span>}
                    <span style={{ fontSize: '12px', fontWeight: '700', color: hasInfractions ? '#854F0B' : 'var(--cd-text-muted)', minWidth: '28px', textAlign: 'right' }}>
                      {driver.total}
                    </span>
                    {isExpanded ? <ChevronUp style={{ width: '14px', height: '14px', color: 'var(--cd-text-muted)', flexShrink: 0 }} /> : <ChevronDown style={{ width: '14px', height: '14px', color: 'var(--cd-text-muted)', flexShrink: 0 }} />}
                  </div>
                </div>

                {/* Expanded Events */}
                {isExpanded && (
                  <div style={{ borderTop: '0.5px solid #fde68a', backgroundColor: 'var(--cd-surface)', maxHeight: '320px', overflowY: 'auto' }}>
                    {(eventPages[key] || driver.events)
                      .filter(e => !HIDDEN_LABELS.includes(e.label || ''))
                      .sort((a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime())
                      .map((e, ei) => {
                        const panic = isPanicEntry(e);
                        const loc = getLocation(e);
                        const eventAsset = e.assetName || driver.assetName;
                        const eventReg = e.regNo || driver.regNo;
                        return (
                          <div key={`${e.eventId}-${ei}`} style={{ padding: '8px 12px 8px 46px', borderBottom: '0.5px solid var(--cd-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '11px', fontWeight: '600', color: panic ? '#c8102e' : '#854F0B' }}>
                                  {panic ? '🚨' : '⚠'} {e.label || 'Panic'}
                                </span>
                                <span style={{ fontSize: '10px', color: 'var(--cd-text-muted)' }}>
                                  {eventReg} · {eventAsset}
                                </span>
                              </div>
                              {loc !== 'N/A' && (
                                <div style={{ fontSize: '10px', color: 'var(--cd-text-muted)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{loc}</div>
                              )}
                            </div>
                            <span style={{ fontSize: '10px', color: 'var(--cd-text-soft)', flexShrink: 0 }}>{formatTime(e.eventTime)}</span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--cd-border)', fontSize: '11px', color: 'var(--cd-text-muted)', textAlign: 'center', flexShrink: 0 }}>
          {drivers.length} driver{drivers.length !== 1 ? 's' : ''} · totals from SQL
        </div>

      </div>
    </>
  );
}