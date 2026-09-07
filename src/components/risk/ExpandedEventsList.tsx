import type { LogEntry } from '../../context/FleetContext';
import { eventLocationLabel } from '../../lib/branding';
import { displayDriverName, isKnownDriver } from '../../lib/driverUtils';
import { formatExpandEventTime, sortEventsNewestFirst } from '../../lib/riskExpandEvents';

type Props = {
  events: LogEntry[];
  loading?: boolean;
  emptyMessage?: string;
};

export default function ExpandedEventsList({ events, loading, emptyMessage = 'No events in this period.' }: Props) {
  const sorted = sortEventsNewestFirst(events);

  return (
    <div className="bpl-expand-events">
      {loading ? (
        <div className="bpl-expand-events-empty">Loading events…</div>
      ) : sorted.length === 0 ? (
        <div className="bpl-expand-events-empty">{emptyMessage}</div>
      ) : sorted.map((e, i) => {
        const label = e.label || 'Unknown';
        const loc = eventLocationLabel(e);
        const hasDriver = isKnownDriver(e.driverName);
        return (
          <div key={e.eventId || i} className="bpl-expand-events-row">
            <div className="bpl-expand-events-main">
              <div className="bpl-expand-events-top">
                <span className="bpl-expand-events-label">⚠ {label}</span>
                {hasDriver && (
                  <span className="bpl-expand-events-driver">{displayDriverName(e.driverName)}</span>
                )}
              </div>
              {loc && loc !== '—' && (
                <div className="bpl-expand-events-loc">{loc}</div>
              )}
            </div>
            <span className="bpl-expand-events-time">{formatExpandEventTime(e.eventTime || e.timestamp)}</span>
          </div>
        );
      })}
    </div>
  );
}
