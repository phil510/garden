interface DismissConfirmProps {
  onConfirm: () => void;
  onCancel: () => void;
  sending: boolean;
}

/** The only place the dismiss request is sent from: nothing reaches GitHub until Confirm. */
export function DismissConfirm({ onConfirm, onCancel, sending }: DismissConfirmProps) {
  return (
    <div className="rv-confirm" role="group" aria-label="Confirm dismiss">
      <div className="rv-confirm-text">
        Remove your review request on GitHub? The author will see that you removed it.
      </div>
      <div className="rv-confirm-actions">
        <button className="small danger" onClick={onConfirm} disabled={sending}>
          Confirm
        </button>
        <button className="small" onClick={onCancel} disabled={sending}>
          Cancel
        </button>
      </div>
    </div>
  );
}
