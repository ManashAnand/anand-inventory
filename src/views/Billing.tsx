import { useEffect, useMemo, useState } from 'react'
import type { Bill, InventoryMeta, ProductSummary } from '../../shared/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { errorMessage, formatInvoiceNumber, formatMoney, stockCount, stockLabel, stockRestoreMessage, todayInputDate } from '../format'
import { billTotals, filledContact, invoiceCsv, paymentModes, shopContactDefaults, taxRates, whatsAppText, type InvoiceModel } from '../invoice'
import { InvoiceSheet } from './Invoice'

interface BillLineDraft {
  folderName: string
  title: string
  sku: string
  price: string
  units: number
  quantity: number
}

export function Billing({
  inventory,
  currency,
  guard,
  active,
  onBack,
  onHistory,
  onShopChanged
}: {
  inventory: InventoryMeta
  currency: string
  guard: { current: ((apply: () => void) => void) | null }
  active: boolean
  onBack: () => void
  onHistory: () => void
  onShopChanged: () => Promise<unknown>
}) {
  const [products, setProducts] = useState<ProductSummary[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [billsReady, setBillsReady] = useState(false)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [shopName, setShopName] = useState(inventory.shopName)
  const [address, setAddress] = useState(filledContact(inventory.address, shopContactDefaults.address))
  const [phone, setPhone] = useState(filledContact(inventory.phone, shopContactDefaults.phone))
  const [email, setEmail] = useState(filledContact(inventory.email, shopContactDefaults.email))
  const [issuedOn, setIssuedOn] = useState(todayInputDate)
  const [customerName, setCustomerName] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [taxRate, setTaxRate] = useState(0)
  const [paymentMode, setPaymentMode] = useState('Cash')
  const [lines, setLines] = useState<BillLineDraft[]>([])
  const [receipt, setReceipt] = useState<Bill | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const bannerVersion = 0

  async function reload() {
    const [productList, billList] = await Promise.all([window.inventory.listProducts(), window.inventory.listBills()])
    setProducts(productList.products)
    setBills(billList)
    setBillsReady(true)
  }

  useEffect(() => {
    if (!active) return
    let cancelled = false
    reload().catch((caught) => {
      if (!cancelled) setError(errorMessage(caught, 'Could not open billing'))
    })
    return () => {
      cancelled = true
    }
  }, [active])

  useEffect(() => {
    if (!active) return
    guard.current = (apply) => {
      if (lines.length === 0 || receipt) {
        apply()
        return
      }
      setPendingLeave(() => apply)
    }
    return () => {
      guard.current = null
    }
  }, [guard, active, lines.length, receipt])

  const nextNumber = bills.reduce((max, bill) => Math.max(max, bill.number), 0) + 1
  const visibleProducts = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return products
    return products.filter((product) =>
      [product.title, product.brand, product.sku].some((value) => value.toLowerCase().includes(needle))
    )
  }, [products, query])

  const draftModel = useMemo<InvoiceModel>(() => {
    const priced = lines.map((line) => ({
      key: line.folderName,
      title: line.title,
      quantity: line.quantity,
      unitPrice: parsePrice(line.price),
      lineTotal: Math.round(parsePrice(line.price) * line.quantity * 100) / 100
    }))
    const totals = billTotals(priced, taxRate)
    return {
      numberLabel: formatInvoiceNumber(receipt?.number ?? nextNumber),
      dateLabel: new Date(`${issuedOn}T00:00:00`).toLocaleDateString(),
      shopName,
      address,
      phone,
      email,
      customerName,
      customerAddress,
      customerPhone,
      customerEmail,
      notes,
      paymentMode,
      taxRate,
      items: priced,
      ...totals
    }
  }, [
    address,
    customerAddress,
    customerEmail,
    customerName,
    customerPhone,
    email,
    issuedOn,
    lines,
    nextNumber,
    notes,
    paymentMode,
    phone,
    receipt?.number,
    shopName,
    taxRate
  ])

  const previewModel = receipt
    ? {
        numberLabel: formatInvoiceNumber(receipt.number),
        dateLabel: new Date(receipt.createdAt).toLocaleDateString(),
        shopName: receipt.shopName || shopName,
        address: receipt.shopAddress || address,
        phone: receipt.shopPhone || phone,
        email: receipt.shopEmail || email,
        customerName: receipt.customerName,
        customerAddress: receipt.customerAddress,
        customerPhone: receipt.customerPhone,
        customerEmail: receipt.customerEmail,
        notes: receipt.notes,
        paymentMode: receipt.paymentMode,
        taxRate: receipt.taxRate,
        items: receipt.items.map((item) => ({
          key: `${item.folderName}-${item.productId}`,
          title: item.title,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal
        })),
        subtotal: receipt.subtotal,
        taxAmount: receipt.taxAmount,
        total: receipt.total
      }
    : draftModel

  function addProduct(product: ProductSummary) {
    setError(null)
    setReceipt(null)
    setTab('edit')
    setLines((current) => {
      const existing = current.find((line) => line.folderName === product.folderName)
      const available = stockCount(product.units)
      if (available < 1) return current
      if (existing) {
        if (existing.quantity >= available) return current
        return current.map((line) =>
          line.folderName === product.folderName ? { ...line, quantity: line.quantity + 1, units: available } : line
        )
      }
      return [
        ...current,
        {
          folderName: product.folderName,
          title: product.title,
          sku: product.sku,
          price: String(product.sellingPrice),
          units: available,
          quantity: 1
        }
      ]
    })
  }

  function setQuantity(folderName: string, raw: string) {
    const digits = raw.replace(/[^\d]/g, '')
    setLines((current) =>
      current.map((line) => {
        if (line.folderName !== folderName) return line
        if (!digits) return { ...line, quantity: 1 }
        return { ...line, quantity: Math.min(line.units, Math.max(1, Number(digits))) }
      })
    )
  }

  async function shareCurrent(model: InvoiceModel) {
    setError(null)
    try {
      if (model.items.length === 0) throw new Error('Add a product before sharing')
      await window.inventory.shareWhatsApp(whatsAppText(model, currency))
    } catch (caught) {
      setError(errorMessage(caught, 'Could not open WhatsApp'))
    }
  }

  async function exportCurrent(model: InvoiceModel) {
    setError(null)
    try {
      if (model.items.length === 0) throw new Error('Add a product before exporting')
      await window.inventory.exportCsv(model.numberLabel, invoiceCsv(model))
    } catch (caught) {
      setError(errorMessage(caught, 'Could not export this bill'))
    }
  }

  async function downloadPdf(model: InvoiceModel) {
    setError(null)
    try {
      if (model.items.length === 0) throw new Error('Add a product before downloading')
      await window.inventory.exportPdf(model.numberLabel)
    } catch (caught) {
      setError(errorMessage(caught, 'Could not create the PDF'))
    }
  }

  async function generate() {
    if (lines.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const bill = await window.inventory.createBill({
        customerName,
        customerAddress,
        customerPhone,
        customerEmail,
        notes,
        paymentMode,
        taxRate,
        issuedOn,
        shopName,
        shopAddress: address,
        shopPhone: phone,
        shopEmail: email,
        items: lines.map((line) => ({
          folderName: line.folderName,
          quantity: line.quantity,
          unitPrice: parsePrice(line.price)
        }))
      })
      await window.inventory
        .updateSettings({ shopName, currency, address, phone, email })
        .then(() => onShopChanged())
        .catch(() => undefined)
      setReceipt(bill)
      setLines([])
      setCustomerName('')
      setCustomerAddress('')
      setCustomerPhone('')
      setCustomerEmail('')
      setNotes('')
      setTab('preview')
      setNotice('Saved. Stock has been reduced by the quantities on this bill.')
      await reload().catch(() => undefined)
    } catch (caught) {
      setError(errorMessage(caught, 'Could not save the bill'))
    } finally {
      setBusy(false)
    }
  }

  async function removeReceipt() {
    if (!receipt || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.inventory.deleteBill(receipt.number)
      setReceipt(null)
      setPendingDelete(false)
      setTab('edit')
      setNotice(stockRestoreMessage(result))
      await reload().catch(() => undefined)
    } catch (caught) {
      setError(errorMessage(caught, 'Could not delete the bill'))
    } finally {
      setBusy(false)
    }
  }

  function startAnother() {
    setReceipt(null)
    setNotice(null)
    setTab('edit')
    setIssuedOn(todayInputDate())
  }

  const showingForm = !receipt && tab === 'edit'

  return (
    <section className="page">
      <header className="page-header no-print">
        <div>
          <button type="button" className="text-button" onClick={onBack}>
            ← Back
          </button>
          <h1>{shopName.trim() || 'New bill'}</h1>
          <p className="muted">Items come from stock. Saving the bill subtracts the quantity you sell.</p>
        </div>
      </header>
      {error ? <p className="form-error no-print">{error}</p> : null}
      {notice ? <p className="form-note no-print">{notice}</p> : null}

      <div className="bill-tabs no-print">
        <button type="button" className={tab === 'edit' && !receipt ? 'active' : ''} onClick={() => { if (receipt) startAnother(); else setTab('edit') }}>
          Edit bill
        </button>
        <button type="button" className={tab === 'preview' || receipt ? 'active' : ''} onClick={() => setTab('preview')}>
          Preview
        </button>
      </div>

      <div className={showingForm ? 'screen-hidden' : undefined}>
        <InvoiceSheet model={previewModel} currency={currency} bannerVersion={bannerVersion} />
      </div>

      {showingForm ? (
        <div className="invoice-editor no-print">
          <div className="invoice-columns">
            <section>
              <h2>Company information</h2>
              <label className="field">
                Company name
                <input value={shopName} onChange={(event) => setShopName(event.target.value)} />
              </label>
              <label className="field">
                Company address
                <textarea rows={3} value={address} onChange={(event) => setAddress(event.target.value)} />
              </label>
              <div className="form-grid">
                <label className="field">
                  Phone
                  <input value={phone} onChange={(event) => setPhone(event.target.value)} />
                </label>
                <label className="field">
                  Email
                  <input value={email} onChange={(event) => setEmail(event.target.value)} />
                </label>
              </div>
            </section>
            <section>
              <h2>Bill information</h2>
              <div className="form-grid">
                <div className="field">
                  Invoice number
                  <p className="invoice-number">{billsReady ? formatInvoiceNumber(nextNumber) : '…'}</p>
                  <span className="hint">Assigned automatically when you save. Each bill gets the next number.</span>
                </div>
                <label className="field">
                  Date
                  <input type="date" value={issuedOn} onChange={(event) => setIssuedOn(event.target.value)} />
                </label>
              </div>
              <label className="field">
                Customer name
                <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Customer name" />
              </label>
              <label className="field">
                Customer address
                <textarea rows={3} value={customerAddress} onChange={(event) => setCustomerAddress(event.target.value)} placeholder="Customer address" />
              </label>
              <div className="form-grid">
                <label className="field">
                  Phone
                  <input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Phone number" />
                </label>
                <label className="field">
                  Email
                  <input value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} placeholder="Email address" />
                </label>
              </div>
            </section>
          </div>

          <div className="items-head">
            <h2>Items</h2>
            <p className="muted">Add a product from stock. The price starts from its selling price and can be changed on this bill.</p>
          </div>
          <div className="item-table">
            <div className="item-row item-head">
              <span>Description</span>
              <span>Quantity</span>
              <span>Price</span>
              <span>Amount</span>
              <span />
            </div>
            {lines.length === 0 ? <p className="muted">No products on this bill yet.</p> : null}
            {lines.map((line) => (
              <div className="item-row" key={line.folderName}>
                <div>
                  <strong>{line.title}</strong>
                  <p className="muted">{line.sku ? `${line.sku} · ` : ''}{stockLabel(line.units)}</p>
                </div>
                <input
                  inputMode="numeric"
                  aria-label={`${line.title} quantity`}
                  value={String(line.quantity)}
                  onChange={(event) => setQuantity(line.folderName, event.target.value)}
                />
                <input
                  inputMode="decimal"
                  aria-label={`${line.title} price`}
                  value={line.price}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((item) =>
                        item.folderName === line.folderName ? { ...item, price: event.target.value.replace(/[^\d.]/g, '') } : item
                      )
                    )
                  }
                />
                <strong>{formatMoney(parsePrice(line.price) * line.quantity, currency)}</strong>
                <button
                  type="button"
                  className="text-button danger-text"
                  onClick={() => setLines((current) => current.filter((item) => item.folderName !== line.folderName))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="add-item">
            <label className="field">
              Add item from stock
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, brand, or SKU" />
            </label>
            <div className="picker">
              {visibleProducts.length === 0 ? <p className="muted">No products to add.</p> : null}
              {visibleProducts.map((product) => {
                const onBill = lines.find((line) => line.folderName === product.folderName)
                const available = stockCount(product.units)
                const soldOut = available < 1 || (onBill?.quantity ?? 0) >= available
                return (
                  <button type="button" className="picker-item" key={product.folderName} onClick={() => addProduct(product)} disabled={soldOut}>
                    <span>{product.title}</span>
                    <span className={available === 0 ? 'stock-out' : 'muted'}>
                      {formatMoney(product.sellingPrice, currency)} · {stockLabel(product.units)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="invoice-columns">
            <label className="field">
              Notes
              <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Additional notes or payment instructions" />
            </label>
            <div>
              <label className="field">
                Tax rate
                <select value={String(taxRate)} onChange={(event) => setTaxRate(Number(event.target.value))}>
                  {taxRates.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}% GST
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Payment mode
                <select value={paymentMode} onChange={(event) => setPaymentMode(event.target.value)}>
                  {paymentModes.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>
      ) : null}

      <div className="invoice-actions no-print">
        {receipt ? (
          <button type="button" className="button" onClick={startAnother}>
            New bill
          </button>
        ) : (
          <button type="button" className="button primary" onClick={() => void generate()} disabled={busy || lines.length === 0}>
            {busy ? 'Saving…' : 'Save bill'}
          </button>
        )}
        <button type="button" className="button" onClick={() => void exportCurrent(previewModel)}>
          Export to Excel
        </button>
        <button type="button" className="button" onClick={() => void downloadPdf(previewModel)}>
          Download PDF
        </button>
        <button type="button" className="button" onClick={() => void shareCurrent(previewModel)}>
          Share to WhatsApp
        </button>
        {receipt ? (
          <button type="button" className="button danger" onClick={() => setPendingDelete(true)}>
            Delete
          </button>
        ) : null}
        <button type="button" className="button" onClick={onHistory}>
          Past bills
        </button>
      </div>
      {!receipt ? (
        <p className="muted no-print invoice-stock-note">
          Subtotal {formatMoney(draftModel.subtotal, currency)} · Tax {formatMoney(draftModel.taxAmount, currency)} · Total{' '}
          {formatMoney(draftModel.total, currency)}
        </p>
      ) : (
        <p className="muted no-print invoice-stock-note">Stock has been reduced by the quantities on this bill.</p>
      )}

      {pendingDelete && receipt ? (
        <ConfirmDialog
          title={`Delete ${formatInvoiceNumber(receipt.number)}?`}
          body="The quantities on this bill go back into stock."
          confirmLabel="Delete bill"
          danger
          busy={busy}
          onCancel={() => setPendingDelete(false)}
          onConfirm={() => void removeReceipt()}
        />
      ) : null}

      {pendingLeave ? (
        <ConfirmDialog
          title="Leave this bill?"
          body="The products on this bill have not been sold yet, so stock will stay the same."
          confirmLabel="Leave"
          danger
          onCancel={() => setPendingLeave(null)}
          onConfirm={() => {
            const leave = pendingLeave
            setPendingLeave(null)
            setLines([])
            leave()
          }}
        />
      ) : null}
    </section>
  )
}

function parsePrice(value: string): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return 0
  return number
}
