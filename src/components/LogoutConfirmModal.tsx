interface Props {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function LogoutConfirmModal({ open, onCancel, onConfirm }: Props) {
  if (!open) return null;

  return (
    <div className="bpl-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="logout-modal-title">
      <div className="bpl-modal-card">
        <div id="logout-modal-title" className="bpl-modal-title">Log Out?</div>
        <p className="bpl-modal-body">
          Are you sure you want to log out of the dashboard?
        </p>
        <div className="bpl-modal-actions">
          <button type="button" className="bpl-modal-btn bpl-modal-btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="bpl-modal-btn bpl-modal-btn--danger" onClick={onConfirm}>
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
