import { useEffect, useRef, useState } from 'react'
import type { ImageInput, ProductDetails } from '../../shared/types'
import { mediaUrl } from '../../shared/mediaUrl'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { errorMessage, stockCount } from '../format'

type ImageDraft =
  | { kind: 'empty' }
  | { kind: 'existing'; relativePath: string }
  | { kind: 'new'; sourcePath: string; previewUrl: string }

interface ColorDraft {
  key: string
  id: string
  name: string
  isDefault: boolean
  image: ImageDraft
}

interface Draft {
  title: string
  brand: string
  category: string
  sku: string
  sellingPrice: string
  purchasingPrice: string
  units: string
  description: string
  notes: string
  coverImage: ImageDraft
  colors: ColorDraft[]
}

function emptyDraft(partial?: { brand?: string; category?: string }): Draft {
  return {
    title: '',
    brand: partial?.brand ?? '',
    category: partial?.category ?? '',
    sku: '',
    sellingPrice: '',
    purchasingPrice: '',
    units: '',
    description: '',
    notes: '',
    coverImage: { kind: 'empty' },
    colors: []
  }
}

function draftFromProduct(product: ProductDetails): Draft {
  return {
    title: product.title,
    brand: product.brand,
    category: product.category,
    sku: product.sku,
    sellingPrice: String(product.sellingPrice),
    purchasingPrice: String(product.purchasingPrice),
    units: String(stockCount(product.units)),
    description: product.description,
    notes: product.notes,
    coverImage: product.coverImage ? { kind: 'existing', relativePath: product.coverImage } : { kind: 'empty' },
    colors: product.colors.map((color) => ({
      key: color.id,
      id: color.id,
      name: color.name,
      isDefault: color.isDefault,
      image: color.image ? { kind: 'existing', relativePath: color.image } : { kind: 'empty' }
    }))
  }
}

function revokeDraftImages(draft: Draft) {
  if (draft.coverImage.kind === 'new') URL.revokeObjectURL(draft.coverImage.previewUrl)
  for (const color of draft.colors) {
    if (color.image.kind === 'new') URL.revokeObjectURL(color.image.previewUrl)
  }
}

function toImageInput(image: ImageDraft): ImageInput {
  if (image.kind === 'empty') return { kind: 'empty' }
  if (image.kind === 'existing') return { kind: 'keep', relativePath: image.relativePath }
  return { kind: 'file', sourcePath: image.sourcePath }
}

function previewSrc(image: ImageDraft, folderName: string | null, version: string): string | null {
  if (image.kind === 'new') return image.previewUrl
  if (image.kind === 'existing' && folderName) return mediaUrl(folderName, image.relativePath, version)
  return null
}

const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])

function imageFromFile(file: File | undefined): ImageDraft {
  if (!file) return { kind: 'empty' }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!imageExtensions.has(extension)) {
    throw new Error('Use a JPG, PNG, WebP, or GIF image, or leave the photo empty')
  }
  const sourcePath = window.inventory.getPathForFile(file)
  if (!sourcePath) throw new Error('Could not read that image')
  return { kind: 'new', sourcePath, previewUrl: URL.createObjectURL(file) }
}

