import { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { CEMENT_SITE_TREE, allMatchKeys, nodeCount, nodeMatchesQuery, selectedSiteScopeLabel, type SiteTreeNode } from '../lib/cementSiteTree';
import { isDecommissionedSite, isNonOperationalPlacement } from '../lib/fleetExclusions';
import { brandLabel } from '../lib/branding';

type SiteOption = { key: string; label: string; count: number };

interface Props {
  selectedSites: string[];
  setSelectedSites: (sites: string[]) => void;
  toggleSite: (site: string) => void;
  siteOptions: SiteOption[];
  siteNameOptions: SiteOption[];
  variant?: 'header' | 'field';
  label?: string;
  /** When set, dropdown is limited to these site/transporter keys (transporter accounts). */
  allowedSiteKeys?: string[];
  /** Display name for the “all sites in scope” row (e.g. fleet name). */
  scopeLabel?: string;
}

function countForKeys(
  keys: string[],
  siteOptions: SiteOption[],
  siteNameOptions: SiteOption[],
): number {
  if (keys.length === 0) return siteOptions.reduce((s, o) => s + o.count, 0);
  const selected = new Set(keys);
  const zoneHits = siteOptions.filter(o => selected.has(o.key));
  const siteHits = siteNameOptions.filter(o => selected.has(o.key));
  // Site-name selections (transporter leaves) must use site counts — zone-only
  // path was returning 0 and blanked the badge.
  if (siteHits.length && !zoneHits.length) {
    return siteHits.reduce((s, o) => s + o.count, 0);
  }
  if (zoneHits.length && !siteHits.length) {
    return zoneHits.reduce((s, o) => s + o.count, 0);
  }
  return zoneHits.reduce((s, o) => s + o.count, 0) + siteHits.reduce((s, o) => s + o.count, 0);
}

export default function SiteScopeDropdown({
  selectedSites,
  setSelectedSites,
  toggleSite,
  siteOptions,
  siteNameOptions,
  variant = 'header',
  label,
  allowedSiteKeys,
  scopeLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const scoped = !!allowedSiteKeys?.length;
  const field = variant === 'field';

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const el = buttonRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, field ? 280 : 300), Math.min(360, window.innerWidth - 16));
      let left = r.left;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
      setMenuPos({ top: r.bottom + 6, left, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, field]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const selectedSet = useMemo(
    () => new Set(selectedSites.map(s => s.trim().toLowerCase()).filter(Boolean)),
    [selectedSites],
  );

  const scopedOptions = useMemo(() => {
    if (!scoped || !allowedSiteKeys) return [];
    const counts = new Map(siteNameOptions.map(o => [o.key, o.count]));
    // Case-insensitive match so "Joza Non operational" still finds assets
    const byLower = new Map(siteNameOptions.map(o => [o.key.toLowerCase(), o]));
    return allowedSiteKeys.map(key => {
      const exact = counts.get(key);
      if (exact != null) return { key, label: key, count: exact };
      const fuzzy = byLower.get(key.toLowerCase());
      // Prefer the live fleet key casing when the account key only differs by case
      return { key: fuzzy?.key ?? key, label: fuzzy?.key ?? key, count: fuzzy?.count ?? 0 };
    }).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  }, [scoped, allowedSiteKeys, siteNameOptions]);

  const showingAllScoped = useMemo(() => {
    if (!scoped || !allowedSiteKeys?.length) return false;
    if (selectedSites.length === 0) return true;
    if (selectedSites.length !== allowedSiteKeys.length) return false;
    return allowedSiteKeys.every(k => selectedSet.has(k.trim().toLowerCase()));
  }, [scoped, allowedSiteKeys, selectedSites, selectedSet]);

  const isFiltered = scoped ? !showingAllScoped : selectedSites.length > 0;

  const treeKeys = useMemo(
    () => new Set(allMatchKeys(CEMENT_SITE_TREE, siteOptions, siteNameOptions)),
    [siteOptions, siteNameOptions],
  );
  const flatOptions = useMemo(
    () => siteOptions
      .filter(o => (
        !treeKeys.has(o.key)
        && !isDecommissionedSite(o.key)
        && !isNonOperationalPlacement(o.key)
      ))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })),
    [siteOptions, treeKeys],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = scoped ? scopedOptions : flatOptions;
    if (!q) return source;
    return source.filter(o => o.label.toLowerCase().includes(q));
  }, [flatOptions, scopedOptions, scoped, query]);

  const treeVisible = useMemo(
    () => !scoped && (query.trim() === '' || nodeMatchesQuery(CEMENT_SITE_TREE, query.trim())),
    [query, scoped],
  );

  const toggleExpand = (key: string) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });

  const toggleNode = (node: SiteTreeNode) => {
    const keys = allMatchKeys(node, siteOptions, siteNameOptions);
    if (keys.length === 0) return;
    const allSelected = keys.every(k => selectedSet.has(k.toLowerCase()));
    if (allSelected) {
      const drop = new Set(keys.map(k => k.toLowerCase()));
      setSelectedSites(selectedSites.filter(s => !drop.has(s.trim().toLowerCase())));
    } else {
      const merged = new Set(selectedSites);
      keys.forEach(k => merged.add(k));
      setSelectedSites(Array.from(merged));
    }
  };

  const totalCount = useMemo(() => {
    if (scoped) return scopedOptions.reduce((s, o) => s + o.count, 0);
    return siteOptions.reduce((s, o) => s + o.count, 0);
  }, [scoped, scopedOptions, siteOptions]);

  const activeCount = useMemo(() => {
    if (!isFiltered) return totalCount;
    if (scoped) {
      return scopedOptions
        .filter(o => selectedSet.has(o.key.toLowerCase()))
        .reduce((s, o) => s + o.count, 0);
    }
    return countForKeys(selectedSites, siteOptions, siteNameOptions);
  }, [isFiltered, totalCount, scoped, scopedOptions, selectedSet, selectedSites, siteOptions, siteNameOptions]);

  const orgLabel = brandLabel(scopeLabel || CEMENT_SITE_TREE.label);
  const activeLabel = useMemo(() => {
    if (scoped) {
      if (showingAllScoped) return orgLabel;
      if (selectedSites.length === 1) return brandLabel(selectedSites[0]);
      return 'Multiple sites';
    }
    return selectedSiteScopeLabel(selectedSites, siteOptions, siteNameOptions, orgLabel) ?? orgLabel;
  }, [scoped, showingAllScoped, orgLabel, selectedSites, siteOptions, siteNameOptions]);

  const allChecked = scoped ? showingAllScoped : !isFiltered;

  const selectAll = () => {
    if (scoped && allowedSiteKeys) setSelectedSites(scopedOptions.map(o => o.key));
    else setSelectedSites([]);
  };

  const menu = open && menuPos ? createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: menuPos.top,
        left: menuPos.left,
        width: menuPos.width,
        background: '#0e1e2e',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        zIndex: 20050,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <Search size={13} style={{ position: 'absolute', left: 9, color: 'rgba(255,255,255,0.35)' }} />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search sites..."
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
            {isFiltered ? activeLabel : `Showing ${orgLabel}`}
          </span>
          {isFiltered && (
            <button
              type="button"
              onClick={selectAll}
              style={{
                fontSize: 11, fontWeight: 600, color: '#4aa3e8',
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              }}
            >
              {scoped ? 'All sites' : 'Clear'}
            </button>
          )}
        </div>
      </div>

      <div style={{ maxHeight: 340, overflowY: 'auto', padding: 6 }}>
        <SiteCheckRow label={orgLabel} count={totalCount} checked={allChecked} onClick={selectAll} />
        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '6px 4px' }} />

        {treeVisible && (CEMENT_SITE_TREE.children || []).map(child => (
          <SiteTreeRow
            key={child.key}
            node={child}
            depth={0}
            query={query.trim()}
            zoneOptions={siteOptions}
            siteOptions={siteNameOptions}
            selectedSet={selectedSet}
            expanded={expanded}
            onToggleExpand={toggleExpand}
            onToggleNode={toggleNode}
          />
        ))}
        {treeVisible && filtered.length > 0 && (
          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '6px 4px' }} />
        )}

        {filtered.length === 0 && !treeVisible ? (
          <div style={{ padding: '16px 10px', textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
            No sites match "{query}"
          </div>
        ) : filtered.map(o => (
          <SiteCheckRow
            key={o.key}
            label={o.label}
            count={o.count}
            checked={!allChecked && selectedSet.has(o.key.toLowerCase())}
            onClick={() => toggleSite(o.key)}
          />
        ))}
      </div>

      {isFiltered && (
        <div style={{
          padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.08)',
          fontSize: 11, color: 'rgba(255,255,255,0.4)',
        }}>
          {scoped
            ? 'Select sites within your transporter fleet'
            : 'Tick multiple sites — reports use the combined fleet'}
        </div>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <div style={{ position: 'relative', width: field ? '100%' : undefined }} ref={ref}>
      {label && <div className="bpl-field-label">{label}</div>}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        title={scoped ? `Filter within ${orgLabel}` : `Filter by site — default is ${orgLabel}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          height: field ? 38 : 32,
          width: field ? '100%' : undefined,
          padding: field ? '0 12px' : '0 10px',
          borderRadius: field ? 10 : 8,
          cursor: 'pointer',
          background: field
            ? 'var(--cd-surface)'
            : isFiltered || scoped
              ? 'rgba(0,120,212,0.18)'
              : 'rgba(255,255,255,0.06)',
          border: field
            ? '1px solid var(--cd-border)'
            : `0.5px solid ${isFiltered || scoped ? 'rgba(0,120,212,0.5)' : 'rgba(255,255,255,0.1)'}`,
          color: field ? 'var(--cd-text)' : isFiltered || scoped ? '#4aa3e8' : 'rgba(255,255,255,0.7)',
          maxWidth: field ? undefined : 260,
        }}
      >
        <MapPin size={14} style={{ flexShrink: 0 }} />
        <span style={{
          flex: 1, minWidth: 0, textAlign: 'left',
          fontSize: field ? 13 : 12.5, fontWeight: 600, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {activeLabel}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, borderRadius: 99, padding: '1px 6px', flexShrink: 0,
          background: field ? 'var(--cd-surface-2)' : 'rgba(255,255,255,0.1)',
          color: field ? 'var(--cd-text-muted)' : 'rgba(255,255,255,0.55)',
        }}>
          {activeCount}
        </span>
        <ChevronDown size={13} style={{
          flexShrink: 0, opacity: 0.6,
          transition: 'transform 0.2s ease', transform: open ? 'rotate(180deg)' : 'none',
        }} />
      </button>
      {menu}
    </div>
  );
}

function SiteTreeRow({ node, depth, query, zoneOptions, siteOptions, selectedSet, expanded, onToggleExpand, onToggleNode }: {
  node: SiteTreeNode;
  depth: number;
  query: string;
  zoneOptions: SiteOption[];
  siteOptions: SiteOption[];
  selectedSet: Set<string>;
  expanded: Set<string>;
  onToggleExpand: (key: string) => void;
  onToggleNode: (node: SiteTreeNode) => void;
}) {
  if (!nodeMatchesQuery(node, query)) return null;
  const hasChildren = !!node.children?.length;
  const keys = allMatchKeys(node, zoneOptions, siteOptions);
  const count = nodeCount(node, zoneOptions, siteOptions);
  const allSelected = keys.length > 0 && keys.every(k => selectedSet.has(k.toLowerCase()));
  const someSelected = !allSelected && keys.some(k => selectedSet.has(k.toLowerCase()));
  const isOpen = expanded.has(node.key) || (query !== '' && hasChildren);

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggleNode(node)}
        disabled={keys.length === 0}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '8px 10px', paddingLeft: 10 + depth * 16, borderRadius: 8,
          cursor: keys.length === 0 ? 'default' : 'pointer', textAlign: 'left',
          background: allSelected ? 'rgba(0,120,212,0.18)' : 'transparent',
          border: 'none', transition: 'background 0.12s',
          opacity: keys.length === 0 ? 0.4 : 1,
        }}
        onMouseEnter={e => { if (!allSelected && keys.length) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
        onMouseLeave={e => { if (!allSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {hasChildren ? (
          <span
            role="button"
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            onClick={e => { e.stopPropagation(); onToggleExpand(node.key); }}
            style={{ display: 'flex', flexShrink: 0, color: 'rgba(255,255,255,0.45)' }}
          >
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        ) : (
          <span style={{ width: 13, flexShrink: 0 }} />
        )}
        <CheckBox checked={allSelected} partial={someSelected} />
        <span style={{
          flex: 1, minWidth: 0, fontSize: 12.5,
          fontWeight: allSelected || depth === 0 ? 600 : 500,
          color: allSelected ? '#fff' : 'rgba(255,255,255,0.7)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {brandLabel(node.label)}
        </span>
        <CountPill count={count} />
      </button>
      {hasChildren && isOpen && node.children!.map(child => (
        <SiteTreeRow
          key={child.key}
          node={child}
          depth={depth + 1}
          query={query}
          zoneOptions={zoneOptions}
          siteOptions={siteOptions}
          selectedSet={selectedSet}
          expanded={expanded}
          onToggleExpand={onToggleExpand}
          onToggleNode={onToggleNode}
        />
      ))}
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
      <CheckBox checked={checked} />
      <span style={{
        flex: 1, minWidth: 0, fontSize: 12.5,
        fontWeight: checked ? 600 : 500,
        color: checked ? '#fff' : 'rgba(255,255,255,0.7)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {brandLabel(label)}
      </span>
      <CountPill count={count} />
    </button>
  );
}

function CheckBox({ checked, partial = false }: { checked: boolean; partial?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
        border: checked || partial ? '1.5px solid #4aa3e8' : '1.5px solid rgba(255,255,255,0.3)',
        background: checked ? '#0078D4' : partial ? 'rgba(0,120,212,0.35)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {checked && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 5.2L4.2 7.4L8 2.8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {partial && !checked && <span style={{ width: 7, height: 1.6, background: '#fff', borderRadius: 1 }} />}
    </span>
  );
}

function CountPill({ count }: { count: number }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, borderRadius: 99, padding: '1px 7px', flexShrink: 0,
      background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)',
    }}>
      {count}
    </span>
  );
}
