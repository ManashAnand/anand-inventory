import { useEffect, useMemo, useState } from 'react'
import type { ProductList, ProductSummary } from '../../shared/types'
import { errorMessage, formatMoney, stockCount, stockLabel } from '../format'
import { mediaUrl } from '../../shared/mediaUrl'

export function Library({
  currency,
  active,
  onOpen,
  onCreate,
  onBill,
  onBack
}: {
  currency: string
  active: boolean
  onOpen: (folderName: string) => void
  onCreate: () => void
  onBill: () => void
  onBack?: () => void
}) {
  const [list, setList] = useState<ProductList | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    window.inventory
      .listProducts()
      .then((next) => {
        if (!cancelled) setList(next)
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught, 'Could not read products'))
      })
    return () => {
      cancelled = true
    }
  }, [active])

  const products = useMemo(() => {
    const products = list?.products ?? []
    const needle = query.trim().toLowerCase()
    if (!needle) return products
    return products.filter((product) =>
      [product.title, product.brand, product.category, product.sku].some((value) => value.toLowerCase().includes(needle))
    )
  }, [list, query])

  const shortcut = window.inventory.platform === 'darwin' ? '⌘N' : 'Ctrl+N'

  return (
    <section className="page">
      <header className="page-header">
        <div>
          {onBack ? (
            <button type="button" className="text-button" onClick={onBack}>
              ← Back
            </button>
          ) : null}
          <h1>Products</h1>
          <p className="muted">{list ? `${list.products.length} ${list.products.length === 1 ? 'item' : 'items'}` : 'Reading folders…'}</p>
        </div>
        <div className="header-actions">
          <label className="search">
            <span className="sr-only">Search products</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, brand, category, or SKU"
            />
          </label>
          <button type="button" className="button" onClick={onBill}>
            New bill
          </button>
          <button type="button" className="button primary" onClick={onCreate}>
            New product <span className="shortcut">{shortcut}</span>
          </button>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}
      {list && list.unreadable.length > 0 ? (
        <p className="callout">Could not read {list.unreadable.length} product folder(s): {list.unreadable.join(', ')}</p>
      ) : null}

      {list && products.length === 0 ? (
        <div className="empty">
          <h2>{query.trim() ? 'No products match' : 'No products yet'}</h2>
          <p>{query.trim() ? 'Try a different title, brand, category, or SKU.' : 'Add a product and it will be saved in its own folder.'}</p>
          {query.trim() ? null : (
            <button type="button" className="button primary" onClick={onCreate}>
              New product
            </button>
          )}
        </div>
      ) : (
        <div className="product-grid">
          {products.map((product) => (
            <ProductCard key={product.folderName} product={product} currency={currency} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  )
}

function ProductCard({
  product,
  currency,
  onOpen
}: {
  product: ProductSummary
  currency: string
  onOpen: (folderName: string) => void
}) {
  const meta = [product.brand, product.category].filter(Boolean).join(' · ')
  return (
    <button type="button" className="product-card" onClick={() => onOpen(product.folderName)}>
      {product.coverImage ? (
        <img src={mediaUrl(product.folderName, product.coverImage, product.updatedAt)} alt="" />
      ) : (
        <span className="placeholder" aria-hidden="true">
          {product.title.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="card-body">
        <span className="card-title">{product.title}</span>
        {meta ? <span className="card-meta">{meta}</span> : null}
        {product.sku ? <span className="card-sku">{product.sku}</span> : null}
        <span className="card-price">{formatMoney(product.sellingPrice, currency)}</span>
        <span className={stockCount(product.units) === 0 ? 'stock-out' : 'stock-ok'}>{stockLabel(product.units)}</span>
        <span className="card-cost">Cost {formatMoney(product.purchasingPrice, currency)}</span>
        {product.defaultColor ? <span className="color-pill">{product.defaultColor}</span> : null}
      </span>
    </button>
  )
}
