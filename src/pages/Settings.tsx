import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check, AlertCircle, CheckCircle, XCircle, Lock, Plus, Trash2, GripVertical, Pencil, Info, ChevronDown, Search } from 'lucide-react';
import { useFleet } from '../context/FleetContext';
import {
  DEFAULT_FLEET_SCORE_CONFIG,
  type FleetScoreConfig,
} from '../lib/fleetSafetyScore';
import {
  loadConsequenceConfig,
  saveConsequenceConfig,
  DEFAULT_CONSEQUENCE_CONFIG,
  type ConsequenceScoreConfig,
} from '../lib/consequenceScore';
import {
  ACCESS_CATALOG,
  accessLabel,
  createRoleId,
  DEFAULT_ROLES,
  type RoleDefinition,
  type RolesConfig,
} from '../lib/roleConfig';
import {
  ApiError,
  createUserApi,
  fetchRoles,
  fetchTransporters,
  fetchUsers,
  patchUserApi,
  putRoles,
  type AuthUser,
  type SeatInfo,
} from '../lib/authApi';
import { useAuth } from '../context/AuthContext';
import LicenseUpgradeModal from '../components/LicenseUpgradeModal';
import { clientName as brandClientName, productName } from '../lib/branding';
import { SkelTable, SkelValue } from '../components/data/DataBusy';

type Tab = 'general' | 'thresholds' | 'roles' | 'users' | 'dev';

const DEV_PASSWORD = 'BplAnalyst26';
const DEV_UNLOCK_KEY = 'bpl-dev-unlocked';

