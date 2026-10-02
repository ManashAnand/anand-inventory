import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccessStatus, AppState } from '../shared/types'
import { errorMessage, folderLabel } from './format'
import { AccessGate, formatAccessDate } from './views/AccessGate'
import { Billing } from './views/Billing'
import { Library } from './views/Library'
import { Onboarding } from './views/Onboarding'
import { PastBills } from './views/PastBills'
import { ProductForm } from './views/ProductForm'
import { Settings } from './views/Settings'
import { Summary } from './views/Summary'

type Route =
  | { name: 'library' }
  | { name: 'settings' }
  | { name: 'summary' }
  | { name: 'bill'; nonce: number }
  | { name: 'history' }
  | { name: 'product'; nonce: number; folderName: string | null; brand?: string; category?: string }

function accessLabel(access: AccessStatus): string {
  if (access.state === 'trial') {
    return access.daysLeft === 1 ? '1 day left in the trial' : `${access.daysLeft ?? 0} days left in the trial`
  }
  if (access.plan === 'lifetime') return 'Lifetime access'
  if (access.expiresOn) return `Access until ${formatAccessDate(access.expiresOn)}`
  return 'Access on'
}

function isSamePlace(a: Route, b: Route) {
  if (a.name !== b.name) return false
  if (a.name === 'bill' && b.name === 'bill') return a.nonce === b.nonce
  if (a.name === 'product' && b.name === 'product') return a.nonce === b.nonce && a.folderName === b.folderName
  return true
}

function routeKey(entry: Route, index: number) {
  if (entry.name === 'bill') return `bill-${entry.nonce}`
  if (entry.name === 'product') return `product-${entry.folderName ?? 'new'}-${entry.nonce}`
  return `${entry.name}-${index}`
}

export function App() {
  const [settings, setSettings] = useState<AppState | null>(null)
  const [access, setAccess] = useState<AccessStatus | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [stack, setStack] = useState<Route[]>([{ name: 'library' }])
  const guard = useRef<((apply: () => void) => void) | null>(null)
  const route = stack[stack.length - 1]

  const refresh = useCallback(async () => {
    try {
      const next = await window.inventory.getSettings()
      setBootError(null)
      setSettings(next)
      if (next.status !== 'ready') setStack([{ name: 'library' }])
      return next
    } catch (caught) {
      setBootError(errorMessage(caught, 'Could not open the inventory'))
      return null
    }
  }, [])

  useEffect(() => {
    void window.inventory.getAccess().then(setAccess).catch((caught) => {
      setBootError(errorMessage(caught, 'Could not check access'))
    })
  }, [])

  useEffect(() => {
    if (!access || access.state === 'locked') return
    void refresh()
  }, [access, refresh])

  function go(next: Route) {
    const apply = () => {
      setStack((current) => {
        const top = current[current.length - 1]
        if (top && isSamePlace(top, next)) return current
        return [...current, next]
      })
    }
    if (guard.current) guard.current(apply)
    else apply()
  }

  function back() {
    const apply = () => {
      setStack((current) => (current.length > 1 ? current.slice(0, -1) : current))
    }
    if (guard.current) guard.current(apply)
    else apply()
  }

  function goHome() {
    const apply = () => setStack([{ name: 'library' }])
    if (guard.current) guard.current(apply)
    else apply()
  }

  useEffect(() => {
    if (!settings || settings.status !== 'ready') return
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        go({ name: 'product', nonce: Date.now(), folderName: null })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!access) return <div className="boot">{bootError ?? 'Opening inventory…'}</div>
  if (access.state === 'locked') return <AccessGate onUnlocked={setAccess} />
  if (!settings) return <div className="boot">{bootError ?? 'Opening inventory…'}</div>
  if (settings.status !== 'ready' || !settings.inventory || !settings.dataRoot) {
    return <Onboarding settings={settings} onReady={refresh} />
  }

  const inventory = settings.inventory
  const shopName = inventory.shopName.trim() || 'Inventory'
  const currency = inventory.currency
  const shortcutHint = window.inventory.platform === 'darwin' ? '⌘N' : 'Ctrl+N'

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-block">
          <span className="mark">In</span>
          <div>
            <p className="eyebrow light">Inventory</p>
            <strong>{shopName}</strong>
          </div>
        </div>
        <nav className="nav">
          <button type="button" className="nav-button" aria-current={route.name === 'library' ? 'page' : undefined} onClick={() => go({ name: 'library' })}>
            Products
          </button>
          <button type="button" className="nav-button" aria-current={route.name === 'bill' ? 'page' : undefined} onClick={() => go({ name: 'bill', nonce: Date.now() })}>
            New bill
          </button>
          <button type="button" className="nav-button" aria-current={route.name === 'history' ? 'page' : undefined} onClick={() => go({ name: 'history' })}>
            Past bills
          </button>
          <button type="button" className="nav-button" aria-current={route.name === 'summary' ? 'page' : undefined} onClick={() => go({ name: 'summary' })}>
            Summary
          </button>
          <button type="button" className="nav-button" aria-current={route.name === 'settings' ? 'page' : undefined} onClick={() => go({ name: 'settings' })}>
            Settings
          </button>
        </nav>
        <button type="button" className="button sidebar-new" onClick={() => go({ name: 'product', nonce: Date.now(), folderName: null })}>
          New product <span className="shortcut">{shortcutHint}</span>
        </button>
        <p className="sidebar-path">{accessLabel(access)}</p>
        <p className="sidebar-path">{folderLabel(settings.dataRoot)}</p>
      </aside>
      <main className="content">
        {stack.map((entry, index) => {
          const active = index === stack.length - 1
          return (
            <div key={routeKey(entry, index)} hidden={!active}>
              {entry.name === 'library' ? (
                <Library
                  currency={currency}
                  active={active}
                  onOpen={(folderName) => go({ name: 'product', nonce: Date.now(), folderName })}
                  onCreate={() => go({ name: 'product', nonce: Date.now(), folderName: null })}
                  onBill={() => go({ name: 'bill', nonce: Date.now() })}
                  onBack={index > 0 ? back : undefined}
                />
              ) : null}
              {entry.name === 'history' ? (
                <PastBills inventory={inventory} currency={currency} active={active} onBack={back} />
              ) : null}
              {entry.name === 'summary' ? <Summary shopName={shopName} currency={currency} active={active} onBack={back} /> : null}
              {entry.name === 'settings' ? <Settings settings={settings} onChanged={refresh} onBack={back} onAccess={setAccess} /> : null}
              {entry.name === 'bill' ? (
                <Billing
                  inventory={inventory}
                  currency={currency}
                  guard={guard}
                  active={active}
                  onBack={back}
                  onHistory={() => go({ name: 'history' })}
                  onShopChanged={refresh}
                />
              ) : null}
              {entry.name === 'product' ? (
                <ProductForm
                  folderName={entry.folderName}
                  initialBrand={entry.brand}
                  initialCategory={entry.category}
                  guard={guard}
                  active={active}
                  onBack={back}
                  onHome={goHome}
                />
              ) : null}
            </div>
          )
        })}
      </main>
    </div>
  )
}
