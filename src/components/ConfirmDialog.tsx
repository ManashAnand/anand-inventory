import { useEffect } from 'react'

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel
}: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  return (
    <div className="modal-backdrop" onMouseDown={busy ? undefined : onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        <p>{body}</p>
        <div className="modal-actions">
          <button type="button" className="button" onClick={onCancel} disabled={busy} autoFocus={danger}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? 'button danger' : 'button primary'}
            onClick={onConfirm}
            disabled={busy}
            autoFocus={!danger}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
