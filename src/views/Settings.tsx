import { useEffect, useState } from 'react'
import type { AccessStatus, AppState } from '../../shared/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { errorMessage } from '../format'
import { filledContact, shopContactDefaults } from '../invoice'
import { AccessCodeForm } from './AccessGate'
import { Letterhead } from './Invoice'
import { CurrencyList } from './Onboarding'

export function Settings({
  settings,
  onChanged,
  onBack,
  onAccess
}: {
  settings: AppState
  onChanged: () => Promise<unknown>
  onBack: () => void
  onAccess: (status: AccessStatus) => void
}) {
  const [shopName, setShopName] = useState(settings.inventory?.shopName ?? '')
  const [currency, setCurrency] = useState(settings.inventory?.currency ?? 'INR')
  const [address, setAddress] = useState(filledContact(settings.inventory?.address, shopContactDefaults.address))
  const [phone, setPhone] = useState(filledContact(settings.inventory?.phone, shopContactDefaults.phone))
  const [email, setEmail] = useState(filledContact(settings.inventory?.email, shopContactDefaults.email))
  const [bannerVersion, setBannerVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingCreate, setPendingCreate] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setShopName(settings.inventory?.shopName ?? '')
    setCurrency(settings.inventory?.currency ?? 'INR')
    if (settings.inventory?.address?.trim()) setAddress(settings.inventory.address)
    if (settings.inventory?.phone?.trim()) setPhone(settings.inventory.phone)
    if (settings.inventory?.email?.trim()) setEmail(settings.inventory.email)
  }, [settings.inventory?.shopName, settings.inventory?.currency, settings.inventory?.address, settings.inventory?.phone, settings.inventory?.email])

  async function saveShop() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await window.inventory.updateSettings({ shopName, currency, address, phone, email })
      setNotice('Shop settings saved in the inventory folder.')
      await onChanged()
    } catch (caught) {
      setError(errorMessage(caught, 'Could not save settings'))
    } finally {
      setBusy(false)
    }
  }

  async function changeFolder() {
    setError(null)
    setNotice(null)
    try {
      const picked = await window.inventory.pickFolder()
      if (!picked) return
      const result = await window.inventory.setDataRoot(picked)
      if (result.needsCreate) {
        setPendingCreate(picked)
        return
      }
      setNotice('Opened that inventory folder.')
      await onChanged()
    } catch (caught) {
      setError(errorMessage(caught, 'Could not switch folders'))
    }
  }

  async function createThere() {
    if (!pendingCreate) return
    setBusy(true)
    setError(null)
    try {
      await window.inventory.createInventory(pendingCreate, {
        shopName: shopName || settings.inventory?.shopName || '',
        currency: currency || settings.inventory?.currency || 'INR',
        address,
        phone,
        email
      })
      setPendingCreate(null)
      setNotice('Created an inventory in that folder.')
      await onChanged()
    } catch (caught) {
      setError(errorMessage(caught, 'Could not create an inventory there'))
    } finally {
      setBusy(false)
    }
  }

  const revealLabel = window.inventory.platform === 'darwin' ? 'Show in Finder' : 'Show in File Explorer'

  return (
    <section className="page settings-page">
      <header className="page-header">
        <div>
          <button type="button" className="text-button" onClick={onBack}>
            ← Back
          </button>
          <h1>Settings</h1>
          <p className="muted">The folder location is saved on this computer. The catalog itself stays in the folder.</p>
        </div>
      </header>

      <div className="settings-stack">
        <section className="panel">
          <h2>Inventory folder</h2>
          <p className="path">{settings.dataRoot}</p>
          <div className="row-actions">
            <button type="button" className="button" onClick={() => void changeFolder()}>
              Change folder
            </button>
            <button
              type="button"
              className="button"
              onClick={() => void window.inventory.revealFolder().catch((caught) => setError(errorMessage(caught, 'Could not reveal the folder')))}
            >
              {revealLabel}
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Shop</h2>
          <div className="form-grid">
            <label className="field">
              Shop name
              <input value={shopName} onChange={(event) => setShopName(event.target.value)} placeholder="My shop" />
            </label>
            <label className="field">
              Address
              <textarea rows={3} value={address} onChange={(event) => setAddress(event.target.value)} />
            </label>
            <label className="field">
              Phone
              <input value={phone} onChange={(event) => setPhone(event.target.value)} />
            </label>
            <label className="field">
              Email
              <input value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="field">
              Currency
              <input
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                list="currencies"
                maxLength={3}
              />
              <span className="hint">3-letter code, such as INR.</span>
            </label>
          </div>
          <div className="letterhead-frame">
            <Letterhead version={bannerVersion} />
          </div>
          <label className="button file-button">
            Change banner
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                const sourcePath = window.inventory.getPathForFile(file)
                void window.inventory
                  .setBanner(sourcePath)
                  .then(() => {
                    setBannerVersion(Date.now())
                    setNotice('Banner saved in the inventory folder.')
                  })
                  .catch((caught) => setError(errorMessage(caught, 'Could not save the banner')))
              }}
            />
          </label>
          <div className="row-actions">
            <button type="button" className="button primary" onClick={() => void saveShop()} disabled={busy}>
              Save shop settings
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Access code</h2>
          <p className="muted">A signed code turns on a 10-day trial, 1 month, 3 months, or lifetime access. The inventory folder stays where it is.</p>
          <AccessCodeForm onUnlocked={onAccess} />
        </section>

        <section className="panel">
          <h2>Another computer</h2>
          <p>
            Copy this folder, or put it in Google Drive. On the new computer, install the app and choose the same
            folder. Shop name, stock, prices, and photos are inside it. Bills are grouped by date, with a log for each day, so the inventory looks the same.
          </p>
        </section>
      </div>

      {notice ? <p className="form-note">{notice}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      <CurrencyList />
      {pendingCreate ? (
        <ConfirmDialog
          title="Create an inventory here?"
          body="This folder is not an inventory yet. Existing files will be left in place, and an inventory file will be added."
          confirmLabel={busy ? 'Creating…' : 'Create inventory'}
          busy={busy}
          onCancel={() => setPendingCreate(null)}
          onConfirm={() => void createThere()}
        />
      ) : null}
    </section>
  )
}
