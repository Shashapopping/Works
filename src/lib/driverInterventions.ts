/**
 * Coaching / Training queue logic + localStorage persistence for notes,
 * dismissals, and driver certificates.
 *
 * Scoring reuses the Scaffold's own consequence-management engine
 * (buildDriverConsequenceCard) so the Drivers page and these queues always
 * agree on one score. No panic, vision, or HOS/fatigue inputs are used here.
 *
 * Persistence note: this data is stored in the browser's localStorage
 * (same convention as the consequence occurrence log in consequenceScore.ts),
 * not a shared backend — it is per-browser, not per-user-account.
 */
import type { LogEntry } from '../context/FleetContext';
import { isActiveDriver, isActiveDriverId } from './driverUtils';
import { buildDriverConsequenceCard, countPenaltyEvents, type ConsequenceCard } from './consequenceScore';
import { COACHING_EVENT_COUNT, COACHING_SCORE_THRESHOLD, COACHING_WINDOW_DAYS } from '../config/interventionRules';

const HIDDEN_LABELS = ['Possible Power Tamper', 'Battery Disconnection', 'Battery Disconnected', 'Front Panel Tamper', 'Back Panel Tamper', 'No Blue Key'];

export interface DriverSnapshot {
  key: string;
  name: string;
  phone: string;
  regNo: string;
  assetName: string;
  distanceKm: number;
  events: LogEntry[];
  consequence: ConsequenceCard;
}

export function driverKey(e: { driverId?: string | null; driverName?: string | null }): string {
  return (e.driverId && isActiveDriverId(e.driverId)) ? e.driverId! : (e.driverName || '');
}

export function buildDriverSnapshots(
  events: LogEntry[],
  distanceByKey: Map<string, number>,
  windowDays: number,
): Map<string, DriverSnapshot> {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const map = new Map<string, DriverSnapshot>();

  events.forEach(e => {
    if (e.type === 'panic') return;
    const label = e.label || '';
    if (HIDDEN_LABELS.includes(label)) return;
    if (!isActiveDriver(e.driverName, e.driverId)) return;
    const ts = new Date(e.eventTime || e.timestamp).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) return;

    const key = driverKey(e);
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: e.driverName || key,
        phone: e.driverPhone || 'N/A',
        regNo: e.regNo || '—',
        assetName: e.assetName || '—',
        distanceKm: distanceByKey.get(key) || 0,
        events: [],
        consequence: null as unknown as ConsequenceCard,
      });
    }
    const snap = map.get(key)!;
    snap.events.push(e);
    if (e.regNo && e.regNo !== 'N/A') snap.regNo = e.regNo;
    if (e.assetName && e.assetName !== 'N/A') snap.assetName = e.assetName;
    if (e.driverPhone && e.driverPhone !== 'N/A') snap.phone = e.driverPhone;
  });

  for (const snap of map.values()) {
    snap.consequence = buildDriverConsequenceCard({ events: snap.events, distanceKm: snap.distanceKm });
  }

  return map;
}

/** Scored IVMS events inside the coaching lookback window. */
export function scoredEventsInWindow(events: LogEntry[], windowDays = COACHING_WINDOW_DAYS): number {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  return countPenaltyEvents(events.filter(e => {
    const ts = new Date(e.eventTime || e.timestamp).getTime();
    return Number.isFinite(ts) && ts >= cutoff;
  })).eventCount;
}

/** Coaching: score at/below threshold, OR event count at/above threshold (30-day window). */
export function qualifyCoaching(d: DriverSnapshot, windowEventCount?: number): boolean {
  const n = windowEventCount ?? scoredEventsInWindow(d.events);
  return d.consequence.displayScore <= COACHING_SCORE_THRESHOLD
    || n >= COACHING_EVENT_COUNT;
}

export function hasWrittenWarning(d: DriverSnapshot): boolean {
  return getNotesForDriver(d.key).some(n => n.kind === 'written_warning');
}

/**
 * Training = Mandatory Driver Retraining from the same consequence card
 * Drivers already uses: Amber (driverScore −2 to −5.9) + 2nd occurrence.
 */
export function qualifyTraining(d: DriverSnapshot, occurrenceIndex: number): boolean {
  if (d.consequence.category !== 'Amber') return false;
  return occurrenceIndex >= 2 || hasWrittenWarning(d);
}

// ---------------------------------------------------------------------------
// localStorage persistence — notes, dismissals, certificates
// ---------------------------------------------------------------------------

