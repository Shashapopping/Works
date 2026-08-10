interface Props {
  open: boolean;
  onClose: () => void;
  used?: number;
  limit?: number;
}

export default function LicenseUpgradeModal({ open, onClose, used = 3, limit = 3 }: Props) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="license-upgrade-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'radial-gradient(ellipse at 30% 20%, rgba(0,90,160,0.35), transparent 55%), rgba(8, 14, 22, 0.72)',
        backdropFilter: 'blur(8px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)',
          color: '#0f172a',
          borderRadius: 4,
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
          border: '1px solid rgba(255,255,255,0.6)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          height: 4,
          background: 'linear-gradient(90deg, #0078D4, #106EBE 55%, #005A9E)',
        }} />
        <div style={{ padding: '36px 36px 28px' }}>
          <div style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#64748b',
            marginBottom: 12,
          }}>
            HBM Fleet Intelligence
          </div>
          <h2
            id="license-upgrade-title"
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              lineHeight: 1.25,
              color: '#0f172a',
              fontFamily: 'var(--cd-font-display, Georgia, serif)',
            }}
          >
            License limit reached
          </h2>
          <p style={{
            margin: '14px 0 0',
            fontSize: 15,
            lineHeight: 1.55,
            color: '#475569',
          }}>
            This package includes <strong style={{ color: '#0f172a' }}>{limit} user seats</strong>
            {used != null ? <> ({used} in use)</> : null}.
            Subscribe to a higher package to add more accounts for your organisation.
          </p>
          <div style={{
            marginTop: 22,
            padding: '14px 16px',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 2,
            fontSize: 13,
            color: '#64748b',
            lineHeight: 1.5,
          }}>
            Need more seats? Contact Best Practices Ltd for an enterprise upgrade.
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 28, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 16px',
                borderRadius: 2,
                border: '1px solid #cbd5e1',
                background: '#fff',
                color: '#334155',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
            <a
              href="mailto:technicalsupport@bestpracticesltd.com?subject=HBM%20Fleet%20—%20Upgrade%20user%20seats"
              style={{
                padding: '10px 18px',
                borderRadius: 2,
                border: 'none',
                background: '#0078D4',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              Contact Best Practices Ltd
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
