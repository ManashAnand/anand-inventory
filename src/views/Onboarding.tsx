import { useState } from 'react'
import type { AppState } from '../../shared/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { errorMessage } from '../format'

export function Onboarding({ settings, onReady }: { settings: AppState; onReady: () => Promise<unknown> }) {
  const [shopName, setShopName] = useState('')
  const [currency, setCurrency] = useState('INR')
  const [error, setError] = useState<string | null>(null)
  const [pendingCreate, setPendingCreate] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function createAt(folderPath: string) {
    setBusy(true)
    setError(null)
    try {
      await window.inventory.createInventory(folderPath, { shopName, currency })
      setPendingCreate(null)
      await onReady()
    } catch (caught) {
      setError(errorMessage(caught, 'Could not create the inventory'))
    } finally {
      setBusy(false)
    }
  }

  async function choose(mode: 'create' | 'open') {
    setError(null)
    try {
      const picked = await window.inventory.pickFolder()
      if (!picked) return
      const inspection = await window.inventory.inspectFolder(picked)
      if (inspection.kind === 'newer-version') {
        setError('That folder was created by a newer version of this app.')
        return
      }
      if (inspection.kind === 'missing') {
        setError('That folder could not be opened.')
        return
      }
      if (inspection.kind === 'inventory') {
        const result = await window.inventory.setDataRoot(picked)
        if (!result.needsCreate) await onReady()
        return
      }
      if (mode === 'open' || inspection.hasEntries) {
        setPendingCreate(picked)
        if (mode === 'open') setError('That folder is not an inventory yet.')
        return
      }
      await createAt(picked)
    } catch (caught) {
      setError(errorMessage(caught, 'Could not use that folder'))
    }
  }

  return (
    <main className="onboarding">
      <section className="onboarding-card">
        <p className="eyebrow">Inventory</p>
        <h1>Keep the catalog in a folder you choose</h1>
        <p className="lede">
          Each product is stored in its own folder, with its photo beside it. Copy that folder to another computer,
          or upload it to Google Drive, then choose it here. The catalog comes back the same.
        </p>

        {settings.status === 'missing' && settings.dataRoot ? (
          <p className="callout">
            The inventory folder was not found at {settings.dataRoot}. If you moved it, choose that folder again.
          </p>
        ) : null}
        {settings.status === 'not-inventory' && settings.dataRoot ? (
          <p className="callout">The saved folder is no longer an inventory: {settings.dataRoot}</p>
        ) : null}
        {settings.status === 'newer-version' && settings.dataRoot ? (
          <p className="callout">
            This folder was written by a newer version of the app. Update the app before opening {settings.dataRoot}.
          </p>
        ) : null}

        <div className="form-grid">
          <label className="field">
            Shop name
            <input value={shopName} onChange={(event) => setShopName(event.target.value)} placeholder="Used for a new inventory" />
          </label>
          <label className="field">
            Currency
            <input
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              list="currencies"
              maxLength={3}
              placeholder="INR"
            />
            <span className="hint">3-letter code, such as INR.</span>
          </label>
        </div>

        <div className="onboarding-actions">
          <button type="button" className="button primary" onClick={() => void choose('create')} disabled={busy}>
            Create a new inventory folder
          </button>
          <button type="button" className="button" onClick={() => void choose('open')} disabled={busy}>
            Open an existing inventory folder
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>
      <CurrencyList />
      {pendingCreate ? (
        <ConfirmDialog
          title="Create an inventory here?"
          body="This folder is not an inventory yet. Existing files will be left in place, and an inventory file will be added."
          confirmLabel={busy ? 'Creating…' : 'Create inventory'}
          busy={busy}
          onCancel={() => setPendingCreate(null)}
          onConfirm={() => void createAt(pendingCreate)}
        />
      ) : null}
    </main>
  )
}

export function CurrencyList() {
  return (
    <datalist id="currencies">
      <option value="INR" />
      <option value="USD" />
      <option value="EUR" />
      <option value="GBP" />
      <option value="AED" />
      <option value="CAD" />
      <option value="AUD" />
    </datalist>
  )
}
