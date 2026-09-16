import { useState, useMemo, useDeferredValue, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Award, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useFleet, authFetch } from '../../context/FleetContext';
import { useAuth } from '../../context/AuthContext';
import { displayDriverName } from '../../lib/driverUtils';
import MockNamesBadge from '../../components/MockNamesBadge';
import InfoTip from '../../components/InfoTip';
import {
  qualifyCoaching,
  qualifyTraining,
  isDismissed,
  dismissFromQueue,
  getNotesForDriver,
  addCoachingNote,
  type DriverSnapshot,
} from '../../lib/driverInterventions';
import { COACHING_EVENT_COUNT, COACHING_SCORE_THRESHOLD, COACHING_WINDOW_DAYS } from '../../config/interventionRules';
import { categoryPlainDescription, logConsequenceResponse, loadConsequenceOccurrences, nextOccurrenceIndex, recommendedConsequence, addResponseLogEntry, getResponseLogForDriver, type ConsequenceCategory } from '../../lib/consequenceScore';
import { assessDriversFromRisk, type AssessedDriver } from '../../lib/driverAssessment';
import { useAssessmentTripDrivers } from '../../hooks/useAssessmentTripDrivers';
import { useClientPagination } from '../../hooks/useClientPagination';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import PageControls from '../../components/PageControls';
import { brandLabel } from '../../lib/branding';
import { SkelValue, SkelTable } from '../../components/data/DataBusy';
import { fetchTaggingUsers, issueWrittenWarning, type TaggingUser } from '../../lib/coachingWarningsApi';
import { authCachedJson, cachePeek, CACHE_TTL } from '../../lib/apiCache';
import { filterRiskDriversByVehicles, filterTripDriversByVehicles } from '../../lib/siteScope';

/** Matches COACHING_WINDOW_DAYS — SQL rollups, not the boot event feed. */
const COACHING_RISK_URL = `/api/risk/drivers?range=${COACHING_WINDOW_DAYS}d`;

type QueueRow = DriverSnapshot & { windowEvents: number };
export type InterventionMode = 'coaching' | 'training';

const RETRAINING_INFO =
  'Retraining is Driver Score −2 to −5.9 (Needs coaching) after a written warning has already been issued. Same formula as Drivers: penalty ÷ (km ÷ 100).';

function asSnap(d: AssessedDriver): DriverSnapshot {
  return {
    key: d.key,
    name: d.name,
    phone: d.phone,
    regNo: d.regNo,
    assetName: d.assetName,
    distanceKm: d.distanceKm,
    events: d.events,
    consequence: d.consequence,
  };
}

function fmtKm(km: number) {
  if (!(km > 0)) return '0 km';
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}

function eventsPer100(eventCount: number, km: number) {
  const blocks = Math.max(km / 100, 1);
  const rate = eventCount / blocks;
  if (rate === 0) return '0';
  return rate < 10 ? rate.toFixed(1) : `${Math.round(rate)}`;
}

