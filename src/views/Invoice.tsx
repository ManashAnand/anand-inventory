import { useEffect, useState } from 'react'
import letterhead from '../image.png'
import { formatMoney } from '../format'
import { paymentLabel, type InvoiceModel } from '../invoice'

export function Letterhead({ version }: { version: number }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [version])

  return (
    <img
      className="letterhead"
      alt="Anand Communication"
      src={failed ? letterhead : `inventory://shop/banner?v=${version}`}
      onError={() => setFailed(true)}
    />
  )
}

export function InvoiceSheet({
  model,
  currency,
  bannerVersion
}: {
  model: InvoiceModel
  currency: string
  bannerVersion: number
}) {
  return (
    <article className="invoice-sheet">
      <Letterhead version={bannerVersion} />
      <header className="invoice-head">
        <div>
          <h2>{model.shopName || 'Shop'}</h2>
          {model.address ? <p>{model.address}</p> : null}
          {model.phone ? <p>{model.phone}</p> : null}
          {model.email ? <p>{model.email}</p> : null}
        </div>
        <div className="invoice-meta">
          <h2>INVOICE</h2>
          <p>Invoice Number: {model.numberLabel}</p>
          <p>Date: {model.dateLabel}</p>
        </div>
      </header>
      <section className="invoice-party">
        <p className="invoice-label">Bill To:</p>
        <p>{model.customerName || 'Customer'}</p>
        {model.customerAddress ? <p>{model.customerAddress}</p> : null}
        {model.customerPhone ? <p>{model.customerPhone}</p> : null}
        {model.customerEmail ? <p>{model.customerEmail}</p> : null}
      </section>
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th className="num">Quantity</th>
            <th className="num">Price</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {model.items.length === 0 ? (
            <tr>
              <td className="muted">No items yet</td>
              <td className="num">0</td>
              <td className="num">{formatMoney(0, currency)}</td>
              <td className="num">{formatMoney(0, currency)}</td>
            </tr>
          ) : (
            model.items.map((item) => (
              <tr key={item.key}>
                <td>{item.title}</td>
                <td className="num">{item.quantity}</td>
                <td className="num">{formatMoney(item.unitPrice, currency)}</td>
                <td className="num">{formatMoney(item.lineTotal, currency)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="invoice-totals">
        <p>
          <span>Subtotal:</span>
          <strong>{formatMoney(model.subtotal, currency)}</strong>
        </p>
        <p>
          <span>Tax ({model.taxRate}%):</span>
          <strong>{formatMoney(model.taxAmount, currency)}</strong>
        </p>
        <p className="invoice-grand">
          <span>Total:</span>
          <strong>{formatMoney(model.total, currency)}</strong>
        </p>
        {model.paymentMode ? (
          <p>
            <span>Payment:</span>
            <strong>{paymentLabel(model.paymentMode)}</strong>
          </p>
        ) : null}
      </div>
      {model.notes ? <p className="invoice-notes">Notes: {model.notes}</p> : null}
    </article>
  )
}
