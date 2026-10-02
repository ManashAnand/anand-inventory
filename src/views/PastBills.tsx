import { useEffect, useMemo, useState } from 'react'
import type { Bill, BillLine, InventoryMeta, ProductSummary } from '../../shared/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { billDayKey, errorMessage, formatBillNumber, formatInvoiceNumber, formatMoney, stockRestoreMessage } from '../format'
import { invoiceCsv, modelFromBill, whatsAppText } from '../invoice'
import { salesSummary } from '../summary'
import { InvoiceSheet } from './Invoice'

type AmountOp = 'any' | 'gt' | 'lt' | 'eq'

export function PastBills({
  inventory,
  currency,
  active,
  onBack
}: {
  inventory: InventoryMeta
  currency: string
  active: boolean
  onBack: () => void
}) {
  const [bills, setBills] = useState<Bill[]>([])
  const [products, setProducts] = useState<ProductSummary[]>([])
  const [productQuery, setProductQuery] = useState('')
  const [amountOp, setAmountOp] = useState<AmountOp>('any')
  const [amountText, setAmountText] = useState('')
  const [day, setDay] = useState('')
  const [selected, setSelected] = useState<Bill | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Bill | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    Promise.all([window.inventory.listBills(), window.inventory.listProducts()])
      .then(([nextBills, nextProducts]) => {
        if (!cancelled) {
          setBills(nextBills)
          setProducts(nextProducts.products)
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught, 'Could not read past bills'))
      })
    return () => {
      cancelled = true
    }
  }, [active])

  const filtered = useMemo(() => {
    const needle = productQuery.trim().toLowerCase()
    const amount = Number(amountText)
    const hasAmount = amountOp !== 'any' && amountText.trim() !== '' && Number.isFinite(amount)
    return bills.filter((bill) => {
      if (day && billDayKey(bill.createdAt) !== day) return false
      if (needle && !bill.items.some((item) => item.title.toLowerCase().includes(needle) || item.sku.toLowerCase().includes(needle))) {
        return false
      }
      if (!hasAmount) return true
      if (amountOp === 'gt') return bill.total > amount
      if (amountOp === 'lt') return bill.total < amount
      return Math.abs(bill.total - amount) < 0.001
    })
  }, [amountOp, amountText, bills, day, productQuery])

  const summary = useMemo(() => {
    const needle = productQuery.trim().toLowerCase()
    let units = 0
    let amount = 0
    for (const bill of filtered) {
      for (const item of bill.items) {
        if (needle && !item.title.toLowerCase().includes(needle) && !item.sku.toLowerCase().includes(needle)) continue
        units += item.quantity
        amount += item.lineTotal
      }
    }
    return { units, amount }
  }, [filtered, productQuery])

  const categoryOf = useMemo(() => {
    const byFolder = new Map(products.map((product) => [product.folderName, product.category]))
    return (line: BillLine) => line.category.trim() || byFolder.get(line.folderName) || ''
  }, [products])

  const groups = useMemo(() => {
    const grouped = new Map<string, Bill[]>()
    for (const bill of filtered) {
      const key = billDayKey(bill.createdAt)
      const list = grouped.get(key) ?? []
      list.push(bill)
      grouped.set(key, list)
    }
    return [...grouped.entries()]
  }, [filtered])

  async function confirmDelete() {
    if (!pendingDelete || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.inventory.deleteBill(pendingDelete.number)
      setBills((current) => current.filter((bill) => bill.number !== pendingDelete.number))
      if (selected?.number === pendingDelete.number) setSelected(null)
      setPendingDelete(null)
      setNotice(stockRestoreMessage(result))
    } catch (caught) {
      setError(errorMessage(caught, 'Could not delete the bill'))
    } finally {
      setBusy(false)
    }
  }

  const needle = productQuery.trim()
  const billLabel = `${filtered.length} ${filtered.length === 1 ? 'bill' : 'bills'}`
  const unitLabel = `${summary.units} ${summary.units === 1 ? 'unit' : 'units'}`
  const summaryText = needle
    ? `${billLabel} · ${unitLabel} matching “${needle}” · ${formatMoney(summary.amount, currency)}`
    : `${billLabel} · ${unitLabel} · ${formatMoney(summary.amount, currency)}`

  return (
    <section className="page">
      <header className="page-header no-print">
        <div>
          <button type="button" className="text-button" onClick={onBack}>
            ← Back
          </button>
          <h1>Past bills</h1>
          <p className="muted">Each day has its own folder in the inventory, with one file per bill and a log.txt for that day.</p>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="form-note">{notice}</p> : null}

      {selected ? (
        <SelectedBill
          bill={selected}
          inventory={inventory}
          currency={currency}
          onBack={() => setSelected(null)}
          onDelete={() => setPendingDelete(selected)}
          onError={setError}
        />
      ) : (
        <>
          <div className="bill-filters no-print">
            <label className="field">
              Product
              <input
                value={productQuery}
                onChange={(event) => setProductQuery(event.target.value)}
                placeholder="Charger, SKU…"
              />
            </label>
            <label className="field">
              Bill total
              <select value={amountOp} onChange={(event) => setAmountOp(event.target.value as AmountOp)}>
                <option value="any">Any amount</option>
                <option value="gt">Greater than</option>
                <option value="lt">Less than</option>
                <option value="eq">Exactly</option>
              </select>
            </label>
            <label className="field">
              Amount
              <input
                inputMode="decimal"
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
                placeholder="50"
                disabled={amountOp === 'any'}
              />
            </label>
            <label className="field">
              Date
              <input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
            </label>
          </div>

          <p className="callout">{summaryText}</p>

          {bills.length === 0 ? <p className="muted">No bills yet. Generate one from New bill.</p> : null}
          {bills.length > 0 && filtered.length === 0 ? <p className="muted">No bills match these filters.</p> : null}

          {groups.map(([key, items]) => {
            const dayBills = bills.filter((bill) => billDayKey(bill.createdAt) === key)
            const daySales = salesSummary(dayBills, categoryOf)
            return (
            <section className="day-group" key={key}>
              <h2>{dayLabel(key)}</h2>
              <div className="bill-history">
                {items.map((bill) => (
                  <div className="history-row" key={bill.id}>
                    <button type="button" className="picker-item" onClick={() => setSelected(bill)}>
                      <span>
                        {formatBillNumber(bill.number)}
                        {bill.customerName ? ` · ${bill.customerName}` : ''}
                      </span>
                      <span>{bill.items.map((item) => `${item.title} × ${item.quantity}`).join(', ')}</span>
                      <span className="muted">
                        {formatMoney(bill.total, currency)} · {new Date(bill.createdAt).toLocaleTimeString()}
                      </span>
                    </button>
                    <button type="button" className="button danger" onClick={() => setPendingDelete(bill)}>
                      Delete
                    </button>
                  </div>
                ))}
              </div>
              <div className="day-total">
                <strong>Day total {formatMoney(daySales.amount, currency)}</strong>
                <span>
                  {daySales.categories
                    .map((category) => `${category.name} ${formatMoney(category.amount, currency)}`)
                    .join(' · ')}
                  {dayBills.length === items.length ? '' : ' · includes bills hidden by the filters'}
                </span>
              </div>
            </section>
            )
          })}
        </>
      )}

      {pendingDelete ? (
        <ConfirmDialog
          title={`Delete bill ${formatBillNumber(pendingDelete.number)}?`}
          body="The quantities on this bill go back into stock."
          confirmLabel="Delete bill"
          danger
          busy={busy}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </section>
  )
}

