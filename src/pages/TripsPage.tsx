import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import FeatureGate from '../components/FeatureGate';
import TablePaginationBar from '../components/TablePaginationBar';
import { useFleet } from '../context/FleetContext';
import { useClientPagination } from '../hooks/useClientPagination';

type TripTab = 'all' | 'ongoing' | 'completed';

const TAB_LABELS: Record<TripTab, string> = {
  all: 'All',
  ongoing: 'Ongoing',
  completed: 'Completed',
};

const TRIPS_PAGE_SIZE = 50;

const STATUS_STYLE = {
  'On Time': { bg: 'rgba(22,163,74,0.12)', color: '#16a34a' },
  Delayed: { bg: 'rgba(217,119,6,0.12)', color: '#d97706' },
  Completed: { bg: 'rgba(100,116,139,0.12)', color: '#64748b' },
};

export default function TripsPage() {
  const { trips } = useFleet();
  const [tab, setTab] = useState<TripTab>('ongoing');

  const filtered = useMemo(() => {
    if (tab === 'all') return trips;
    if (tab === 'ongoing') return trips.filter(t => t.status !== 'Completed');
    return trips.filter(t => t.status === 'Completed');
  }, [trips, tab]);

  const pagination = useClientPagination(filtered, TRIPS_PAGE_SIZE, tab);

  return (
    <FeatureGate featureId="dispatch">
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">Journey Management</h1>
        <p className="bpl-page-subtitle">Ongoing and completed journeys across the fleet</p>
      </div>

      <div className="bpl-card">
        <div className="bpl-card-header bpl-trips-header">
          <div className="bpl-trips-tabs" role="tablist" aria-label="Trip filter">
            {(Object.keys(TAB_LABELS) as TripTab[]).map(key => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`bpl-trips-tab${tab === key ? ' active' : ''}`}
                onClick={() => setTab(key)}
              >
                {TAB_LABELS[key]}
              </button>
            ))}
          </div>
          <Link to="/trips/dispatch" className="bpl-card-link">Open dispatch</Link>
        </div>
        <div className="bpl-card-body">
          {pagination.pageRows.map(trip => {
            const statusStyle = STATUS_STYLE[trip.timing];
            return (
              <div key={trip.id} className="bpl-trip-item">
                <div className="bpl-trip-top">
                  <div>
                    <div className="bpl-trip-vehicle">{trip.vehicle}</div>
                    <div className="bpl-trip-driver">{trip.driver}</div>
                  </div>
                  <span className="bpl-trip-status" style={{ background: statusStyle.bg, color: statusStyle.color }}>
                    {trip.timing}
                  </span>
                </div>
                <div className="bpl-trip-route">{trip.route}</div>
                <div className="bpl-trip-progress-wrap">
                  <div className="bpl-trip-progress-bar" style={{ width: `${trip.progress}%` }} />
                </div>
                <div className="bpl-trip-eta">ETA {trip.eta}</div>
              </div>
            );
          })}
        </div>
        <TablePaginationBar
          from={pagination.from}
          to={pagination.to}
          total={pagination.total}
          page={pagination.page}
          pageCount={pagination.pageCount}
          hasPrev={pagination.hasPrev}
          hasNext={pagination.hasNext}
          prev={pagination.prev}
          next={pagination.next}
          minTotal={0}
        />
      </div>
    </FeatureGate>
  );
}
