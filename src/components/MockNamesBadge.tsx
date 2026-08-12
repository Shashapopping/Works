import { DEMO_BRANDING } from '../config/demoBranding';

/** Visible reminder on driver-facing pages while demo branding is on. */
export default function MockNamesBadge() {
  if (!DEMO_BRANDING) return null;
  return (
    <span
      title="Driver names are generated mocks for demos — not real identities"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: 10,
        padding: '2px 8px',
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.02em',
        color: 'var(--cd-text-muted)',
        background: 'var(--cd-surface-2)',
        border: '1px solid var(--cd-border)',
        verticalAlign: 'middle',
      }}
    >
      Mock names
    </span>
  );
}
