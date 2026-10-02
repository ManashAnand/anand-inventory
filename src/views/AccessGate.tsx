import { useState, type FormEvent } from 'react'
import type { AccessStatus } from '../../shared/types'
import { errorMessage } from '../format'

export function AccessGate({ onUnlocked }: { onUnlocked: (status: AccessStatus) => void }) {
  return (
    <div className="boot">
      <section className="onboarding-card access-card">
        <p className="eyebrow">Inventory</p>
        <h1>Enter an access code</h1>
        <p>The shop stays locked until a code is entered. Products, bills, and photos remain in the inventory folder.</p>
        <AccessCodeForm onUnlocked={onUnlocked} />
      </section>
    </div>
  )
}

export function AccessCodeForm({ onUnlocked }: { onUnlocked: (status: AccessStatus) => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const next = await window.inventory.activateAccess(code)
      setCode('')
      setNotice(accessNotice(next))
      onUnlocked(next)
    } catch (caught) {
      setError(errorMessage(caught, 'Could not use that access code'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="access-form" onSubmit={(event) => void submit(event)}>
      <label className="field">
        Access code
        <textarea
          rows={3}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Paste the code"
          spellCheck={false}
        />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="form-note">{notice}</p> : null}
      <button type="submit" className="button primary" disabled={busy || !code.trim()}>
        {busy ? 'Checking…' : 'Unlock'}
      </button>
    </form>
  )
}

function accessNotice(status: AccessStatus): string {
  if (status.plan === 'lifetime') return 'Lifetime access is on.'
  if (status.expiresOn) return `Access is on until ${formatAccessDate(status.expiresOn)}.`
  return 'Access is on.'
}

export function formatAccessDate(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
