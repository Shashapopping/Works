import { Sparkles } from 'lucide-react';
import { dropoutHoverCopy, type ProbeDropout } from '../lib/fuelSignal';

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function FuelSparkNotes({
  events,
  selectedId,
  onSelect,
}: {
  events: ProbeDropout[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (!events.length) return null;

  return (
    <div className="hbm-fuel-spark-row" aria-label="Probe notes">
      {events.map(event => {
        const copy = dropoutHoverCopy(event);
        const active = selectedId === event.id;
        return (
          <button
            key={event.id}
            type="button"
            className={`hbm-fuel-spark${active ? ' is-active' : ''}${event.kind === 'ignition' ? ' is-ignition' : ''}`}
            title={`${copy.title} · ${copy.detail}`}
            aria-pressed={active}
            onClick={() => onSelect(active ? null : event.id)}
          >
            <Sparkles size={12} />
            <span className="hbm-fuel-spark-tip">
              <strong>{copy.title}</strong>
              <em>{fmtWhen(event.timestamp)}</em>
              <span>{copy.detail}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