function SelectedBill({
  bill,
  inventory,
  currency,
  onBack,
  onDelete,
  onError
}: {
  bill: Bill
  inventory: InventoryMeta
  currency: string
  onBack: () => void
  onDelete: () => void
  onError: (message: string) => void
}) {
  const model = modelFromBill(bill, inventory)
  return (
    <>
      <InvoiceSheet model={model} currency={currency} bannerVersion={0} />
      <div className="invoice-actions no-print">
        <button type="button" className="button" onClick={onBack}>
          ← Past bills
        </button>
        <button
          type="button"
          className="button"
          onClick={() => void window.inventory.exportCsv(formatInvoiceNumber(bill.number), invoiceCsv(model)).catch((caught) => onError(errorMessage(caught, 'Could not export this bill')))}
        >
          Export to Excel
        </button>
        <button
          type="button"
          className="button"
          onClick={() => void window.inventory.exportPdf(formatInvoiceNumber(bill.number)).catch((caught) => onError(errorMessage(caught, 'Could not create the PDF')))}
        >
          Download PDF
        </button>
        <button
          type="button"
          className="button"
          onClick={() => void window.inventory.shareWhatsApp(whatsAppText(model, currency)).catch((caught) => onError(errorMessage(caught, 'Could not open WhatsApp')))}
        >
          Share to WhatsApp
        </button>
        <button type="button" className="button danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </>
  )
}

function dayLabel(key: string): string {
  if (key === 'unknown-date') return 'Unknown date'
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}
