import {
  buildDriverConsequenceCard,
  isScoredViolationLabel,
  loadConsequenceConfig,
} from '../consequenceScore';
import { displayDriverName, isActiveDriver, isActiveDriverId } from '../driverUtils';
import type { LogEntry } from '../reportExport';
import type { TabularReport } from '../reportTypes';
import {
  matchesDriverScorecardSearch,
  transporterByReg,
  type ReportVehicleRef,
} from './reportSearch';

export interface DistanceDriverRow {
  driverId?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  totalDistanceKm?: number;
  journeyCount?: number;
  totalDrivingTimeSeconds?: number;
  vehicles?: string[];
}

function hoursLabel(seconds: number) {
  if (!seconds || seconds <= 0) return '0';
  return (seconds / 3600).toFixed(1);
}

export function buildDriverScorecardReport(opts: {
  events: LogEntry[];
  drivers: DistanceDriverRow[];
  reportTitle: string;
  meta: string;
  search?: string;
  vehicles?: ReportVehicleRef[];
}): TabularReport {
  const { events, drivers, reportTitle, meta, search = '', vehicles = [] } = opts;
  const config = loadConsequenceConfig();
  const transporterLookup = transporterByReg(vehicles);

  const distanceByKey = new Map<string, number>();
  const drivingByKey = new Map<string, number>();
  const journeysByKey = new Map<string, number>();
  const phoneByKey = new Map<string, string>();
  const regByKey = new Map<string, string>();
  const transporterByKey = new Map<string, string>();
  const nameByKey = new Map<string, string>();

  for (const d of drivers) {
    if (!isActiveDriver(d.driverName, d.driverId)) continue;
    const key = (d.driverId && isActiveDriverId(d.driverId)) ? d.driverId : (d.driverName || '');
    if (!key) continue;
    distanceByKey.set(key, (distanceByKey.get(key) || 0) + (d.totalDistanceKm || 0));
    drivingByKey.set(key, (drivingByKey.get(key) || 0) + (d.totalDrivingTimeSeconds || 0));
    journeysByKey.set(key, (journeysByKey.get(key) || 0) + (d.journeyCount || 0));
    if (d.driverPhone) phoneByKey.set(key, d.driverPhone);
    if (d.driverName) nameByKey.set(key, d.driverName);
    const reg = d.vehicles?.[0];
    if (reg) {
      regByKey.set(key, reg);
      const t = transporterLookup.get(reg.trim().toLowerCase());
      if (t) transporterByKey.set(key, t);
    }
  }

  const eventsByKey = new Map<string, LogEntry[]>();
  for (const e of events) {
    if (e.type === 'panic') continue;
    if (!isScoredViolationLabel(e.label)) continue;
    if (!isActiveDriver(e.driverName, e.driverId)) continue;
    const key = (e.driverId && isActiveDriverId(e.driverId)) ? e.driverId : (e.driverName || '');
    if (!key) continue;
    if (!eventsByKey.has(key)) eventsByKey.set(key, []);
    eventsByKey.get(key)!.push(e);
    if (e.driverName) nameByKey.set(key, e.driverName);
    if (e.driverPhone) phoneByKey.set(key, e.driverPhone);
    if (e.regNo && e.regNo !== 'N/A') {
      regByKey.set(key, e.regNo);
      const t = transporterLookup.get(e.regNo.trim().toLowerCase());
      if (t) transporterByKey.set(key, t);
    }
  }

  const keys = new Set([...distanceByKey.keys(), ...eventsByKey.keys()]);
  const columns = [
    { header: 'Driver', width: 22 },
    { header: 'Phone', textForce: true, width: 16 },
    { header: 'Reg No', textForce: true, width: 14 },
    { header: 'Display score', width: 12 },
    { header: 'Category', width: 10 },
    { header: 'Penalty points', width: 12 },
    { header: 'Distance km', width: 12 },
    { header: 'Score / 100 km', width: 12 },
    { header: 'Harsh braking', width: 12 },
    { header: 'Harsh accel', width: 12 },
    { header: 'Overspeed', width: 10 },
    { header: 'Cornering', width: 10 },
    { header: 'Journeys', width: 10 },
    { header: 'Drive hours', width: 10 },
    { header: 'Recommended consequence', width: 40 },
  ];

  const rows: string[][] = [];
  for (const key of keys) {
    const name = nameByKey.get(key) || key;
    const phone = phoneByKey.get(key) || 'N/A';
    const transporter = transporterByKey.get(key) || '';
    const reg = regByKey.get(key) || 'N/A';
    if (!matchesDriverScorecardSearch(name, phone, transporter, search)) continue;
    const distanceKm = distanceByKey.get(key) || 0;
    const driverEvents = eventsByKey.get(key) || [];
    if (distanceKm <= 0 && driverEvents.length === 0) continue;

    const card = buildDriverConsequenceCard({
      events: driverEvents,
      distanceKm,
      config,
    });

    rows.push([
      displayDriverName(name, 'N/A'),
      phone,
      reg,
      String(card.displayScore),
      card.category,
      String(card.penaltyPoints),
      String(Math.round(distanceKm)),
      card.driverScore.toFixed(1),
      String(card.counts.harshBraking),
      String(card.counts.harshAccel),
      String(card.counts.overspeeding),
      String(card.counts.cornering),
      String(journeysByKey.get(key) || 0),
      hoursLabel(drivingByKey.get(key) || 0),
      card.recommendedConsequence,
    ]);
  }

  rows.sort((a, b) => Number(a[3]) - Number(b[3]));

  return {
    reportType: 'driver_scorecard',
    title: reportTitle,
    meta,
    columns,
    rows,
    rowCount: rows.length,
    archiveType: 'DriverScorecard',
  };
}
