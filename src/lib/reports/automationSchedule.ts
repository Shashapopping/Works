const TZ = 'Africa/Lagos';

export type AutomationFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';

export const NIGHT_BATCH_DELIVERY_HOUR = 6;
export const NIGHT_WINDOW_START_HOUR = 19; // 7 PM
export const NIGHT_WINDOW_END_HOUR = 6; // 6 AM delivery

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
};

function zonedParts(date: Date, timeZone = TZ): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const map = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: weekdayMap[map.weekday] ?? 0,
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  return asUTC - date.getTime();
}

function localToUtcIso(
  parts: { year: number; month: number; day: number; hour?: number; minute?: number },
  timeZone = TZ,
): string {
  const hour = parts.hour ?? 0;
  const minute = parts.minute ?? 0;
  const baseUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0, 0);
  let utcMs = baseUtcMs;
  for (let i = 0; i < 2; i++) {
    const offsetMs = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    utcMs = baseUtcMs - offsetMs;
  }
  return new Date(utcMs).toISOString();
}

/** Send hour falls in 7 PM – 5:59 AM Lagos (held for night batch on hourly cadence). */
export function isNightSendHour(sendHour: number): boolean {
  return sendHour >= NIGHT_WINDOW_START_HOUR || sendHour < NIGHT_WINDOW_END_HOUR;
}

function matchesScheduleDay(
  parts: ZonedParts,
  frequency: AutomationFrequency,
  dayOfWeek: number,
  dayOfMonth: number,
): boolean {
  if (frequency === 'daily') return true;
  if (frequency === 'weekly') return parts.weekday === dayOfWeek;
  if (frequency === 'monthly') {
    if (dayOfMonth === 0) return parts.day === lastDayOfMonth(parts.year, parts.month);
    return parts.day === dayOfMonth;
  }
  return true;
}

/** Client preview of the next scheduled send (Africa/Lagos, on the hour). */
export function computeNextSendPreview(opts: {
  frequency: AutomationFrequency;
  sendHour?: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  nightBatch?: boolean;
  from?: Date;
}): Date {
  const from = opts.from ?? new Date();
  const sendHour = opts.sendHour ?? 7;
  const dayOfWeek = opts.dayOfWeek ?? 1;
  const dayOfMonth = opts.dayOfMonth ?? 1;
  if (opts.frequency === 'hourly') {
    const useNightBatch = !!opts.nightBatch;
    for (let m = 1; m <= 25 * 60; m++) {
      const t = new Date(from.getTime() + m * 60_000);
      const p = zonedParts(t);
      if (p.minute !== 0) continue;
      if (useNightBatch && isNightSendHour(p.hour)) continue;
      return t;
    }
    return new Date(from.getTime() + 60 * 60 * 1000);
  }

  const effectiveHour = sendHour;

  for (let d = 0; d < 60; d++) {
    const probe = new Date(from.getTime() + d * 86400000);
    const parts = zonedParts(probe);
    if (!matchesScheduleDay(parts, opts.frequency, dayOfWeek, dayOfMonth)) continue;

    const candidate = new Date(
      localToUtcIso({
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: effectiveHour,
        minute: 0,
      }),
    );
    if (candidate > from) return candidate;
  }

  return new Date(from.getTime() + 86400000);
}

export function formatSendTimeLagos(date: Date, frequency: AutomationFrequency): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  };
  if (frequency !== 'hourly') {
    opts.weekday = 'short';
    opts.day = 'numeric';
    opts.month = 'short';
  } else {
    const nowParts = zonedParts(new Date());
    const sendParts = zonedParts(date);
    const sameDay = nowParts.year === sendParts.year
      && nowParts.month === sendParts.month
      && nowParts.day === sendParts.day;
    if (!sameDay) {
      opts.weekday = 'short';
      opts.day = 'numeric';
      opts.month = 'short';
    }
  }
  return new Intl.DateTimeFormat('en-GB', opts).format(date);
}

export function formatSendHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function frequencyCadenceLabel(frequency: AutomationFrequency): string {
  switch (frequency) {
    case 'hourly': return 'hourly';
    case 'daily': return 'daily';
    case 'weekly': return 'weekly';
    case 'monthly': return 'monthly';
  }
}

export function buildCadenceScheduleSummary(opts: {
  frequency: AutomationFrequency;
  sendHour?: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  nightBatch?: boolean;
  eventLabel: string;
  trackingWindowPhrase: string;
  reportTypeLabel: string;
  assetCount?: number | null;
  from?: Date;
}): string {
  const sendHour = opts.sendHour ?? 7;
  const nightBatch = opts.frequency === 'hourly' && !!opts.nightBatch;
  const next = computeNextSendPreview({
    frequency: opts.frequency,
    sendHour,
    dayOfWeek: opts.dayOfWeek,
    dayOfMonth: opts.dayOfMonth,
    nightBatch,
    from: opts.from,
  });
  const when = formatSendTimeLagos(next, opts.frequency);
  const cadence = frequencyCadenceLabel(opts.frequency);
  const countSuffix = opts.assetCount != null && opts.assetCount >= 0
    ? ` (${opts.assetCount.toLocaleString()} asset${opts.assetCount === 1 ? '' : 's'} right now, GPS-only)`
    : '';
  const nightNote = nightBatch
    ? ` Night window (${formatSendHourLabel(NIGHT_WINDOW_START_HOUR)}–${formatSendHourLabel(NIGHT_WINDOW_END_HOUR)}) held to ${formatSendHourLabel(NIGHT_BATCH_DELIVERY_HOUR)} delivery.`
    : '';

  let body: string;
  if (
    opts.eventLabel
    && opts.eventLabel !== 'All event types'
    && opts.reportTypeLabel === 'Event report'
  ) {
    const offlineNote = opts.eventLabel === 'Offline'
      ? ' Assets still offline since the last send are tagged Repeat offender.'
      : '';
    body = `${opts.eventLabel} events for ${opts.trackingWindowPhrase} will be sent ${cadence}${countSuffix}.${offlineNote}`;
  } else if (opts.reportTypeLabel === 'Event report') {
    body = `All event types for ${opts.trackingWindowPhrase} will be sent ${cadence}${countSuffix}.`;
  } else {
    body = `${opts.reportTypeLabel} for ${opts.trackingWindowPhrase} will be sent ${cadence}${countSuffix}.`;
  }

  return `${body} Next send: ${when} (Lagos).${nightNote}`;
}