export interface CoachingNote {
  id: string;
  driverKey: string;
  driverName: string;
  comment: string;
  addedBy: string;
  createdAt: string;
  kind?: 'note' | 'written_warning';
  taggedUserIds?: string[];
  warningId?: string;
}

const NOTES_KEY = 'bpl_coaching_notes';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage unavailable — ignore */ }
}

export function getCoachingNotes(): CoachingNote[] {
  return readJson<CoachingNote[]>(NOTES_KEY, []);
}

export function getNotesForDriver(key: string): CoachingNote[] {
  return getCoachingNotes()
    .filter(n => n.driverKey === key)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addCoachingNote(
  driverKey: string,
  driverName: string,
  comment: string,
  addedBy = 'You',
  opts?: { kind?: 'note' | 'written_warning'; taggedUserIds?: string[]; warningId?: string },
): CoachingNote[] {
  const notes = getCoachingNotes();
  const next: CoachingNote = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    driverKey, driverName, comment, addedBy,
    createdAt: new Date().toISOString(),
    kind: opts?.kind || 'note',
    taggedUserIds: opts?.taggedUserIds,
    warningId: opts?.warningId,
  };
  const updated = [...notes, next];
  writeJson(NOTES_KEY, updated);
  return updated;
}

export type InterventionQueue = 'coaching' | 'training';

const DISMISSALS_KEY = 'bpl_intervention_dismissals';

type DismissalStore = Record<InterventionQueue, Record<string, string>>;

function getDismissalStore(): DismissalStore {
  return readJson<DismissalStore>(DISMISSALS_KEY, { coaching: {}, training: {} });
}

export function getDismissedCutoff(queue: InterventionQueue, key: string): string | null {
  return getDismissalStore()[queue]?.[key] ?? null;
}

export function dismissFromQueue(queue: InterventionQueue, key: string): void {
  const store = getDismissalStore();
  store[queue] = { ...store[queue], [key]: new Date().toISOString() };
  writeJson(DISMISSALS_KEY, store);
}

export function isDismissed(queue: InterventionQueue, d: DriverSnapshot): boolean {
  const cutoff = getDismissedCutoff(queue, d.key);
  if (!cutoff) return false;
  const cutoffMs = new Date(cutoff).getTime();
  const latestEventMs = Math.max(0, ...d.events.map(e => new Date(e.eventTime || e.timestamp).getTime()));
  // Once a newer qualifying event occurs after the dismissal, the driver resurfaces.
  return latestEventMs <= cutoffMs;
}

// ---------------------------------------------------------------------------
// Driver certificates — manual record tracker (no MiX license/cert data exists)
// ---------------------------------------------------------------------------

export interface DriverCertificate {
  id: string;
  driverKey: string;
  driverName: string;
  certType: string;
  certNumber: string;
  issueDate: string;
  expiryDate: string;
  notes?: string;
}

const CERTIFICATES_KEY = 'bpl_driver_certificates';

export function getCertificates(): DriverCertificate[] {
  return readJson<DriverCertificate[]>(CERTIFICATES_KEY, []);
}

export function upsertCertificate(cert: Omit<DriverCertificate, 'id'> & { id?: string }): DriverCertificate[] {
  const certs = getCertificates();
  const id = cert.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const idx = certs.findIndex(c => c.id === id);
  const record: DriverCertificate = { ...cert, id };
  const updated = idx >= 0 ? certs.map(c => (c.id === id ? record : c)) : [...certs, record];
  writeJson(CERTIFICATES_KEY, updated);
  return updated;
}

export function deleteCertificate(id: string): DriverCertificate[] {
  const updated = getCertificates().filter(c => c.id !== id);
  writeJson(CERTIFICATES_KEY, updated);
  return updated;
}

export type CertificateStatus = 'Valid' | 'Expiring Soon' | 'Expired' | 'No Date';

export function certificateStatus(expiryDate: string): { status: CertificateStatus; color: string; daysLeft: number | null } {
  if (!expiryDate) return { status: 'No Date', color: '#94a3b8', daysLeft: null };
  const days = Math.round((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (!Number.isFinite(days)) return { status: 'No Date', color: '#94a3b8', daysLeft: null };
  if (days < 0) return { status: 'Expired', color: '#CC0000', daysLeft: days };
  if (days <= 30) return { status: 'Expiring Soon', color: '#d97706', daysLeft: days };
  return { status: 'Valid', color: '#16a34a', daysLeft: days };
}
