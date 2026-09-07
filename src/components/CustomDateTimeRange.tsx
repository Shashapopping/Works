import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  defaultCustomDateTimeRange,
  formatPickerButtonLabel,
  parseLocalInput,
  toLocalDateTimeValue,
  toLocalDateValue,
} from '../lib/dateRange';

type Props = {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  /** Stack labels above fields (Event Explorer style). Default: inline From/To. */
  stacked?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

type Step = 'date' | 'time';
type Field = 'from' | 'to';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function buildMonthGrid(month: Date): (Date | null)[] {
  const first = startOfMonth(month);
  const startPad = first.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function DateTimePickerPopover({
  value,
  onDone,
  onCancel,
  anchorRef,
  dateOnly = false,
  maxDate = null,
}: {
  value: string;
  onDone: (next: string) => void;
  onCancel: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  dateOnly?: boolean;
  /** Inclusive max calendar day (YYYY-MM-DD or Date). */
  maxDate?: string | Date | null;
}) {
  const initial = parseLocalInput(value) || new Date();
  const [draft, setDraft] = useState(initial);
  const [step, setStep] = useState<Step>('date');
  const [viewMonth, setViewMonth] = useState(startOfMonth(initial));
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 300 });

  const maxDay = useMemo(() => {
    if (!maxDate) return null;
    if (typeof maxDate === 'string') return parseLocalInput(maxDate);
    const d = new Date(maxDate);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [maxDate]);

  useLayoutEffect(() => {
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(300, window.innerWidth - 16);
      const approxHeight = dateOnly || step === 'date' ? 380 : 360;
      let left = r.left;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, r.right - width);
      }
      if (left < 8) left = 8;
      let top = r.bottom + 6;
      if (top + approxHeight > window.innerHeight - 8 && r.top > approxHeight + 8) {
        top = Math.max(8, r.top - approxHeight - 6);
      }
      setPos({ top, left, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef, step, dateOnly]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onCancel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onCancel, anchorRef]);

  const grid = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);
  const today = new Date();
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);

  const weekday = draft.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
  const hour = draft.getHours();
  const minute = draft.getMinutes();

  function isDisabled(day: Date) {
    if (!maxDay) return false;
    const a = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const b = new Date(maxDay.getFullYear(), maxDay.getMonth(), maxDay.getDate());
    return a.getTime() > b.getTime();
  }

  function pickDay(day: Date) {
    if (isDisabled(day)) return;
    const next = new Date(draft);
    next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    setDraft(next);
    if (!dateOnly) setStep('time');
  }

  function setHour(h: number) {
    const next = new Date(draft);
    next.setHours(h);
    setDraft(next);
  }

  function setMinute(m: number) {
    const next = new Date(draft);
    next.setMinutes(m);
    setDraft(next);
  }

  function commit() {
    onDone(dateOnly ? toLocalDateValue(draft) : toLocalDateTimeValue(draft));
  }

  return createPortal(
    <div
      ref={rootRef}
      className="bpl-dt-popover bpl-dt-popover-portal"
      role="dialog"
      aria-label={dateOnly ? 'Pick date' : 'Pick date and time'}
      style={{ top: pos.top, left: pos.left, width: pos.width }}
    >
      <div className="bpl-dt-header-bar">{weekday}</div>
      <div className="bpl-dt-header-body">
        <div className="bpl-dt-date-line">
          <span className="bpl-dt-month">{MONTHS[draft.getMonth()]}</span>
          <span className="bpl-dt-day">{draft.getDate()}</span>
          <span className="bpl-dt-year">{draft.getFullYear()}</span>
        </div>
        {!dateOnly && (
          <>
            <div className="bpl-dt-time-line">
              <button
                type="button"
                className={`bpl-dt-time-part${step === 'time' ? ' active' : ''}`}
                onClick={() => setStep('time')}
              >
                {String(hour).padStart(2, '0')}
              </button>
              <span className="bpl-dt-time-colon">:</span>
              <button
                type="button"
                className="bpl-dt-time-part"
                onClick={() => setStep('time')}
              >
                {String(minute).padStart(2, '0')}
              </button>
            </div>
            <button type="button" className="bpl-dt-switch-date" onClick={() => setStep('date')}>
              Change date
            </button>
          </>
        )}
      </div>

      {dateOnly || step === 'date' ? (
        <div className="bpl-dt-calendar">
          <div className="bpl-dt-cal-nav">
            <button type="button" className="bpl-dt-nav-btn" onClick={() => setViewMonth(m => addMonths(m, -1))} aria-label="Previous month">
              <ChevronLeft size={16} />
            </button>
            <span className="bpl-dt-cal-title">
              {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
            </span>
            <button type="button" className="bpl-dt-nav-btn" onClick={() => setViewMonth(m => addMonths(m, 1))} aria-label="Next month">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="bpl-dt-dow">
            {WEEKDAYS.map(d => <span key={d}>{d}</span>)}
          </div>
          <div className="bpl-dt-days">
            {grid.map((day, i) => {
              if (!day) return <span key={`e-${i}`} className="bpl-dt-day-cell empty" />;
              const selected = sameDay(day, draft);
              const isToday = sameDay(day, today);
              const disabled = isDisabled(day);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  disabled={disabled}
                  className={`bpl-dt-day-cell${selected ? ' selected' : ''}${isToday ? ' today' : ''}${disabled ? ' disabled' : ''}`}
                  onClick={() => pickDay(day)}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bpl-dt-time-pick">
          <div className="bpl-dt-time-col">
            <div className="bpl-dt-time-col-label">Hour</div>
            <div className="bpl-dt-time-scroll">
              {hours.map(h => (
                <button
                  key={h}
                  type="button"
                  className={`bpl-dt-time-opt${h === hour ? ' selected' : ''}`}
                  onClick={() => setHour(h)}
                >
                  {String(h).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
          <div className="bpl-dt-time-col">
            <div className="bpl-dt-time-col-label">Minute</div>
            <div className="bpl-dt-time-scroll">
              {minutes.map(m => (
                <button
                  key={m}
                  type="button"
                  className={`bpl-dt-time-opt${m === minute ? ' selected' : ''}`}
                  onClick={() => setMinute(m)}
                >
                  {String(m).padStart(2, '0')}
                </button>
              ))}
              {minute % 5 !== 0 && (
                <button
                  type="button"
                  className="bpl-dt-time-opt selected"
                  onClick={() => setMinute(minute)}
                >
                  {String(minute).padStart(2, '0')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bpl-dt-footer">
        <button type="button" className="bpl-dt-done" onClick={commit}>
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}

function FieldWithPicker({
  label,
  value,
  open,
  onOpen,
  onDone,
  onCancel,
}: {
  label?: string;
  value: string;
  open: boolean;
  onOpen: () => void;
  onDone: (v: string) => void;
  onCancel: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <div style={{ flex: label ? 1 : undefined, minWidth: 0 }}>
      {label && (
        <label style={{ fontSize: 11, color: 'var(--cd-text-muted)', display: 'block', marginBottom: 3 }}>
          {label}
        </label>
      )}
      <button
        ref={btnRef}
        type="button"
        className={`bpl-dt-field${open ? ' open' : ''}`}
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {formatPickerButtonLabel(value)}
      </button>
      {open && (
        <DateTimePickerPopover
          value={value}
          anchorRef={btnRef}
          onDone={onDone}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}

/**
 * Shared Custom range control — light calendar + time lists + Done.
 * Drop-in for every page that has a Custom period filter.
 */
export default function CustomDateTimeRange({
  from,
  to,
  onFromChange,
  onToChange,
  stacked = false,
  className,
  style,
}: Props) {
  const [openField, setOpenField] = useState<Field | null>(null);

  return (
    <div
      className={`bpl-dt-range${stacked ? ' stacked' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      <div className="bpl-dt-range-fields">
        {!stacked && <span className="bpl-dt-inline-label">From</span>}
        <div className="bpl-dt-field-wrap">
          <FieldWithPicker
            label={stacked ? 'From' : undefined}
            value={from}
            open={openField === 'from'}
            onOpen={() => setOpenField(openField === 'from' ? null : 'from')}
            onDone={v => { onFromChange(v); setOpenField(null); }}
            onCancel={() => setOpenField(null)}
          />
        </div>
        {!stacked && <span className="bpl-dt-inline-label">To</span>}
        <div className="bpl-dt-field-wrap">
          <FieldWithPicker
            label={stacked ? 'To' : undefined}
            value={to}
            open={openField === 'to'}
            onOpen={() => setOpenField(openField === 'to' ? null : 'to')}
            onDone={v => { onToChange(v); setOpenField(null); }}
            onCancel={() => setOpenField(null)}
          />
        </div>
      </div>
    </div>
  );
}

/** Call when user clicks the Custom period pill so From/To aren’t empty. */
export function ensureCustomRangeDefaults(
  from: string,
  to: string,
  setFrom: (v: string) => void,
  setTo: (v: string) => void,
) {
  if (from && to) return;
  const d = defaultCustomDateTimeRange();
  if (!from) setFrom(d.from);
  if (!to) setTo(d.to);
}

/** Single-day picker: calendar + Done only (no time). Value is YYYY-MM-DD. */
export function CustomDatePicker({
  value,
  onChange,
  max,
  className,
  style,
}: {
  value: string;
  onChange: (yyyyMmDd: string) => void;
  max?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={`bpl-dt-field-wrap${className ? ` ${className}` : ''}`} style={{ flex: '0 1 auto', minWidth: 160, ...style }}>
      <button
        ref={btnRef}
        type="button"
        className={`bpl-dt-field${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {formatPickerButtonLabel(value)}
      </button>
      {open && (
        <DateTimePickerPopover
          value={value}
          dateOnly
          maxDate={max ?? null}
          anchorRef={btnRef}
          onDone={v => { onChange(v); setOpen(false); }}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  );
}