function isDevUnlocked() {
  try {
    return sessionStorage.getItem(DEV_UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px',
  border: '1px solid var(--cd-border)', borderRadius: 8, fontSize: 13,
  background: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none',
  fontFamily: 'var(--cd-font-body)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--cd-text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
  display: 'block',
};

/** Searchable multi-select for transporter organizations when creating a user. */
function TransporterOrgDropdown({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, query]);

  const entireFleet = selected.length === 0;
  const summary = entireFleet
    ? 'HBM — Entire fleet'
    : selected.length === 1
      ? selected[0]
      : `${selected.length} organizations`;

  const toggle = (name: string) => {
    if (selected.includes(name)) onChange(selected.filter(t => t !== name));
    else onChange([...selected, name]);
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          ...fieldStyle,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          textAlign: 'left',
          borderColor: open ? 'rgba(0,120,212,0.55)' : 'var(--cd-border)',
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summary}
        </span>
        <ChevronDown size={14} style={{
          flexShrink: 0, color: 'var(--cd-text-muted)',
          transform: open ? 'rotate(180deg)' : undefined,
          transition: 'transform 0.15s',
        }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          zIndex: 20050, background: 'var(--cd-surface)',
          border: '1px solid var(--cd-border)', borderRadius: 10,
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)', overflow: 'hidden',
        }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--cd-border)' }}>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--cd-text-muted)' }} />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search transporters…"
                style={{
                  ...fieldStyle, paddingLeft: 28, margin: 0,
                }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChange([])}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '9px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
              background: entireFleet ? 'rgba(0,120,212,0.12)' : 'transparent',
              color: 'var(--cd-text)', fontSize: 13, fontWeight: 700,
            }}
          >
            <span style={{
              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
              border: entireFleet ? '1.5px solid #0078D4' : '1.5px solid var(--cd-border)',
              background: entireFleet ? '#0078D4' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {entireFleet && <Check size={10} color="#fff" strokeWidth={3} />}
            </span>
            HBM — Entire fleet
          </button>
          <div style={{ height: 1, background: 'var(--cd-border)' }} />
          <div style={{ maxHeight: 220, overflowY: 'auto', padding: '4px 0' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '14px 12px', fontSize: 12, color: 'var(--cd-text-muted)', textAlign: 'center' }}>
                {options.length === 0 ? 'No transporters loaded' : `No match for “${query}”`}
              </div>
            ) : filtered.map(name => {
              const checked = selected.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggle(name)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '8px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
                    background: checked ? 'rgba(0,120,212,0.10)' : 'transparent',
                    color: 'var(--cd-text)', fontSize: 13,
                  }}
                >
                  <span style={{
                    width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                    border: checked ? '1.5px solid #0078D4' : '1.5px solid var(--cd-border)',
                    background: checked ? '#0078D4' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {checked && <Check size={10} color="#fff" strokeWidth={3} />}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function GeneralSettings() {
  const { theme, setTheme } = useFleet();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    clientName: brandClientName(),
    platform: productName(),
    timezone: 'Africa/Lagos',
    currency: 'NGN',
  });

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="bpl-card" style={{ padding: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 20, fontFamily: 'var(--cd-font-display)' }}>
          Platform Configuration
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>Client Name</label>
            <input style={fieldStyle} value={form.clientName} onChange={e => setForm(p => ({ ...p, clientName: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Platform Name</label>
            <input style={fieldStyle} value={form.platform} onChange={e => setForm(p => ({ ...p, platform: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Timezone</label>
            <select style={fieldStyle} value={form.timezone} onChange={e => setForm(p => ({ ...p, timezone: e.target.value }))}>
              <option value="Africa/Lagos">Africa/Lagos (WAT, UTC+1)</option>
              <option value="UTC">UTC</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Currency</label>
            <select style={fieldStyle} value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}>
              <option value="NGN">NGN — Nigerian Naira</option>
              <option value="USD">USD — US Dollar</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bpl-card" style={{ padding: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 16, fontFamily: 'var(--cd-font-display)' }}>
          Display
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--cd-text)' }}>Theme</div>
            <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>Switch between light and dark mode</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['light', 'dark'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                style={{
                  padding: '7px 16px', borderRadius: 7, fontSize: 13, cursor: 'pointer',
                  border: '1px solid',
                  borderColor: theme === t ? 'var(--bpl-blue)' : 'var(--cd-border)',
                  background: theme === t ? 'var(--bpl-blue-soft)' : 'var(--cd-surface)',
                  color: theme === t ? 'var(--bpl-blue)' : 'var(--cd-text-muted)',
                  fontWeight: theme === t ? 600 : 400,
                }}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="bpl-btn-primary" onClick={save}>
          {saved ? <><Check size={14} /> Saved</> : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

function ThresholdSettings() {
  const { scoreConfig, updateScoreConfig } = useFleet();
  const location = useLocation();
  const [form, setForm] = useState<FleetScoreConfig>(scoreConfig);
  const [consequenceForm, setConsequenceForm] = useState<ConsequenceScoreConfig>(() => loadConsequenceConfig());
  const [saved, setSaved] = useState(false);

  useEffect(() => { setForm(scoreConfig); }, [scoreConfig]);

  useEffect(() => {
    const hash = location.hash.replace(/^#/, '');
    if (hash !== 'consequence-bands' && hash !== 'driver-discipline' && location.pathname !== '/consequence-management') {
      return;
    }
    const el = document.getElementById('consequence-bands');
    if (!el) return;
    requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [location.hash, location.pathname]);

  const setWeight = (key: keyof FleetScoreConfig['weights'], value: number) => {
    setForm(p => ({ ...p, weights: { ...p.weights, [key]: value } }));
  };

  const save = () => {
    updateScoreConfig(form);
    saveConsequenceConfig(consequenceForm);
    setConsequenceForm(loadConsequenceConfig());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const resetDefaults = () => {
    setForm({
      ...DEFAULT_FLEET_SCORE_CONFIG,
      weights: { ...DEFAULT_FLEET_SCORE_CONFIG.weights },
    });
    setConsequenceForm({ ...DEFAULT_CONSEQUENCE_CONFIG });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="bpl-card" style={{ padding: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 4, fontFamily: 'var(--cd-font-display)' }}>
          Fleet Safety Score
        </div>
        <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 12, lineHeight: 1.55 }}>
          The score starts at <strong style={{ color: 'var(--cd-text)' }}>100</strong> (no harm).
          Harm is counted per 100 km driven. Every 1 point of harm per 100 km takes <strong style={{ color: 'var(--cd-text)' }}>1</strong> point off the score.
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16,
        }}>
          <div>
            <label style={labelStyle}>HOS slice length</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                step={1}
                min={1}
                max={60}
                style={{ ...fieldStyle, width: 80 }}
                value={form.hosSliceMinutes}
                onChange={e => setForm(p => ({ ...p, hosSliceMinutes: Number(e.target.value) }))}
              />
              <span style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>minutes held</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 4 }}>
              Every full slice of held HOS breach time adds safety harm points.
            </div>
          </div>
          <div>
            <label style={labelStyle}>Points per HOS slice</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                step={0.1}
                min={0}
                max={20}
                style={{ ...fieldStyle, width: 80 }}
                value={form.hosPointsPer10Min}
                onChange={e => setForm(p => ({ ...p, hosPointsPer10Min: Number(e.target.value) }))}
              />
              <span style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>pts</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 4 }}>
              Current HOS rate: +{form.hosPointsPer10Min} pts per {form.hosSliceMinutes} minutes held.
            </div>
          </div>
        </div>
        <div style={{
          fontSize: 12, color: 'var(--cd-text)', lineHeight: 1.55,
          background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)', borderRadius: 8, padding: '10px 12px',
        }}>
          <strong>The score impact:</strong> 1 harm point per 100 km → lose 1 score point.
          <div style={{ marginTop: 8, color: 'var(--cd-text-muted)' }}>
            No harm → <strong style={{ color: 'var(--cd-text)' }}>100</strong>.
            {' '}4 harm points per 100 km → 100 − 4 = <strong style={{ color: 'var(--cd-text)' }}>96</strong>.
            {' '}20 per 100 km → <strong style={{ color: 'var(--cd-text)' }}>80</strong> before the fleet ceiling is applied.
            The score cannot go above 100 or below 0.
          </div>
          <div style={{ marginTop: 8, color: 'var(--cd-text-muted)' }}>
            HOS/fatigue harm is counted as full held-time slices: breach minutes ÷ {form.hosSliceMinutes}, rounded down, then × {form.hosPointsPer10Min} pts.
          </div>
        </div>
      </div>

      <div className="bpl-card" style={{ padding: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 4, fontFamily: 'var(--cd-font-display)' }}>
          Fleet Safety Score — event weights
        </div>
        <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 16, lineHeight: 1.55 }}>
          Each incident adds these points. HOS adds points from the slice rule above.
          That number is the rate. Then: start at 100, minus 1 for every 1 on the rate.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {[
            { label: 'Harsh Braking', key: 'harshBraking' as const, desc: 'Default 2.0' },
            { label: 'Harsh Acceleration', key: 'harshAcceleration' as const, desc: 'Default 1.5' },
            { label: 'Overspeeding', key: 'overspeeding' as const, desc: 'Default 1.5 — includes Overspeed Tiered' },
            { label: 'Harsh Cornering', key: 'harshCornering' as const, desc: 'Default 1.0' },
          ].map(f => (
            <div key={f.key}>
              <label style={labelStyle}>{f.label}</label>
              <input
                type="number"
                step="0.1"
                min={0}
                max={20}
                style={{ ...fieldStyle, width: 100 }}
                value={form.weights[f.key]}
                onChange={e => setWeight(f.key, Number(e.target.value))}
              />
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 4 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bpl-card" style={{ padding: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 4, fontFamily: 'var(--cd-font-display)' }}>
          Fleet status bands
        </div>
        <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 16 }}>
          Colour / label cutoffs on the 0–100 score. Score at or above each value uses that band.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          {[
            { label: 'Good Standing ≥', key: 'bandGood' as const, color: '#16a34a' },
            { label: 'Needs Attention ≥', key: 'bandAttention' as const, color: '#d97706' },
            { label: 'Below Average ≥', key: 'bandBelow' as const, color: '#e05c2a' },
          ].map(f => (
            <div key={f.key}>
              <label style={{ ...labelStyle, color: f.color }}>{f.label}</label>
              <input
                type="number"
                min={1}
                max={100}
                style={{ ...fieldStyle, width: 80 }}
                value={form[f.key]}
                onChange={e => setForm(p => ({ ...p, [f.key]: Number(e.target.value) }))}
              />
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 12 }}>
          Below “Below Average” → Poor Performance
        </div>
      </div>

      <div id="consequence-bands" className="bpl-card" style={{ padding: 24, scrollMarginTop: 88 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 4, fontFamily: 'var(--cd-font-display)' }}>
          Driver discipline bands (Consequence/Fatigue Management)
        </div>
        <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 12, lineHeight: 1.55 }}>
          This is <strong style={{ color: 'var(--cd-text)' }}>not</strong> the Fleet Safety Score on Home.
          It grades each driver after IVMS violations (harsh brake, overspeed, etc.): On track → Needs coaching → Suspension review → Critical.
        </div>
        <div style={{
          fontSize: 12, color: 'var(--cd-text)', lineHeight: 1.55, marginBottom: 16,
          background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)', borderRadius: 8, padding: '10px 12px',
        }}>
          <strong>How it works:</strong> every scored event costs points. Those points are divided by how far the driver drove
          (per 100 km), so a driver with 1 event in 50 km looks worse than 1 event in 500 km.
          <div style={{ marginTop: 8, color: 'var(--cd-text-muted)' }}>
            Example with default 2: 34 events × −2 = −68 points. Drove 600 km → that’s 600÷100 = <strong>6</strong> blocks of 100 km → −68 ÷ 6 = <strong style={{ color: '#d97706' }}>−11.3 → Suspension review</strong>.
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Points lost per violation</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                step={0.5}
                min={0.5}
                max={20}
                style={{ ...fieldStyle, width: 80 }}
                value={consequenceForm.penaltyPerEvent}
                onChange={e => setConsequenceForm(p => ({ ...p, penaltyPerEvent: Number(e.target.value) }))}
              />
              <span style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>points deducted each time</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 4 }}>
              Raise this to punish violations harder. Policy default is 2.
            </div>
          </div>
          <div>
            <label style={{ ...labelStyle, color: '#f59e0b' }}>Needs coaching band starts at</label>
            <input
              type="number"
              step={0.1}
              style={{ ...fieldStyle, width: 80 }}
              value={consequenceForm.amberStart}
              onChange={e => setConsequenceForm(p => ({ ...p, amberStart: Number(e.target.value) }))}
            />
            <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 4, lineHeight: 1.4 }}>
              Driver score ≤ this → <strong style={{ color: '#f59e0b' }}>Needs coaching</strong> (written warning / retraining).
              Above this (and still negative) stays Green-ish / mild. Default −2.
            </div>
          </div>
          <div>
            <label style={{ ...labelStyle, color: '#d97706' }}>Suspension band starts at</label>
            <input
              type="number"
              step={0.1}
              style={{ ...fieldStyle, width: 80 }}
              value={consequenceForm.yellowStart}
              onChange={e => setConsequenceForm(p => ({ ...p, yellowStart: Number(e.target.value) }))}
            />
            <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 4, lineHeight: 1.4 }}>
              Score ≤ this → <strong style={{ color: '#d97706' }}>Suspension review</strong> (3-day → 1-week suspension). Default −6.
            </div>
          </div>
          <div>
            <label style={{ ...labelStyle, color: '#CC0000' }}>Severe band starts at</label>
            <input
              type="number"
              step={0.1}
              style={{ ...fieldStyle, width: 80 }}
              value={consequenceForm.redStart}
              onChange={e => setConsequenceForm(p => ({ ...p, redStart: Number(e.target.value) }))}
            />
            <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 4, lineHeight: 1.4 }}>
              Score ≤ this → <strong style={{ color: '#CC0000' }}>Critical</strong> (2-week suspension → termination). Default −12.
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 14, lineHeight: 1.45 }}>
          Scores are negative numbers: 0 is perfect, −12 is much worse than −2.
          Move a band number closer to 0 (e.g. −4 instead of −6) to make that tier kick in sooner.
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          type="button"
          onClick={resetDefaults}
          style={{
            padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
            border: '1px solid var(--cd-border)', background: 'var(--cd-surface)', color: 'var(--cd-text-muted)',
          }}
        >
          Reset defaults
        </button>
        <button className="bpl-btn-primary" onClick={save}>
          {saved ? <><Check size={14} /> Saved — scores updated</> : 'Save Thresholds'}
        </button>
      </div>
    </div>
  );
}