function parsePrice(value: string, label: string): number {
  const trimmed = value.trim().replace(/,/g, '')
  if (!trimmed) throw new Error(`Enter a ${label.toLowerCase()}`)
  const amount = Number(trimmed)
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label} must be zero or more`)
  return amount
}

function parseUnits(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Enter how many units are in stock')
  if (!/^\d+$/.test(trimmed)) throw new Error('Units must be a whole number')
  const units = Number(trimmed)
  if (units > 1_000_000) throw new Error('Units must be 1000000 or fewer')
  return units
}

function clearField(current: Record<string, string>, ...keys: string[]): Record<string, string> {
  if (keys.every((key) => !current[key])) return current
  const next = { ...current }
  for (const key of keys) delete next[key]
  return next
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <span className="field-error">{message}</span>
}

export function ProductForm({
  folderName,
  initialBrand = '',
  initialCategory = '',
  guard,
  active,
  onBack,
  onHome
}: {
  folderName: string | null
  initialBrand?: string
  initialCategory?: string
  guard: { current: ((apply: () => void) => void) | null }
  active: boolean
  onBack: () => void
  onHome: () => void
}) {
  const [editingFolder, setEditingFolder] = useState(folderName)
  const [version, setVersion] = useState('')
  const [draft, setDraft] = useState<Draft>(() => emptyDraft({ brand: initialBrand, category: initialCategory }))
  const [cleanSnapshot, setCleanSnapshot] = useState(() =>
    JSON.stringify(emptyDraft({ brand: initialBrand, category: initialCategory }))
  )
  const [loading, setLoading] = useState(Boolean(folderName))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const draftRef = useRef(draft)
  const dirtyRef = useRef(false)
  const blockedRef = useRef(false)
  draftRef.current = draft
  dirtyRef.current = JSON.stringify(draft) !== cleanSnapshot
  blockedRef.current = pendingDelete || pendingLeave !== null

  useEffect(() => () => revokeDraftImages(draftRef.current), [])

  useEffect(() => {
    if (!folderName) {
      titleRef.current?.focus()
      return
    }
    let cancelled = false
    window.inventory
      .getProduct(folderName)
      .then((product) => {
        if (cancelled) return
        const next = draftFromProduct(product)
        setDraft(next)
        setCleanSnapshot(JSON.stringify(next))
        setEditingFolder(product.folderName)
        setVersion(product.updatedAt)
        setLoading(false)
      })
      .catch((caught) => {
        if (cancelled) return
        setError(errorMessage(caught, 'Could not open this product'))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [folderName])

  useEffect(() => {
    if (!active) return
    guard.current = (apply) => {
      if (!dirtyRef.current) {
        apply()
        return
      }
      setPendingLeave(() => apply)
    }
    return () => {
      guard.current = null
    }
  }, [guard, active])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (blockedRef.current) return
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return
      event.preventDefault()
      void save(event.shiftKey)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function updateImage(current: ImageDraft, file: File | undefined): ImageDraft {
    if (current.kind === 'new') URL.revokeObjectURL(current.previewUrl)
    return imageFromFile(file)
  }

  async function save(andAnother: boolean) {
    if (busy) return
    setError(null)
    setStatus(null)
    const nextErrors: Record<string, string> = {}
    if (!draft.title.trim()) nextErrors.title = 'Enter a title'
    let sellingPrice = 0
    let purchasingPrice = 0
    let units = 0
    try {
      sellingPrice = parsePrice(draft.sellingPrice, 'Selling price')
    } catch (caught) {
      nextErrors.sellingPrice = errorMessage(caught, 'Enter a selling price')
    }
    try {
      purchasingPrice = parsePrice(draft.purchasingPrice, 'Purchasing price')
    } catch (caught) {
      nextErrors.purchasingPrice = errorMessage(caught, 'Enter a purchasing price')
    }
    if (!nextErrors.sellingPrice && !nextErrors.purchasingPrice && sellingPrice < purchasingPrice) {
      nextErrors.sellingPrice = "Selling price can't be less than the purchasing price"
    }
    try {
      units = parseUnits(draft.units)
    } catch (caught) {
      nextErrors.units = errorMessage(caught, 'Enter how many units are in stock')
    }
    if (draft.colors.some((color) => !color.name.trim() && color.image.kind !== 'empty')) {
      nextErrors.colors = 'Each color needs a name. A color photo is optional.'
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors)
      setError('Check the highlighted fields.')
      return
    }
    setFieldErrors({})

    setBusy(true)
    let leaving = false
    try {
      await window.inventory.saveProduct({
        ...(editingFolder ? { folderName: editingFolder } : {}),
        title: draft.title,
        brand: draft.brand,
        category: draft.category,
        sku: draft.sku,
        sellingPrice,
        purchasingPrice,
        units,
        description: draft.description,
        notes: draft.notes,
        coverImage: toImageInput(draft.coverImage),
        colors: draft.colors
          .filter((color) => color.name.trim() || color.image.kind !== 'empty')
          .map((color) => ({
            id: color.id,
            name: color.name,
            isDefault: color.isDefault,
            image: toImageInput(color.image)
          }))
      })

      if (andAnother) {
        const next = emptyDraft({ brand: draft.brand, category: draft.category })
        revokeDraftImages(draft)
        setEditingFolder(null)
        setVersion('')
        setDraft(next)
        setCleanSnapshot(JSON.stringify(next))
        setFieldErrors({})
        setStatus('Saved. Add the next product.')
        titleRef.current?.focus()
      } else {
        revokeDraftImages(draft)
        dirtyRef.current = false
        leaving = true
        onHome()
      }
    } catch (caught) {
      setError(errorMessage(caught, 'Could not save the product'))
    } finally {
      if (!leaving) setBusy(false)
    }
  }

  async function removeProduct() {
    if (!editingFolder) return
    setBusy(true)
    setError(null)
    try {
      await window.inventory.deleteProduct(editingFolder)
      dirtyRef.current = false
      setPendingDelete(false)
      onBack()
    } catch (caught) {
      setError(errorMessage(caught, 'Could not delete the product'))
      setBusy(false)
    }
  }

  function addColor() {
    setStatus(null)
    setDraft((current) => ({
      ...current,
      colors: [
        ...current.colors,
        {
          key: crypto.randomUUID(),
          id: crypto.randomUUID(),
          name: '',
          isDefault: current.colors.length === 0,
          image: { kind: 'empty' }
        }
      ]
    }))
  }

  const saveShortcut = window.inventory.platform === 'darwin' ? '⌘↩' : 'Ctrl+Enter'
  const anotherShortcut = window.inventory.platform === 'darwin' ? '⇧⌘↩' : 'Ctrl+Shift+Enter'

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <button type="button" className="text-button" onClick={onBack}>
            ← Back
          </button>
          <h1>{editingFolder ? 'Edit product' : 'New product'}</h1>
        </div>
      </header>

      {loading ? <p className="muted">Loading product…</p> : null}

      <form
        className="product-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save(false)
        }}
      >
        <label className="field">
          Title
          <input
            ref={titleRef}
            value={draft.title}
            onChange={(event) => {
              setDraft({ ...draft, title: event.target.value })
              setFieldErrors((current) => clearField(current, 'title'))
            }}
            placeholder="Product title"
            aria-invalid={fieldErrors.title ? true : undefined}
            required
          />
          <FieldError message={fieldErrors.title} />
        </label>

        <div className="form-grid">
          <label className="field">
            Brand
            <input value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} />
          </label>
          <label className="field">
            Category
            <input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} />
          </label>
          <label className="field">
            SKU
            <input value={draft.sku} onChange={(event) => setDraft({ ...draft, sku: event.target.value })} />
          </label>
          <span />
          <label className="field">
            Selling price
            <input
              inputMode="decimal"
              value={draft.sellingPrice}
              onChange={(event) => {
                setDraft({ ...draft, sellingPrice: event.target.value })
                setFieldErrors((current) => clearField(current, 'sellingPrice'))
              }}
              placeholder="0.00"
              aria-invalid={fieldErrors.sellingPrice ? true : undefined}
            />
            <FieldError message={fieldErrors.sellingPrice} />
          </label>
          <label className="field">
            Purchasing price
            <input
              inputMode="decimal"
              value={draft.purchasingPrice}
              onChange={(event) => {
                setDraft({ ...draft, purchasingPrice: event.target.value })
                setFieldErrors((current) => clearField(current, 'sellingPrice', 'purchasingPrice'))
              }}
              placeholder="0.00"
              aria-invalid={fieldErrors.purchasingPrice ? true : undefined}
            />
            <FieldError message={fieldErrors.purchasingPrice} />
          </label>
          <label className="field">
            Units in stock
            <input
              inputMode="numeric"
              value={draft.units}
              onChange={(event) => {
                setDraft({ ...draft, units: event.target.value })
                setFieldErrors((current) => clearField(current, 'units'))
              }}
              placeholder="0"
              aria-invalid={fieldErrors.units ? true : undefined}
            />
            <span className="hint">Whole number. A bill reduces this by the quantity you sell.</span>
            <FieldError message={fieldErrors.units} />
          </label>
        </div>

        <ImagePicker
          label="Cover photo"
          hint="Optional. Leave this empty, or use a JPG, PNG, WebP, or GIF."
          image={draft.coverImage}
          src={previewSrc(draft.coverImage, editingFolder, version)}
          onFile={(file) => {
            try {
              setDraft({ ...draft, coverImage: updateImage(draft.coverImage, file) })
              setStatus(null)
            } catch (caught) {
              setError(errorMessage(caught, 'Could not use that image'))
            }
          }}
          onClear={() => {
            if (draft.coverImage.kind === 'new') URL.revokeObjectURL(draft.coverImage.previewUrl)
            setDraft({ ...draft, coverImage: { kind: 'empty' } })
          }}
        />

        <fieldset className="color-editor">
          <legend>Colors</legend>
          <p className="muted">Optional. A color can be a name only, without a photo. If you add colors, one is the default.</p>
          <FieldError message={fieldErrors.colors} />
          {draft.colors.map((color) => (
            <div className="color-row" key={color.key}>
              <label className="field">
                Color
                <input
                  value={color.name}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      colors: draft.colors.map((item) => (item.id === color.id ? { ...item, name: event.target.value } : item))
                    })
                  }
                  placeholder="Navy"
                />
              </label>
              <label className="check">
                <input
                  type="radio"
                  name="default-color"
                  checked={color.isDefault}
                  onChange={() =>
                    setDraft({
                      ...draft,
                      colors: draft.colors.map((item) => ({ ...item, isDefault: item.id === color.id }))
                    })
                  }
                />
                Default
              </label>
              <ImagePicker
                label="Photo"
                image={color.image}
                src={previewSrc(color.image, editingFolder, version)}
                compact
                onFile={(file) => {
                  try {
                    setDraft({
                      ...draft,
                      colors: draft.colors.map((item) =>
                        item.id === color.id ? { ...item, image: updateImage(item.image, file) } : item
                      )
                    })
                  } catch (caught) {
                    setError(errorMessage(caught, 'Could not use that image'))
                  }
                }}
                onClear={() => {
                  if (color.image.kind === 'new') URL.revokeObjectURL(color.image.previewUrl)
                  setDraft({
                    ...draft,
                    colors: draft.colors.map((item) => (item.id === color.id ? { ...item, image: { kind: 'empty' } } : item))
                  })
                }}
              />
              <button
                type="button"
                className="text-button danger-text"
                onClick={() => {
                  if (color.image.kind === 'new') URL.revokeObjectURL(color.image.previewUrl)
                  const colors = draft.colors.filter((item) => item.id !== color.id)
                  if (colors.length > 0 && !colors.some((item) => item.isDefault)) colors[0] = { ...colors[0], isDefault: true }
                  setDraft({ ...draft, colors })
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="button" onClick={addColor}>
            Add color
          </button>
        </fieldset>

        <label className="field">
          Description
          <textarea
            rows={5}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            placeholder="Fabric, size, and what a customer should know"
          />
        </label>
        <label className="field">
          Notes
          <textarea
            rows={3}
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            placeholder="Supplier, shelf, or anything only you need"
          />
        </label>

        {editingFolder ? <p className="muted">Folder: {editingFolder}</p> : null}
        {status ? <p className="form-note">{status}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}

        <div className="form-footer">
          {editingFolder ? (
            <button type="button" className="button danger" onClick={() => setPendingDelete(true)} disabled={busy}>
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="row-actions">
            <button type="button" className="button" onClick={() => void save(true)} disabled={busy}>
              Save and add another <span className="shortcut">{anotherShortcut}</span>
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'} <span className="shortcut">{saveShortcut}</span>
            </button>
          </div>
        </div>
      </form>

      {pendingDelete ? (
        <ConfirmDialog
          title={`Delete ${draft.title.trim() || 'this product'}?`}
          body="This removes its folder and photos from the inventory. This cannot be undone."
          confirmLabel={busy ? 'Deleting…' : 'Delete'}
          danger
          busy={busy}
          onCancel={() => setPendingDelete(false)}
          onConfirm={() => void removeProduct()}
        />
      ) : null}
      {pendingLeave ? (
        <ConfirmDialog
          title="Leave without saving?"
          body="This product has unsaved changes."
          confirmLabel="Leave"
          danger
          onCancel={() => setPendingLeave(null)}
          onConfirm={() => {
            const leave = pendingLeave
            dirtyRef.current = false
            setPendingLeave(null)
            leave()
          }}
        />
      ) : null}
    </section>
  )
}

function ImagePicker({
  label,
  hint,
  image,
  src,
  compact = false,
  onFile,
  onClear
}: {
  label: string
  hint?: string
  image: ImageDraft
  src: string | null
  compact?: boolean
  onFile: (file: File | undefined) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  return (
    <div className={compact ? 'image-picker compact' : 'image-picker'}>
      <span className="field-label">{label}</span>
      <div
        className={over ? 'dropzone over' : 'dropzone'}
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          onFile(event.dataTransfer.files[0])
        }}
      >
        {src ? <img src={src} alt="" /> : <span className="drop-hint">Drop a photo, or choose a file</span>}
      </div>
      <div className="row-actions">
        <button type="button" className="button" onClick={() => inputRef.current?.click()}>
          {image.kind === 'empty' ? 'Choose photo' : 'Replace photo'}
        </button>
        {image.kind === 'empty' ? null : (
          <button type="button" className="text-button" onClick={onClear}>
            Remove photo
          </button>
        )}
      </div>
      {hint ? <p className="muted">{hint}</p> : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        hidden
        onChange={(event) => {
          onFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </div>
  )
}
