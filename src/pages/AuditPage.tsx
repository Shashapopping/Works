import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import PagePeriodBar from '../components/PagePeriodBar';
import {
  type PageDateRange,
  defaultPageCustomRange,
  pagePeriodIsoBounds,
} from '../lib/pagePeriod';
import {
  getCoachingNotes,
  getDismissalStore,
  type CoachingNote,
  type InterventionQueue,
} from '../lib/driverInterventions';
import { displayDriverName } from '../lib/driverUtils';

type AuditTab = 'notes' | 'dismissals';

function inRange(iso: string, from: string | null, to: string | null) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  if (from && t < new Date(from).getTime()) return false;
  if (to && t > new Date(to).getTime()) return false;
  return true;
}

export default function AuditPage() {
  const [tab, setTab] = useState<AuditTab>('notes');
  const [dateRange, setDateRange] = useState<PageDateRange>('7days');
  const [customRange, setCustomRange] = useState(defaultPageCustomRange);
  const [search, setSearch] = useState('');
  const [refresh, setRefresh] = useState(0);

  const bounds = pagePeriodIsoBounds(dateRange, customRange.from, customRange.to);

  const notes = useMemo(() => {
    void refresh;
    const q = search.trim().toLowerCase();
    return getCoachingNotes()
      .filter(n => inRange(n.createdAt, bounds.from, bounds.to))
      .filter(n => !q || n.driverName.toLowerCase().includes(q) || n.comment.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [bounds.from, bounds.to, search, refresh]);

  const dismissals = useMemo(() => {
    void refresh;
    const store = getDismissalStore();
    const rows: { queue: InterventionQueue; key: string; at: string }[] = [];
    (['coaching', 'training'] as InterventionQueue[]).forEach(queue => {
      Object.entries(store[queue] || {}).forEach(([key, at]) => {
        if (inRange(at, bounds.from, bounds.to)) rows.push({ queue, key, at });
      });
    });
    const q = search.trim().toLowerCase();
    return rows
      .filter(r => !q || r.key.toLowerCase().includes(q))
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [bounds.from, bounds.to, search, refresh]);

  return (
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">Audit</h1>
        <p className="bpl-page-subtitle">Coaching notes and queue dismissals (browser-stored)</p>
      </div>

      <div className="bpl-card bpl-fatigue-toolbar bpl-audit-toolbar" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div className="bpl-reports-view-toggle bpl-audit-view-toggle" role="tablist" aria-label="Audit section" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
          {([
            { id: 'notes' as const, label: 'Coaching notes' },
            { id: 'dismissals' as const, label: 'Queue dismissals' },
          ]).map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`bpl-reports-view-btn${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
              style={{ whiteSpace: 'nowrap' }}
            >
              {t.label}
            </button>
          ))}
          <button type="button" className="bpl-reports-view-btn" onClick={() => setRefresh(n => n + 1)}>
            Refresh
          </button>
        </div>

        <PagePeriodBar
          value={dateRange}
          onChange={setDateRange}
          customFrom={customRange.from}
          customTo={customRange.to}
          onCustomFromChange={f => setCustomRange(r => ({ ...r, from: f }))}
          onCustomToChange={t => setCustomRange(r => ({ ...r, to: t }))}
        />

        <div className="bpl-fatigue-search" style={{ margin: 0 }}>
          <Search size={15} />
          <input
            type="search"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {tab === 'notes' ? (
        <div className="bpl-card" style={{ padding: 0 }}>
          <table className="bpl-dispatch-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Driver</th>
                <th>Kind</th>
                <th>Comment</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {notes.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--cd-text-muted)' }}>No notes in period</td></tr>
              ) : notes.map((n: CoachingNote) => (
                <tr key={n.id}>
                  <td>{new Date(n.createdAt).toLocaleString('en-GB')}</td>
                  <td style={{ fontWeight: 600 }}>{displayDriverName(n.driverName)}</td>
                  <td>{n.kind === 'written_warning' ? 'Write-up' : 'Note'}</td>
                  <td style={{ maxWidth: 420 }}>{n.comment}</td>
                  <td>{n.addedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bpl-card" style={{ padding: 0 }}>
          <table className="bpl-dispatch-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Queue</th>
                <th>Driver key</th>
              </tr>
            </thead>
            <tbody>
              {dismissals.length === 0 ? (
                <tr><td colSpan={3} style={{ padding: 24, textAlign: 'center', color: 'var(--cd-text-muted)' }}>No dismissals in period</td></tr>
              ) : dismissals.map(r => (
                <tr key={`${r.queue}-${r.key}-${r.at}`}>
                  <td>{new Date(r.at).toLocaleString('en-GB')}</td>
                  <td style={{ textTransform: 'capitalize' }}>{r.queue}</td>
                  <td>{r.key}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