function APISettings() {
  const apiKeys = [
    { name: 'MiX Telematics', key: 'VITE_API_SECRET', status: 'connected', desc: 'Live vehicle telemetry and event data' },
    { name: 'Claude (BPL Analyst)', key: 'VITE_ANTHROPIC_API_KEY', status: import.meta.env.VITE_ANTHROPIC_API_KEY ? 'connected' : 'not_configured', desc: 'AI analysis and BPL Analyst chat intelligence' },
    { name: 'Open-Meteo', key: 'None required', status: 'connected', desc: 'Live weather at incident coordinates via /api/environment' },
    { name: 'TomTom Traffic', key: 'TOMTOM_API_KEY', status: 'server_side', desc: 'Recommended live traffic provider for Lagos/Nigeria — Traffic Flow API' },
    { name: 'Google Maps Traffic', key: 'GOOGLE_MAPS_API_KEY', status: 'server_side', desc: 'Backup live traffic provider — falls back to heuristic without key' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {apiKeys.map(api => (
        <div key={api.name} className="bpl-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 2 }}>{api.name}</div>
            <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>{api.desc}</div>
            <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 3 }}>
              Env key: <code style={{ fontFamily: 'monospace', background: 'var(--cd-surface-2)', padding: '1px 5px', borderRadius: 3 }}>{api.key}</code>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {api.status === 'connected' ? (
              <><CheckCircle size={16} color="#16a34a" /><span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>Connected</span></>
            ) : api.status === 'server_side' ? (
              <><AlertCircle size={16} color="#0078D4" /><span style={{ fontSize: 12, color: '#0078D4', fontWeight: 600 }}>Server-side</span></>
            ) : (
              <><XCircle size={16} color="#d97706" /><span style={{ fontSize: 12, color: '#d97706', fontWeight: 600 }}>Not configured</span></>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function DevGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(isDevUnlocked);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const unlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === DEV_PASSWORD) {
      try { sessionStorage.setItem(DEV_UNLOCK_KEY, '1'); } catch { /* ignore */ }
      setUnlocked(true);
      setError(false);
      setPassword('');
      return;
    }
    setError(true);
  };

  const lock = () => {
    try { sessionStorage.removeItem(DEV_UNLOCK_KEY); } catch { /* ignore */ }
    setUnlocked(false);
    setPassword('');
  };

  if (!unlocked) {
    return (
      <div className="bpl-card" style={{ padding: 28, maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Lock size={18} color="var(--bpl-blue)" />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
            Developer access
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
          Enter the developer password to view API connection status. Frontend-only gate for this session.
        </p>
        <form onSubmit={unlock} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              autoComplete="off"
              style={fieldStyle}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(false); }}
              placeholder="Developer password"
            />
            {error && (
              <div style={{ fontSize: 12, color: '#dc2626', marginTop: 6 }}>Incorrect password</div>
            )}
          </div>
          <button type="submit" className="bpl-btn-primary" style={{ alignSelf: 'flex-start' }}>
            Unlock
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={lock}
          style={{
            padding: '6px 12px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
            border: '1px solid var(--cd-border)', background: 'var(--cd-surface)',
            color: 'var(--cd-text-muted)',
          }}
        >
          Lock again
        </button>
      </div>
      {children}
    </div>
  );
}

type DragPayload = { permissionId: string; fromRoleId: string | null };

const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 500,
  background: 'var(--cd-surface-2)', color: 'var(--cd-text)',
  border: '1px solid var(--cd-border)', cursor: 'grab', userSelect: 'none',
};

function PermissionChip({
  permissionId,
  fromRoleId,
  onRemove,
}: {
  permissionId: string;
  fromRoleId: string | null;
  onRemove?: () => void;
}) {
  const onDragStart = (e: React.DragEvent) => {
    const payload: DragPayload = { permissionId, fromRoleId };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <span draggable onDragStart={onDragStart} style={chipStyle}>
      <GripVertical size={10} style={{ opacity: 0.35, flexShrink: 0 }} />
      {accessLabel(permissionId)}
      {onRemove && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onRemove(); }}
          style={{
            marginLeft: 2, padding: 0, border: 'none', background: 'none',
            cursor: 'pointer', color: 'var(--cd-text-muted)', display: 'flex', alignItems: 'center',
          }}
          title="Remove from role"
        >
          <XCircle size={12} />
        </button>
      )}
    </span>
  );
}

