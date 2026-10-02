import { useEffect, useMemo, useState } from 'react'
import type { Bill, BillLine, ProductSummary } from '../../shared/types'
import { mediaUrl } from '../../shared/mediaUrl'
import { SummaryBoard } from '../components/SummaryBoard'
import { billDayKey, errorMessage, formatMoney, todayInputDate } from '../format'
import { billsInMonth, groupByCategory, monthKeyFromDay, monthLabel, salesSummary, stockSummary } from '../summary'

export function Summary({
  shopName,
  currency,
  active,
  onBack
}: {
  shopName: string
  currency: string
  active: boolean
  onBack: () => void
}) {
  const [products, setProducts] = useState<ProductSummary[] | null>(null)
  const [bills, setBills] = useState<Bill[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    Promise.all([window.inventory.listProducts(), window.inventory.listBills()])
      .then(([nextProducts, nextBills]) => {
        if (cancelled) return
        setProducts(nextProducts.products)
        setBills(nextBills)
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught, 'Could not build the summary'))
      })
    return () => {
      cancelled = true
    }
  }, [active])

  const stock = useMemo(() => stockSummary(products ?? []), [products])
  const categoryOf = useMemo(() => {
    const byFolder = new Map((products ?? []).map((product) => [product.folderName, product.category]))
    return (line: BillLine) => line.category.trim() || byFolder.get(line.folderName) || ''
  }, [products])
  const monthKey = monthKeyFromDay(todayInputDate())
  const monthBills = useMemo(() => billsInMonth(bills, monthKey), [bills, monthKey])
  const monthSales = useMemo(() => salesSummary(monthBills, categoryOf), [monthBills, categoryOf])
  const days = useMemo(() => {
    const grouped = new Map<string, Bill[]>()
    for (const bill of monthBills) {
      const key = billDayKey(bill.createdAt)
      const list = grouped.get(key) ?? []
      list.push(bill)
      grouped.set(key, list)
    }
    return [...grouped.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [monthBills])

  const catalog = useMemo(
    () => groupByCategory(products ?? []),
    [products]
  )
  const unitLabel = `${stock.units} ${stock.units === 1 ? 'unit' : 'units'}`
  const stockRows = stock.categories
    .filter((category) => category.units > 0)
    .map((category) => [
      category.name,
      String(category.units),
      formatMoney(category.stockValue, currency),
      formatMoney(category.purchasing, currency)
    ])

  return (
    <section className="page">
      <header className="page-header no-print">
        <div>
          <button type="button" className="text-button" onClick={onBack}>
            ← Back
          </button>
          <h1>Summary</h1>
          <p className="muted">Stock on hand, and what has been billed this month, split by category.</p>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}
      {products === null && !error ? <p className="muted">Reading the inventory…</p> : null}

      {products ? (
        <>
          <div className="no-print">
          <h2 className="summary-heading">Stock</h2>
          <SummaryBoard
            figures={[
              { label: 'Stock value', value: formatMoney(stock.stockValue, currency) },
              { label: 'Purchasing total', value: formatMoney(stock.purchasing, currency) },
              { label: 'On hand', value: unitLabel }
            ]}
            caption="Stock value is the selling price of what is still in stock. Purchasing total is what that stock cost."
            headers={['Category', 'Units', 'Stock value', 'Purchasing']}
            rows={stockRows}
          />

          <h2 className="summary-heading">{monthLabel(monthKey)}</h2>
          <SummaryBoard
            figures={[
              { label: 'Billed', value: formatMoney(monthSales.amount, currency) },
              { label: 'Bills', value: String(monthSales.bills) },
              { label: 'Units sold', value: String(monthSales.units) }
            ]}
            caption="Category amounts include each category’s share of GST, so they add up to the month total."
            headers={['Category', 'Units', 'Billed']}
            rows={monthSales.categories.map((category) => [
              category.name,
              String(category.units),
              formatMoney(category.amount, currency)
            ])}
          />

          <h2 className="summary-heading">Each day</h2>
          {days.length === 0 ? <p className="muted">No bills this month yet.</p> : null}
          {days.map(([key, items]) => {
            const daySales = salesSummary(items, categoryOf)
            return (
              <div className="day-total" key={key}>
                <strong>
                  {dayLabel(key)} · {formatMoney(daySales.amount, currency)}
                </strong>
                <span>{daySales.categories.map((category) => `${category.name} ${formatMoney(category.amount, currency)}`).join(' · ')}</span>
              </div>
            )
          })}
          </div>

          <div className="catalog-toolbar no-print">
            <h2 className="summary-heading">Price list</h2>
            <button
              type="button"
              className="button"
              onClick={() =>
                void window.inventory.exportPdf(`${shopName} price list`).catch((caught) => {
                  setError(errorMessage(caught, 'Could not create the PDF'))
                })
              }
            >
              Download PDF
            </button>
          </div>
          <article className="catalog-sheet">
            <header className="catalog-banner">
              <p className="eyebrow">Price list</p>
              <h2>{shopName}</h2>
            </header>
            {catalog.length === 0 ? <p className="muted">No products to list.</p> : null}
            {catalog.map((group) => (
              <section className="catalog-group" key={group.name}>
                <h3>{group.name}</h3>
                <div className="catalog-grid">
                  {group.items.map((product) => (
                    <CatalogCard key={product.folderName} product={product} currency={currency} />
                  ))}
                </div>
              </section>
            ))}
          </article>
        </>
      ) : null}
    </section>
  )
}

function CatalogCard({ product, currency }: { product: ProductSummary; currency: string }) {
  return (
    <article className="catalog-card">
      {product.coverImage ? (
        <img src={mediaUrl(product.folderName, product.coverImage, product.updatedAt)} alt="" />
      ) : (
        <span className="catalog-photo" aria-hidden="true">
          {product.title.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="catalog-copy">
        <p className="catalog-name">{product.title}</p>
        {product.sku ? <p className="catalog-sku">{product.sku}</p> : null}
        <p className="catalog-price">{formatMoney(product.sellingPrice, currency)}</p>
      </div>
    </article>
  )
}

function dayLabel(key: string): string {
  if (key === 'unknown-date') return 'Unknown date'
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
}