function CoachingActions({ driver, onSaved }: { driver: QueueRow; onSaved: () => void }) {
  const { user } = useAuth();
  const [comment, setComment] = useState('');
  const [mode, setMode] = useState<'note' | 'warning'>('note');
  const [tagged, setTagged] = useState<string[]>([]);
  const [users, setUsers] = useState<TaggingUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTaggingUsers()
      .then(rows => { if (!cancelled) setUsers(rows.filter(u => u.id !== user?.id)); })
      .catch(() => { /* offline / unauthenticated */ });
    return () => { cancelled = true; };
  }, [user?.id]);

  const toggleTag = (id: string) => {
    setTagged(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const saveNote = () => {
    if (!comment.trim()) return;
    addCoachingNote(driver.key, driver.name, comment.trim(), user?.name || 'You', { kind: 'note' });
    setComment('');
    setStatus('Note saved.');
    onSaved();
  };

  const issueWarning = async () => {
    if (!comment.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const { warning } = await issueWrittenWarning({
        driverKey: driver.key,
        driverName: driver.name,
        comment: comment.trim(),
        disciplineBand: driver.consequence.category,
        taggedUserIds: tagged,
      });
      addCoachingNote(driver.key, driver.name, comment.trim(), user?.name || 'You', {
        kind: 'written_warning',
        taggedUserIds: tagged,
        warningId: warning.id,
      });
      const store = loadConsequenceOccurrences();
      logConsequenceResponse(store, driver.key, driver.consequence.category);
      addResponseLogEntry(driver.key, driver.name, driver.consequence.category, driver.consequence.occurrenceIndex, `[Written warning] ${comment.trim()}`, user?.name || 'You');
      setComment('');
      setTagged([]);
      const emailed = warning.emailResults?.filter(r => r.sent).length ?? 0;
      setStatus(`Written warning logged.${emailed ? ` ${emailed} email${emailed === 1 ? '' : 's'} sent.` : ''}`);
      onSaved();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not issue warning');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div className="dm-range" style={{ marginBottom: 8 }}>
        <button type="button" className={mode === 'note' ? 'is-on' : undefined} onClick={() => setMode('note')}>
          Internal note
        </button>
        <button type="button" className={mode === 'warning' ? 'is-on' : undefined} onClick={() => setMode('warning')}>
          Written warning
        </button>
      </div>
      {mode === 'warning' && (
        <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginBottom: 8, lineHeight: 1.45 }}>
          Formal Consequence/Fatigue Management step for drivers in the <strong>{driver.consequence.categoryLabel}</strong> band.
          {categoryPlainDescription(driver.consequence.category as ConsequenceCategory)}
          {' '}Tag supervisors to email and notify them on their dashboard.
        </div>
      )}
      <textarea
        data-driver-key={driver.key}
        data-driver-name={driver.name}
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder={mode === 'warning' ? 'Warning details — what happened and what the driver must improve…' : 'Internal coaching note…'}
        rows={3}
        style={{
          width: '100%', padding: '8px 12px', border: '1px solid var(--cd-border)', borderRadius: 8,
          fontSize: 13, background: 'var(--cd-surface)', color: 'var(--cd-text)', outline: 'none',
          resize: 'vertical', marginBottom: 8,
        }}
      />
      {mode === 'warning' && users.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Notify team members
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {users.map(u => {
              const on = tagged.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleTag(u.id)}
                  style={{
                    padding: '4px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--bpl-blue)' : 'var(--cd-border)'}`,
                    background: on ? 'rgba(0,120,212,0.12)' : 'var(--cd-surface)',
                    color: on ? 'var(--bpl-blue)' : 'var(--cd-text-muted)',
                  }}
                >
                  {u.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={mode === 'warning' ? issueWarning : saveNote}
          disabled={busy || !comment.trim() || (mode === 'warning' && tagged.length === 0)}
          style={{
            padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            border: '1px solid var(--bpl-blue)', background: 'var(--bpl-blue)', color: '#fff',
            cursor: (busy || !comment.trim() || (mode === 'warning' && tagged.length === 0)) ? 'not-allowed' : 'pointer',
            opacity: (busy || !comment.trim() || (mode === 'warning' && tagged.length === 0)) ? 0.6 : 1,
          }}
        >
          {busy ? 'Sending…' : mode === 'warning' ? 'Issue written warning' : 'Save note'}
        </button>
        {mode === 'warning' && tagged.length === 0 && (
          <span style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>Select at least one person to notify</span>
        )}
      </div>
      {status && <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 8 }}>{status}</div>}
    </div>
  );
}

function DriverRow({
  driver,
  expanded,
  onToggle,
  onChanged,
  queue,
  actionLabel,
}: {
  driver: QueueRow;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
  queue: 'coaching' | 'training';
  actionLabel: string;
}) {
  const { consequence } = driver;
  const color = consequence.categoryColor;
  const notes = getNotesForDriver(driver.key);
  const noKm = !(driver.distanceKm > 0);

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
        <div style={{ textAlign: 'center', minWidth: 70 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: 'var(--cd-font-display)' }}>{consequence.displayScore}</div>
          <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>score</div>
        </div>
        <div style={{ textAlign: 'center', minWidth: 70 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>{driver.windowEvents}</div>
          <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>events / {COACHING_WINDOW_DAYS}d</div>
        </div>
        <div style={{ textAlign: 'center', minWidth: 72 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
            {eventsPer100(driver.windowEvents, driver.distanceKm)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>/100 km</div>
        </div>
        <div style={{ textAlign: 'center', minWidth: 80 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: noKm ? 'var(--cd-text-muted)' : 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
            {fmtKm(driver.distanceKm)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>{noKm ? 'no km yet' : 'distance'}</div>
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
          <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 10 }}>
            {actionLabel}
            {noKm && ' · No trip kilometres on file — rate uses a 100 km floor so one event cannot collapse the score to 0.'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Notes
            </div>
            <button
              onClick={() => { dismissFromQueue(queue, driver.key); onChanged(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6,
                fontSize: 11, fontWeight: 600, border: '1px solid var(--cd-border)', background: 'var(--cd-surface)',
                color: 'var(--cd-text-muted)', cursor: 'pointer',
              }}
            >
              <X size={11} /> Dismiss
            </button>
          </div>

          {notes.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>No notes yet.</div>
          ) : notes.map(n => (
            <div key={n.id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--cd-border)' }}>
              {n.kind === 'written_warning' && (
                <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', marginRight: 6 }}>WRITTEN WARNING</span>
              )}
              <div style={{ color: 'var(--cd-text)' }}>{n.comment}</div>
              <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 2 }}>
                {n.addedBy} · {new Date(n.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
          {(() => {
            const responseLog = getResponseLogForDriver(driver.key);
            if (responseLog.length === 0) return null;
            return (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  Response history
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {responseLog.slice(0, 5).map(entry => (
                    <div key={entry.id} style={{ padding: '8px 10px', background: 'var(--cd-surface)', borderRadius: 8, border: '1px solid var(--cd-border)' }}>
                      <div style={{ fontSize: 12, color: 'var(--cd-text)' }}>{entry.note}</div>
                      <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 4 }}>
                        {entry.loggedBy} · {entry.category} occurrence {entry.occurrenceIndex} · {new Date(entry.loggedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          <CoachingActions driver={driver} onSaved={onChanged} />
        </div>
      )}
    </div>
  );
}

function TrainingRow({ driver, expanded, onToggle, onChanged }: {
  driver: QueueRow; expanded: boolean; onToggle: () => void; onChanged: () => void;
}) {
  const { consequence } = driver;
  const color = consequence.categoryColor;
  const notes = getNotesForDriver(driver.key);
  const action = recommendedConsequence(consequence.category, consequence.occurrenceIndex);

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
        <div style={{ textAlign: 'center', minWidth: 88 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: 'var(--cd-font-display)' }}>
            {consequence.driverScore.toFixed(1)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>per 100 km</div>
        </div>
        <div style={{ textAlign: 'center', minWidth: 70 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>{consequence.counts.eventCount}</div>
          <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>events</div>
        </div>
        <div style={{ textAlign: 'center', minWidth: 80 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>{fmtKm(driver.distanceKm)}</div>
          <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>distance</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ padding: '3px 8px', borderRadius: 9999, fontSize: 10, fontWeight: 700, background: `${color}15`, color }}>
            {consequence.categoryLabel} · {consequence.occurrenceIndex === 1 ? '1st' : '2nd'}
          </span>
          {expanded ? <ChevronUp size={16} color="var(--cd-text-muted)" /> : <ChevronDown size={16} color="var(--cd-text-muted)" />}
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--cd-border)', background: 'var(--cd-surface-2)', padding: '14px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Prior notes / warnings
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
                  {n.kind === 'written_warning' && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', marginRight: 6 }}>WRITTEN WARNING</span>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--cd-text)' }}>{n.comment}</div>
                  <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 4 }}>
                    {n.addedBy} · {new Date(n.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {(() => {
            const responseLog = getResponseLogForDriver(driver.key);
            if (responseLog.length === 0) return null;
            return (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  Response history
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {responseLog.slice(0, 5).map(entry => (
                    <div key={entry.id} style={{ padding: '8px 10px', background: 'var(--cd-surface)', borderRadius: 8, border: '1px solid var(--cd-border)' }}>
                      <div style={{ fontSize: 12, color: 'var(--cd-text)' }}>{entry.note}</div>
                      <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 4 }}>
                        {entry.loggedBy} · {entry.category} occurrence {entry.occurrenceIndex} · {new Date(entry.loggedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 8,
            background: `${color}10`, border: `1px solid ${color}25`, fontSize: 12, color: 'var(--cd-text)',
          }}>
            Driver Score {consequence.driverScore.toFixed(1)} (penalty {consequence.penaltyPoints} ÷ {Math.max(driver.distanceKm / 100, 1).toFixed(2)} blocks of 100 km).
            Band {consequence.categoryLabel} (−2 to −5.9). {consequence.occurrenceIndex === 1 ? '1st' : '2nd'} occurrence → <strong>{action}</strong>.
          </div>
        </div>
      )}
    </div>
  );
}

function QueueList({
  rows,
  empty,
  queue,
  actionLabel,
  expanded,
  toggle,
  onChanged,
  search,
}: {
  rows: QueueRow[];
  empty: string;
  queue: 'coaching' | 'training';
  actionLabel: string;
  expanded: Set<string>;
  toggle: (key: string) => void;
  onChanged: () => void;
  search: string;
}) {
  const pagination = useClientPagination(rows, 25, search);
  if (rows.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--cd-text-muted)' }}>
        {empty}
      </div>
    );
  }
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {pagination.pageRows.map(d => (
          <DriverRow
            key={d.key}
            driver={d}
            expanded={expanded.has(d.key)}
            onToggle={() => toggle(d.key)}
            onChanged={onChanged}
            queue={queue}
            actionLabel={actionLabel}
          />
        ))}
      </div>
      {rows.length > 25 && (
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
    </>
  );
}

export function InterventionQueuePage({ mode }: { mode: InterventionMode }) {
  const { tripDrivers, loading: tripLoading } = useAssessmentTripDrivers();
  const { vehicles, selectedSites } = useFleet();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const openKey = searchParams.get('open');
    return openKey ? new Set([openKey]) : new Set();
  });
  const [refreshTick, setRefreshTick] = useState(0);
  const deepLinkConsumed = useRef(false);
  const debouncedSearch = useDebouncedValue(search, 200);
  const deferredSearch = useDeferredValue(debouncedSearch);

  const [riskRows, setRiskRows] = useState(() =>
    cachePeek<{ drivers?: Parameters<typeof assessDriversFromRisk>[0] }>(COACHING_RISK_URL)?.drivers ?? [],
  );
  const [riskLoading, setRiskLoading] = useState(() => !cachePeek(COACHING_RISK_URL));
  const seedBusy = riskLoading || tripLoading;
  const siteFiltered = selectedSites.length > 0;

  const scopedTrips = useMemo(
    () => (siteFiltered ? filterTripDriversByVehicles(tripDrivers, vehicles) : tripDrivers),
    [tripDrivers, siteFiltered, vehicles],
  );

  const scopedRiskRows = useMemo(
    () => (siteFiltered ? filterRiskDriversByVehicles(riskRows, scopedTrips, vehicles) : riskRows),
    [riskRows, scopedTrips, vehicles, siteFiltered],
  );

  useEffect(() => {
    let cancelled = false;
    const cached = cachePeek<{ drivers?: Parameters<typeof assessDriversFromRisk>[0] }>(COACHING_RISK_URL);
    if (cached?.drivers) {
      setRiskRows(cached.drivers);
      setRiskLoading(false);
    } else {
      setRiskLoading(true);
    }
    authCachedJson<{ drivers?: Parameters<typeof assessDriversFromRisk>[0] }>(COACHING_RISK_URL, authFetch, {
      ttlMs: CACHE_TTL.riskDrivers,
    })
      .then(data => {
        if (cancelled || !data?.drivers) return;
        setRiskRows(data.drivers);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRiskLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (deepLinkConsumed.current) return;
    if (searchParams.has('q') || searchParams.has('open')) {
      deepLinkConsumed.current = true;
      setSearchParams({}, { replace: true });
      const openKey = searchParams.get('open');
      if (openKey) {
        setTimeout(() => {
          const el = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[data-driver-key]'))
            .find(textarea => textarea.dataset.driverKey === openKey || textarea.dataset.driverName === openKey);
          if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
        }, 300);
      }
    }
  }, [searchParams, setSearchParams]);

  const assessed = useMemo(
    () => assessDriversFromRisk(scopedRiskRows, scopedTrips).map(asSnap),
    [scopedRiskRows, scopedTrips],
  );

  const coaching = useMemo(() => {
    const coachingRows: QueueRow[] = [];
    assessed.forEach(d => {
      const windowEvents = d.consequence.counts.eventCount;
      if (qualifyCoaching(d, windowEvents) && !isDismissed('coaching', d)) {
        coachingRows.push({ ...d, windowEvents });
      }
    });
    return coachingRows.sort((a, b) => a.consequence.displayScore - b.consequence.displayScore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessed, refreshTick]);

  const training = useMemo(() => {
    const store = loadConsequenceOccurrences();
    const list: QueueRow[] = [];
    assessed.forEach(d => {
      const occ = Math.max(
        nextOccurrenceIndex(store, d.key, d.consequence.category),
        getNotesForDriver(d.key).some(n => n.kind === 'written_warning') ? 2 : 1,
      );
      const withOcc: QueueRow = {
        ...d,
        windowEvents: d.consequence.counts.eventCount,
        consequence: { ...d.consequence, occurrenceIndex: occ, recommendedConsequence: recommendedConsequence(d.consequence.category, occ) },
      };
      if (qualifyTraining(withOcc, occ) && !isDismissed('training', withOcc)) list.push(withOcc);
    });
    return list.sort((a, b) => a.consequence.driverScore - b.consequence.driverScore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessed, refreshTick]);

  const coachingVisible = deferredSearch
    ? coaching.filter(d => d.name.toLowerCase().includes(deferredSearch.toLowerCase()) || d.regNo.toLowerCase().includes(deferredSearch.toLowerCase()))
    : coaching;

  const trainingVisible = deferredSearch
    ? training.filter(d => d.name.toLowerCase().includes(deferredSearch.toLowerCase()) || d.regNo.toLowerCase().includes(deferredSearch.toLowerCase()))
    : training;

  const trainingPagination = useClientPagination(trainingVisible, 25, deferredSearch);

  const toggle = (key: string) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });
  const bump = () => setRefreshTick(t => t + 1);

  return (
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">{mode === 'coaching' ? 'Coaching' : 'Training'} <MockNamesBadge /></h1>
        <p className="bpl-page-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {mode === 'coaching'
            ? `Score ≤ ${COACHING_SCORE_THRESHOLD} or ${COACHING_EVENT_COUNT}+ scored events in the last ${COACHING_WINDOW_DAYS} days`
            : (
              <>
                Mandatory retraining
                <InfoTip text={RETRAINING_INFO} label="Retraining rule" />
              </>
            )}
        </p>
      </div>

      {mode === 'coaching' ? (
        <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 20 }}>
          <div className="bpl-kpi-card">
            <div className="bpl-kpi-label">In coaching queue</div>
            <div className="bpl-kpi-value">{seedBusy ? <SkelValue wide /> : coaching.length}</div>
          </div>
          <div className="bpl-kpi-card" style={{ borderTop: '3px solid #CC0000' }}>
            <div className="bpl-kpi-label">Red tier</div>
            <div className="bpl-kpi-value" style={{ color: '#CC0000' }}>
              {seedBusy ? <SkelValue /> : coaching.filter(d => d.consequence.category === 'Red').length}
            </div>
          </div>
        </div>
      ) : (
        <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 20 }}>
          <div className="bpl-kpi-card">
            <div className="bpl-kpi-label" style={{ display: 'flex', alignItems: 'center' }}>
              In Training Queue
              <InfoTip text={RETRAINING_INFO} label="Retraining rule" />
            </div>
            <div className="bpl-kpi-value">{seedBusy ? <SkelValue wide /> : training.length}</div>
          </div>
          <div className="bpl-kpi-card" style={{ borderTop: '3px solid #d97706' }}>
            <div className="bpl-kpi-label">Needs Priority Review</div>
            <div className="bpl-kpi-value" style={{ color: '#d97706' }}>
              {seedBusy ? <SkelValue /> : training.filter(d => d.consequence.category !== 'Green').length}
            </div>
          </div>
        </div>
      )}

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

      {seedBusy ? (
        <div className="bpl-card" style={{ padding: 16 }}><SkelTable rows={6} /></div>
      ) : mode === 'coaching' ? (
        <QueueList
          rows={coachingVisible}
          empty="No drivers currently qualify for coaching"
          queue="coaching"
          actionLabel={`Written warning / coaching — score ≤ ${COACHING_SCORE_THRESHOLD} or ${COACHING_EVENT_COUNT}+ events in ${COACHING_WINDOW_DAYS} days.`}
          expanded={expanded}
          toggle={toggle}
          onChanged={bump}
          search={deferredSearch}
        />
      ) : trainingVisible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--cd-text-muted)' }}>
          <Award size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            No drivers due for mandatory retraining
            <InfoTip text={RETRAINING_INFO} label="Retraining rule" />
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {trainingPagination.pageRows.map(d => (
              <TrainingRow
                key={d.key}
                driver={d}
                expanded={expanded.has(d.key)}
                onToggle={() => toggle(d.key)}
                onChanged={bump}
              />
            ))}
          </div>
          {trainingVisible.length > 0 && (
            <div className="bpl-card" style={{ marginTop: 10, padding: 0 }}>
              <PageControls
                page={trainingPagination.page} pageCount={trainingPagination.pageCount}
                from={trainingPagination.from} to={trainingPagination.to} total={trainingPagination.total}
                hasPrev={trainingPagination.hasPrev} hasNext={trainingPagination.hasNext}
                onPrev={trainingPagination.prev} onNext={trainingPagination.next}
                itemLabel="drivers"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function CoachingPage() {
  return <InterventionQueuePage mode="coaching" />;
}