function RoleSettings() {
  const { refresh: refreshAuth } = useAuth();
  const [config, setConfig] = useState<RolesConfig>({ roles: [] });
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [dragOverRoleId, setDragOverRoleId] = useState<string | null>(null);
  const [dragOverPool, setDragOverPool] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: '', desc: '' });

  const serialize = (roles: RoleDefinition[]) => JSON.stringify(
    roles.map(r => ({ id: r.id, name: r.name, desc: r.desc, permissions: [...new Set(r.permissions)].sort() })),
  );

  const dirty = !loading && baseline !== '' && serialize(config.roles) !== baseline;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchRoles();
        if (!cancelled) {
          const roles = data.roles.map(r => ({
            id: r.id,
            name: r.name,
            desc: r.desc,
            permissions: r.permissions,
          }));
          setConfig({ roles });
          setBaseline(serialize(roles));
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load roles');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // HashRouter has no data-router blocker; warn on tab close/refresh when dirty.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const assignPermission = (roleId: string, permissionId: string, fromRoleId: string | null) => {
    setConfig(prev => ({
      roles: prev.roles.map(role => {
        if (role.id === roleId) {
          if (role.permissions.includes(permissionId)) return role;
          return { ...role, permissions: [...role.permissions, permissionId] };
        }
        if (fromRoleId === role.id) {
          return { ...role, permissions: role.permissions.filter(p => p !== permissionId) };
        }
        return role;
      }),
    }));
  };

  const removePermission = (roleId: string, permissionId: string) => {
    setConfig(prev => ({
      roles: prev.roles.map(role =>
        role.id === roleId
          ? { ...role, permissions: role.permissions.filter(p => p !== permissionId) }
          : role,
      ),
    }));
  };

  const handleDropOnRole = (roleId: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverRoleId(null);
    try {
      const payload = JSON.parse(e.dataTransfer.getData('application/json')) as DragPayload;
      if (payload?.permissionId) assignPermission(roleId, payload.permissionId, payload.fromRoleId);
    } catch { /* ignore invalid drag */ }
  };

  const startEdit = (role: RoleDefinition) => {
    setEditingId(role.id);
    setEditDraft({ name: role.name, desc: role.desc });
  };

  const commitEdit = () => {
    if (!editingId) return;
    setConfig(prev => ({
      roles: prev.roles.map(r =>
        r.id === editingId
          ? { ...r, name: editDraft.name.trim() || r.name, desc: editDraft.desc.trim() }
          : r,
      ),
    }));
    setEditingId(null);
  };

  const addRole = () => {
    const id = createRoleId('new-role');
    setConfig(prev => ({
      roles: [...prev.roles, { id, name: 'New Role', desc: 'Describe what this role can do', permissions: [] }],
    }));
    setEditingId(id);
    setEditDraft({ name: 'New Role', desc: 'Describe what this role can do' });
  };

  const deleteRole = (id: string) => {
    if (config.roles.length <= 1) return;
    setConfig(prev => ({ roles: prev.roles.filter(r => r.id !== id) }));
    if (editingId === id) setEditingId(null);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    setSaved(false);
    // Flush in-progress name/desc edit into config before persist
    let rolesToSave = config.roles;
    if (editingId) {
      rolesToSave = config.roles.map(r =>
        r.id === editingId
          ? { ...r, name: editDraft.name.trim() || r.name, desc: editDraft.desc.trim() }
          : r,
      );
      setConfig({ roles: rolesToSave });
      setEditingId(null);
    }
    rolesToSave = rolesToSave.map(role => ({
      ...role,
      permissions: [...new Set(role.permissions)],
    }));
    try {
      const data = await putRoles(rolesToSave);
      const roles = data.roles.map(r => ({
        id: r.id,
        name: r.name,
        desc: r.desc,
        permissions: r.permissions,
      }));
      setConfig({ roles });
      setBaseline(serialize(roles));
      await refreshAuth();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => {
    setConfig({
      roles: DEFAULT_ROLES.map(r => ({ ...r, permissions: [...r.permissions] })),
    });
    setEditingId(null);
  };

  const handleDropOnPool = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverPool(false);
    try {
      const payload = JSON.parse(e.dataTransfer.getData('application/json')) as DragPayload;
      if (payload?.fromRoleId && payload.permissionId) {
        removePermission(payload.fromRoleId, payload.permissionId);
      }
    } catch { /* ignore invalid drag */ }
  };

  const groups = [...new Set(ACCESS_CATALOG.map(a => a.group))];

  if (loading) {
    return (
      <div className="bpl-card" style={{ padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 12, fontFamily: 'var(--cd-font-display)' }}>
          Roles
        </div>
        <SkelTable rows={6} />
      </div>
    );
  }

  if (loadError) {
    return <div style={{ fontSize: 13, color: '#dc2626' }}>{loadError}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {saveError && (
        <div style={{ fontSize: 12, color: '#dc2626', padding: '10px 12px', borderRadius: 8, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)' }}>
          {saveError}
        </div>
      )}
      <div className="bpl-roles-layout">
        {/* Left — access pool (fixed column, scrolls internally if needed) */}
        <div
          className="bpl-card bpl-roles-access-panel"
          onDragOver={e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDragOverPool(true);
          }}
          onDragLeave={() => setDragOverPool(false)}
          onDrop={handleDropOnPool}
          style={{
            padding: 20,
            border: dragOverPool ? '2px dashed var(--bpl-blue)' : undefined,
            background: dragOverPool ? 'var(--bpl-blue-soft)' : undefined,
            transition: 'border-color 0.15s, background 0.15s',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 4, fontFamily: 'var(--cd-font-display)' }}>
            Available access
          </div>
          <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
            Drag onto a role →. Drop here ← to remove from a role.
          </div>
          {groups.map((group, i) => (
            <div key={group} style={{ marginBottom: i < groups.length - 1 ? 16 : 0 }}>
              <div style={{ ...labelStyle, marginBottom: 8 }}>{group}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {ACCESS_CATALOG.filter(a => a.group === group).map(item => (
                  <PermissionChip key={item.id} permissionId={item.id} fromRoleId={null} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Right — roles (scrolls independently) */}
        <div className="bpl-roles-list-panel">
          <div style={{ padding: '0 4px 4px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
              Roles
            </div>
            <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginTop: 4 }}>
              Define each role’s name, description, and assigned permissions.
            </div>
          </div>

          {config.roles.map(role => {
            const isOver = dragOverRoleId === role.id;
            const isEditing = editingId === role.id;
            const nameFieldId = `role-name-${role.id}`;
            const descFieldId = `role-desc-${role.id}`;

            return (
              <div key={role.id} className="bpl-card" style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <label htmlFor={isEditing ? nameFieldId : undefined} style={labelStyle}>Role name</label>
                      {isEditing ? (
                        <input
                          id={nameFieldId}
                          style={fieldStyle}
                          value={editDraft.name}
                          onChange={e => setEditDraft(p => ({ ...p, name: e.target.value }))}
                        />
                      ) : (
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)' }}>{role.name}</div>
                      )}
                    </div>
                    <div>
                      <label htmlFor={isEditing ? descFieldId : undefined} style={labelStyle}>Description</label>
                      {isEditing ? (
                        <input
                          id={descFieldId}
                          style={fieldStyle}
                          value={editDraft.desc}
                          onChange={e => setEditDraft(p => ({ ...p, desc: e.target.value }))}
                        />
                      ) : (
                        <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', lineHeight: 1.5 }}>
                          {role.desc || 'No description'}
                        </div>
                      )}
                    </div>
                    {isEditing && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="bpl-btn-primary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={commitEdit}>
                          Done
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          style={{
                            padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                            border: '1px solid var(--cd-border)', background: 'var(--cd-surface)', color: 'var(--cd-text-muted)',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                  {!isEditing && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => startEdit(role)}
                        title="Edit role"
                        style={{
                          padding: 6, borderRadius: 7, cursor: 'pointer',
                          border: '1px solid var(--cd-border)', background: 'var(--cd-surface)', color: 'var(--cd-text-muted)',
                          display: 'flex', alignItems: 'center',
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRole(role.id)}
                        disabled={config.roles.length <= 1}
                        title="Delete role"
                        style={{
                          padding: 6, borderRadius: 7, cursor: config.roles.length <= 1 ? 'not-allowed' : 'pointer',
                          border: '1px solid var(--cd-border)', background: 'var(--cd-surface)',
                          color: config.roles.length <= 1 ? 'var(--cd-border)' : '#dc2626',
                          display: 'flex', alignItems: 'center', opacity: config.roles.length <= 1 ? 0.4 : 1,
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ ...labelStyle, marginBottom: 8 }}>Permissions</label>
                  <div
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverRoleId(role.id); }}
                    onDragLeave={() => setDragOverRoleId(prev => (prev === role.id ? null : prev))}
                    onDrop={e => handleDropOnRole(role.id, e)}
                    style={{
                      minHeight: 48, padding: 12, borderRadius: 10,
                      border: `2px dashed ${isOver ? 'var(--bpl-blue)' : 'var(--cd-border)'}`,
                      background: isOver ? 'var(--bpl-blue-soft)' : 'var(--cd-surface-2)',
                      transition: 'border-color 0.15s, background 0.15s',
                    }}
                  >
                    {role.permissions.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', textAlign: 'center', padding: '4px 0' }}>
                        Drop access here
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {role.permissions.map(pid => (
                          <PermissionChip
                            key={pid}
                            permissionId={pid}
                            fromRoleId={role.id}
                            onRemove={() => removePermission(role.id, pid)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addRole}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '12px 16px', borderRadius: 10, cursor: 'pointer',
              border: '1px dashed var(--cd-border)', background: 'transparent', color: 'var(--cd-text-muted)', fontSize: 13,
            }}
          >
            <Plus size={16} />
            Add role
          </button>

          <div style={{ padding: '12px 16px', background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)', borderRadius: 10, fontSize: 12, color: 'var(--cd-text-muted)', lineHeight: 1.5 }}>
            Roles are stored on the server and enforced for every signed-in user. Assign people to roles under Settings → Users.
            {dirty && (
              <div style={{ marginTop: 8, color: '#b45309', fontWeight: 600 }}>
                Unsaved changes — click Save roles before leaving this page or they will be lost.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingBottom: 4 }}>
            <button
              type="button"
              onClick={resetDefaults}
              style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                border: '1px solid var(--cd-border)', background: 'var(--cd-surface)', color: 'var(--cd-text-muted)',
              }}
            >
              Reset defaults
            </button>
            <button type="button" className="bpl-btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving...' : saved ? <><Check size={14} /> Saved</> : dirty ? 'Save roles*' : 'Save roles'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function UserSettings() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [roles, setRoles] = useState<Array<{ id: string; name: string; desc: string }>>([]);
  const [seats, setSeats] = useState<SeatInfo>({ used: 0, limit: 3, remaining: 3 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '', email: '', password: '', roleId: 'view-only',
    transporters: [] as string[], fleetName: '',
  });
  const [transporterOptions, setTransporterOptions] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createdTemp, setCreatedTemp] = useState<{ email: string; password: string; emailSent?: boolean; emailError?: string | null } | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const reload = async () => {
    const data = await fetchUsers('client');
    setUsers(data.users);
    setRoles(data.roles);
    if (data.seats) setSeats(data.seats);
    if (!form.roleId && data.roles[0]) {
      setForm(p => ({ ...p, roleId: data.roles[0].id }));
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load users');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (form.roleId !== 'transporter') return;
    let cancelled = false;
    fetchTransporters()
      .then(list => {
        if (!cancelled) setTransporterOptions(list);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [form.roleId]);

  const atLimit = seats.used >= seats.limit;

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (atLimit) {
      setUpgradeOpen(true);
      return;
    }
    setError('');
    setCreatedTemp(null);
    setCreating(true);
    try {
      const payload = {
        ...form,
        transporters: form.roleId === 'transporter' ? form.transporters : undefined,
        fleetName: form.roleId === 'transporter' ? (form.fleetName.trim() || undefined) : undefined,
      };
      const result = await createUserApi(payload);
      setCreatedTemp({
        email: form.email,
        password: form.password,
        emailSent: !!(result.user as AuthUser & { emailSent?: boolean }).emailSent,
        emailError: (result.user as AuthUser & { emailError?: string | null }).emailError ?? null,
      });
      setForm({
        name: '', email: '', password: '', roleId: form.roleId || 'view-only',
        transporters: [], fleetName: '',
      });
      if (result.seats) setSeats(result.seats);
      await reload();
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'seat_limit' || err.status === 402)) {
        if (err.used != null && err.limit != null) {
          setSeats({ used: err.used, limit: err.limit, remaining: Math.max(0, err.limit - err.used) });
        }
        setUpgradeOpen(true);
      } else {
        setError(err instanceof Error ? err.message : 'Create failed');
      }
    } finally {
      setCreating(false);
    }
  };

  const setStatus = async (u: AuthUser, status: 'active' | 'disabled') => {
    setError('');
    try {
      const result = await patchUserApi(u.id, { status });
      if (result.seats) setSeats(result.seats);
      await reload();
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'seat_limit' || err.status === 402)) {
        setUpgradeOpen(true);
      } else {
        setError(err instanceof Error ? err.message : 'Update failed');
      }
    }
  };

  const setRole = async (u: AuthUser, roleId: string) => {
    setError('');
    try {
      await patchUserApi(u.id, { roleId });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="bpl-card" style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 8 }}>User seats</div>
          <SkelValue wide />
        </div>
        <div className="bpl-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 12, fontFamily: 'var(--cd-font-display)' }}>
            People
          </div>
          <SkelTable rows={5} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <LicenseUpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        used={seats.used}
        limit={seats.limit}
      />

      <div className="bpl-card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cd-text)' }}>User seats</div>
          <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginTop: 2 }}>
            {seats.used} of {seats.limit} seats used
            {atLimit ? ' — upgrade to add more' : ''}
          </div>
        </div>
        <div style={{
          minWidth: 120, height: 8, borderRadius: 999, background: 'var(--cd-surface-2)', overflow: 'hidden',
          border: '1px solid var(--cd-border)',
        }}>
          <div style={{
            width: `${Math.min(100, (seats.used / Math.max(1, seats.limit)) * 100)}%`,
            height: '100%',
            background: atLimit ? '#dc2626' : 'var(--bpl-blue)',
          }} />
        </div>
      </div>

      <div className="bpl-card" style={{ padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 4, fontFamily: 'var(--cd-font-display)' }}>
          Create user
        </div>
        <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
          Admin creates the account and chooses a role. An invite email with the temporary password is sent when Resend is configured. The user must change the password on first sign-in.
        </div>
        <form onSubmit={onCreate} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input style={fieldStyle} required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input style={fieldStyle} type="email" required value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Temporary password</label>
            <input style={fieldStyle} type="text" required minLength={8} value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Role</label>
            <select
              style={fieldStyle}
              value={form.roleId}
              onChange={e => setForm(p => ({ ...p, roleId: e.target.value, transporters: [], fleetName: '' }))}
            >
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          {form.roleId === 'transporter' && (
            <>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Organizations</label>
                <TransporterOrgDropdown
                  options={transporterOptions}
                  selected={form.transporters}
                  onChange={transporters => setForm(p => ({ ...p, transporters }))}
                />
                <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 6, lineHeight: 1.4 }}>
                  Leave as Entire fleet for HBM staff, or pick one or more transporter orgs to lock the account.
                </div>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Fleet display name (optional)</label>
                <input
                  style={fieldStyle}
                  placeholder="Shown in place of HBM Nigeria for this account"
                  value={form.fleetName}
                  onChange={e => setForm(p => ({ ...p, fleetName: e.target.value }))}
                />
              </div>
            </>
          )}
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              type={atLimit ? 'button' : 'submit'}
              className="bpl-btn-primary"
              disabled={creating}
              onClick={atLimit ? () => setUpgradeOpen(true) : undefined}
            >
              {creating ? 'Creating…' : atLimit ? 'Upgrade to add users' : 'Create user'}
            </button>
            {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
          </div>
        </form>
        {createdTemp && (
          <div style={{ marginTop: 14, padding: 12, background: 'var(--cd-surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--cd-text-muted)' }}>
            Created <strong style={{ color: 'var(--cd-text)' }}>{createdTemp.email}</strong>
            {createdTemp.emailSent ? ' — invite email sent.' : ` — temp password: ${createdTemp.password}`}
            {createdTemp.emailError && <div style={{ color: '#b45309', marginTop: 4 }}>Email: {createdTemp.emailError}</div>}
          </div>
        )}
      </div>

      <div className="bpl-card" style={{ padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 12, fontFamily: 'var(--cd-font-display)' }}>
          People ({users.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {users.map(u => (
            <div key={u.id} style={{
              display: 'grid', gridTemplateColumns: '1.4fr 1.2fr 1fr auto', gap: 10, alignItems: 'center',
              padding: '10px 12px', borderRadius: 8, border: '1px solid var(--cd-border)', background: 'var(--cd-surface-2)',
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cd-text)' }}>{u.name}</div>
                <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>
                  {u.email}
                  {u.roleId === 'transporter'
                    ? ` · ${u.transporters?.length ? u.transporters.join(', ') : 'HBM — Entire fleet'}`
                    : ''}
                  {u.fleetName ? ` · "${u.fleetName}"` : ''}
                </div>
              </div>
              <select
                style={{ ...fieldStyle, padding: '6px 10px' }}
                value={u.roleId}
                disabled={u.id === me?.id}
                onChange={e => setRole(u, e.target.value)}
              >
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <div style={{ fontSize: 12, color: u.status === 'active' ? '#059669' : 'var(--cd-text-muted)' }}>
                {u.status}
              </div>
              <button
                type="button"
                disabled={u.id === me?.id}
                onClick={() => setStatus(u, u.status === 'active' ? 'disabled' : 'active')}
                style={{
                  padding: '6px 10px', borderRadius: 7, fontSize: 12, cursor: u.id === me?.id ? 'not-allowed' : 'pointer',
                  border: '1px solid var(--cd-border)', background: 'var(--cd-surface)', color: 'var(--cd-text-muted)',
                }}
              >
                {u.status === 'active' ? 'Disable' : 'Enable'}
              </button>
            </div>
          ))}
          {users.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>No client users yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlatformUsersDev() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [roles, setRoles] = useState<Array<{ id: string; name: string; desc: string }>>([]);
  const [seats, setSeats] = useState<SeatInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '', email: '', password: '', roleId: 'admin', isOrganisational: true,
  });
  const [creating, setCreating] = useState(false);
  const [canManageOrg, setCanManageOrg] = useState(!!me?.isOrganisational);

  const reload = useCallback(async () => {
    try {
      const data = await fetchUsers('all');
      setUsers(data.users);
      setRoles(data.roles);
      if (data.seats) setSeats(data.seats);
      setCanManageOrg(true);
    } catch {
      const data = await fetchUsers('client');
      setUsers(data.users);
      setRoles(data.roles);
      if (data.seats) setSeats(data.seats);
      setCanManageOrg(!!me?.isOrganisational);
    }
  }, [me?.isOrganisational]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load users');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageOrg) {
      setError('Sign in with an organisational account to manage platform users');
      return;
    }
    setError('');
    setCreating(true);
    try {
      await createUserApi(form);
      setForm({ name: '', email: '', password: '', roleId: form.roleId, isOrganisational: form.isOrganisational });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const toggleOrg = async (u: AuthUser) => {
    setError('');
    try {
      await patchUserApi(u.id, { isOrganisational: !u.isOrganisational });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  if (loading) return null;

  return (
    <div className="bpl-card" style={{ padding: 20, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
          Platform users
        </div>
        <span title="Organisational accounts are internal Best Practices Ltd users. They stay hidden from Settings → Users and do not use a client seat." style={{ display: 'inline-flex', color: 'var(--cd-text-muted)', cursor: 'help' }}>
          <Info size={14} />
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
        Full account list (including internal organisational users). Mark accounts as <strong style={{ color: 'var(--cd-text)' }}>Organisational</strong> so they do not appear on the public Users table and do not consume a client seat.
        {seats && <> Client seats in use: {seats.used}/{seats.limit}.</>}
      </p>

      {!canManageOrg && (
        <div style={{ fontSize: 12, color: '#b45309', marginBottom: 12 }}>
          Your signed-in account is not marked organisational — mark it here once (via another org admin) or promote it in Dev after first bootstrap. Scope=all requires an organisational actor.
        </div>
      )}

      {canManageOrg && (
        <form onSubmit={onCreate} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <input style={fieldStyle} placeholder="Name" required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          <input style={fieldStyle} type="email" placeholder="Email" required value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
          <input style={fieldStyle} placeholder="Temp password (8+)" required minLength={8} value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
          <select style={fieldStyle} value={form.roleId} onChange={e => setForm(p => ({ ...p, roleId: e.target.value }))}>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--cd-text)', gridColumn: '1 / -1' }}>
            <input
              type="checkbox"
              checked={form.isOrganisational}
              onChange={e => setForm(p => ({ ...p, isOrganisational: e.target.checked }))}
            />
            Organisational (internal)
            <span title="Internal Best Practices Ltd account. Hidden from Settings → Users. Visible only in Dev. Does not use a client seat." style={{ display: 'inline-flex', color: 'var(--cd-text-muted)', cursor: 'help' }}>
              <Info size={13} />
            </span>
          </label>
          <button type="submit" className="bpl-btn-primary" disabled={creating} style={{ justifySelf: 'start' }}>
            {creating ? 'Creating…' : 'Create platform user'}
          </button>
        </form>
      )}

      {error && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {users.map(u => (
          <div key={u.id} style={{
            display: 'grid', gridTemplateColumns: '1.5fr 1fr auto', gap: 10, alignItems: 'center',
            padding: '10px 12px', borderRadius: 8, border: '1px solid var(--cd-border)', background: 'var(--cd-surface-2)',
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cd-text)' }}>
                {u.name}
                {u.isOrganisational && (
                  <span style={{
                    marginLeft: 8, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                    color: '#0078D4', textTransform: 'uppercase',
                  }}>Org</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{u.email} · {u.roleName || u.roleId} · {u.status}</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--cd-text)', cursor: canManageOrg ? 'pointer' : 'not-allowed' }}>
              <input
                type="checkbox"
                checked={!!u.isOrganisational}
                disabled={!canManageOrg || u.id === me?.id && !!u.isOrganisational && users.filter(x => x.isOrganisational).length <= 1}
                onChange={() => toggleOrg(u)}
              />
              Organisational
              <span title="Internal account — won't show on the public Users table unless you're in Dev." style={{ display: 'inline-flex', color: 'var(--cd-text-muted)', cursor: 'help' }}>
                <Info size={12} />
              </span>
            </label>
            <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{u.isOrganisational ? 'Hidden from client Users' : 'Client seat'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Settings({ tab }: { tab: Tab }) {
  const { hasPermission } = useAuth();

  const TAB_TITLES: Record<Tab, string> = {
    general: 'General',
    thresholds: 'Safety & Consequence',
    roles: 'Roles & Permissions',
    users: 'Users',
    dev: 'Developers',
  };

  const TAB_SUBTITLES: Record<Tab, string> = {
    general: 'Client name, timezone, currency, and display preferences',
    thresholds: 'Fleet safety score weights, driver discipline bands, and Consequence/Fatigue Management',
    roles: 'Define roles and drag access permissions onto each one',
    users: 'Create accounts, assign roles, enable or disable access',
    dev: 'Developer tools and API connection status',
  };

  const tabs: { id: Tab; path: string; label: string }[] = [
    { id: 'general', path: '/settings/general', label: 'General' },
    { id: 'thresholds', path: '/settings/scoring', label: 'Safety & Consequence' },
    { id: 'roles', path: '/settings/roles', label: 'Roles' },
    ...(hasPermission('user-management') ? [{ id: 'users' as const, path: '/settings/users', label: 'Users' }] : []),
    { id: 'dev', path: '/settings/dev', label: 'Dev' },
  ];

  return (
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">Settings — {TAB_TITLES[tab]}</h1>
        <p className="bpl-page-subtitle">{TAB_SUBTITLES[tab]}</p>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <Link
            key={t.id}
            to={t.path}
            style={{
              padding: '7px 14px',
              borderRadius: 8,
              fontSize: 13,
              textDecoration: 'none',
              border: '1px solid',
              borderColor: tab === t.id ? 'var(--bpl-blue)' : 'var(--cd-border)',
              background: tab === t.id ? 'var(--bpl-blue-soft)' : 'var(--cd-surface)',
              color: tab === t.id ? 'var(--bpl-blue)' : 'var(--cd-text-muted)',
              fontWeight: tab === t.id ? 600 : 400,
            }}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'general' && <GeneralSettings />}
      {tab === 'thresholds' && <ThresholdSettings />}
      {tab === 'roles' && <RoleSettings />}
      {tab === 'users' && <UserSettings />}
      {tab === 'dev' && (
        <DevGate>
          <APISettings />
          <PlatformUsersDev />
        </DevGate>
      )}
    </div>
  );
}
