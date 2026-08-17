/** Shared helpers for Custom From/To filters (date-only or datetime-local). */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/**
 * Preset period keys used across pages / PeriodSelect / API `range`.
 * Calendar (local) days including today — MiX report style — not rolling hours.
 */
export type CalendarPeriodPreset =
  | 'today'
  | 'day'
  | '7days'
  | '7d'
  | 'week'
  | '30days'
  | '30d'
  | 'month';

/**
 * Local calendar bounds for a preset window.
 * 7 days = start of (today − 6) → now; 30 days = start of (today − 29) → now.
 */
export function calendarPeriodBounds(
  period: CalendarPeriodPreset | string,
  now = new Date(),
): { from: Date; to: Date; fromMs: number; toMs: number; fromIso: string; toIso: string } {
  // End-of-local-day keeps client cache keys stable within a calendar day.
  // Server still resolves "through now" when using range= tokens; EOD ⊇ now for ISO URLs.
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const p = String(period || '').toLowerCase();
  if (p === 'today' || p === 'day') {
    /* start already today midnight */
  } else if (p === '7days' || p === '7d' || p === 'week') {
    start.setDate(start.getDate() - 6);
  } else if (p === '30days' || p === '30d' || p === 'month') {
    start.setDate(start.getDate() - 29);
  } else {
    start.setDate(start.getDate() - 6);
  }

  return {
    from: start,
    to: end,
    fromMs: start.getTime(),
    toMs: end.getTime(),
    fromIso: start.toISOString(),
    toIso: end.toISOString(),
  };
}

/** Stable API range token for presets (Fuel/Trips style). Null = custom/unknown. */
export function periodRangeToken(dateRange: string): string | null {
  const p = String(dateRange || '').toLowerCase();
  if (p === 'today' || p === 'day') return 'today';
  if (p === '7days' || p === '7d' || p === 'week') return '7d';
  if (p === '30days' || p === '30d' || p === 'month') return '30d';
  if (p === 'alltime' || p === 'all') return 'all';
  return null;
}

/** Shared From/To for page chips: calendar presets, custom ISO, or null = all-time. */
export function presetDateBounds(
  dateRange: string,
  fromDate = '',
  toDate = '',
): { from: string | null; to: string | null } {
  if (dateRange === 'custom' && fromDate && toDate) {
    return customRangeToIsoBounds(fromDate, toDate) ?? { from: null, to: null };
  }
  if (dateRange === 'alltime' || dateRange === 'all') {
    return { from: null, to: null };
  }
  if (
    dateRange === 'today' || dateRange === 'day'
    || dateRange === '7days' || dateRange === '7d' || dateRange === 'week'
    || dateRange === '30days' || dateRange === '30d' || dateRange === 'month'
  ) {
    const b = calendarPeriodBounds(dateRange);
    return { from: b.fromIso, to: b.toIso };
  }
  return { from: null, to: null };
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Value for datetime-local / picker. */
export function toLocalDateTimeValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Start of local calendar day → datetime value. */
export function localDayStartValue(d = new Date()): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return toLocalDateTimeValue(x);
}

/** End of local calendar day (23:59) → datetime value. */
export function localDayEndValue(d = new Date()): string {
  const x = new Date(d);
  x.setHours(23, 59, 0, 0);
  return toLocalDateTimeValue(x);
}

/** Sensible defaults when user switches to Custom. */
export function defaultCustomDateTimeRange(now = new Date()): { from: string; to: string } {
  return { from: localDayStartValue(now), to: toLocalDateTimeValue(now) };
}

export function parseLocalInput(value: string): Date | null {
  if (!value) return null;
  const dateOnly = DATE_ONLY.exec(value.trim());
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 0, 0, 0, 0);
  }
  const dt = LOCAL_DT.exec(value.trim());
  if (dt) {
    return new Date(
      Number(dt[1]),
      Number(dt[2]) - 1,
      Number(dt[3]),
      Number(dt[4]),
      Number(dt[5]),
      0,
      0,
    );
  }
  const t = new Date(value);
  return Number.isFinite(t.getTime()) ? t : null;
}

export type CustomBoundOptions = {
  endMode?: 'inclusive-minute' | 'exclusive-next-day' | 'exact';
};

/**
 * Convert Custom From/To inputs into ISO bounds for APIs / filters.
 * Date-only `to` stays inclusive of that calendar day.
 * Datetime `to` is inclusive through that minute.
 */
export function customRangeToIsoBounds(
  fromValue: string,
  toValue: string,
  opts: CustomBoundOptions = {},
): { from: string; to: string } | null {
  const start = parseLocalInput(fromValue);
  const endRaw = parseLocalInput(toValue);
  if (!start || !endRaw) return null;

  const toIsDateOnly = DATE_ONLY.test(toValue.trim());
  let end = new Date(endRaw.getTime());
  const mode = opts.endMode
    ?? (toIsDateOnly ? 'exclusive-next-day' : 'inclusive-minute');

  if (mode === 'exclusive-next-day') {
    end = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, 0, 0, 0, 0);
  } else if (mode === 'inclusive-minute') {
    end.setSeconds(59, 999);
  }

  if (!(end > start)) return null;
  return { from: start.toISOString(), to: end.toISOString() };
}

export function customRangeToQueryParams(fromValue: string, toValue: string): { from: string; to: string } | null {
  return customRangeToIsoBounds(fromValue, toValue);
}

export function formatCustomRangeLabel(fromValue: string, toValue: string): string {
  if (!fromValue || !toValue) return 'Custom';
  const a = parseLocalInput(fromValue);
  const b = parseLocalInput(toValue);
  if (!a || !b) return `${fromValue} → ${toValue}`;
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  return `${a.toLocaleString([], opts)} → ${b.toLocaleString([], opts)}`;
}

/** YYYY-MM-DD for date-only pickers. */
export function toLocalDateValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatPickerButtonLabel(value: string): string {
  const d = parseLocalInput(value);
  if (!d) return value || 'Select…';
  const dateOnly = DATE_ONLY.test(value.trim());
  if (dateOnly) {
    return d.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
