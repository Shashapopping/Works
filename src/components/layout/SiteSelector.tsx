import { useState, useRef, useEffect, useMemo } from 'react';
import { MapPin, ChevronDown, Search } from 'lucide-react';
import { useFleet } from '../../context/FleetContext';

export default function SiteSelector() {
  const { selectedSites, setSelectedSites, toggleSite, siteOptions } = useFleet();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const totalCount = useMemo(() => siteOptions.reduce((s, o) => s + o.count, 0), [siteOptions]);
  const selectedSet = useMemo(() => new Set(selectedSites), [selectedSites]);
  const isFiltered = selectedSites.length > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return siteOptions;
    return siteOptions.filter(o => o.label.toLowerCase().includes(q));
  }, [siteOptions, query]);

  const activeCount = useMemo(() => {
    if (!isFiltered) return totalCount;
    return siteOptions
      .filter(o => selectedSet.has(o.key))
      .reduce((s, o) => s + o.count, 0);
  }, [isFiltered, siteOptions, selectedSet, totalCount]);

  const activeLabel = useMemo(() => {
    if (!isFiltered) return 'All Sites';
    if (selectedSites.length === 1) {
      return siteOptions.find(o => o.key === selectedSites[0])?.label ?? selectedSites[0];
    }
    return `${selectedSites.length} sites`;
  }, [isFiltered, selectedSites, siteOptions]);

  const allChecked = !isFiltered;

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Filter the dashboard by one or more sites"
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          height: 32, padding: '0 10px', borderRadius: 8, cursor: 'pointer',
          background: isFiltered ? 'rgba(0,120,212,0.18)' : 'rgba(255,255,255,0.06)',
          border: `0.5px solid ${isFiltered ? 'rgba(0,120,212,0.5)' : 'rgba(255,255,255,0.1)'}`,
          color: isFiltered ? '#4aa3e8' : 'rgba(255,255,255,0.7)',
          maxWidth: 260,
        }}
      >
        <MapPin size={14} style={{ flexShrink: 0 }} />
        <span style={{
          fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {activeLabel}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, borderRadius: 99, padding: '1px 6px', flexShrink: 0,
          background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.55)',
        }}>
          {activeCount}
        </span>
        <ChevronDown size={13} style={{
          flexShrink: 0, opacity: 0.6,
          transition: 'transform 0.2s ease', transform: open ? 'rotate(180deg)' : 'none',
        }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 40, left: 0, width: 300,
          background: '#0e1e2e', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          zIndex: 200, overflow: 'hidden',
        }}>
          <div style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <Search size={13} style={{ position: 'absolute', left: 9, color: 'rgba(255,255,255,0.35)' }} />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search sites…"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '7px 10px 7px 28px', fontSize: 12.5,
                  background: 'rgba(255,255,255,0.05)',
                  border: '0.5px solid rgba(255,255,255,0.12)',
                  borderRadius: 8, color: '#fff', outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                {isFiltered ? `${selectedSites.length} selected` : 'Showing all sites'}
              </span>
              {isFiltered && (
                <button
                  type="button"
                  onClick={() => setSelectedSites([])}
                  style={{
                    fontSize: 11, fontWeight: 600, color: '#4aa3e8',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div style={{ maxHeight: 340, overflowY: 'auto', padding: 6 }}>
            <SiteCheckRow
              label="All Sites"
              count={totalCount}
              checked={allChecked}
              onClick={() => setSelectedSites([])}
            />
            <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '6px 4px' }} />
            {filtered.length === 0 ? (
              <div style={{ padding: '16px 10px', textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
                No sites match “{query}”
              </div>
            ) : filtered.map(o => (
              <SiteCheckRow
                key={o.key}
                label={o.label}
                count={o.count}
                checked={selectedSet.has(o.key)}
                onClick={() => toggleSite(o.key)}
              />
            ))}
          </div>

          {isFiltered && (
            <div style={{
              padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.08)',
              fontSize: 11, color: 'rgba(255,255,255,0.4)',
            }}>
              Tick multiple sites — dashboard shows the combined fleet
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SiteCheckRow({ label, count, checked, onClick }: {
  label: string; count: number; checked: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '8px 10px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
        background: checked ? 'rgba(0,120,212,0.18)' : 'transparent',
        border: 'none', transition: 'background 0.12s',
      }}
      onMouseEnter={e => { if (!checked) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
      onMouseLeave={e => { if (!checked) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <span
        aria-hidden
        style={{
          width: 16, height: 16, borderRadius: 4, flexShrink: 0,
          border: checked ? '1.5px solid #4aa3e8' : '1.5px solid rgba(255,255,255,0.3)',
          background: checked ? '#0078D4' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {checked && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 5.2L4.2 7.4L8 2.8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span style={{
        flex: 1, minWidth: 0, fontSize: 12.5,
        fontWeight: checked ? 600 : 500,
        color: checked ? '#fff' : 'rgba(255,255,255,0.7)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 10, fontWeight: 700, borderRadius: 99, padding: '1px 7px', flexShrink: 0,
        background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)',
      }}>
        {count}
      </span>
    </button>
  );
}
