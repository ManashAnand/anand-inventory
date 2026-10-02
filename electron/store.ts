import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { FORMAT_VERSION, type Bill, type BillLine, type CreateBillInput, type DeleteBillResult, type FolderInspection, type ImageInput, type InventoryMeta, type Product, type ProductColor, type ProductDetails, type ProductList, type ProductSummary, type SaveProductInput } from '../shared/types'
import { isInside } from '../shared/media'

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const MAX_IMAGE_BYTES = 30 * 1024 * 1024

export function folderSlug(title: string): string {
  const cleaned = Array.from(
    title
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[.-]+|[.-]+$/g, '')
  )
    .slice(0, 40)
    .join('')
    .replace(/[.-]+$/g, '')

  if (!cleaned || !/\p{L}|\p{N}/u.test(cleaned)) return 'product'
  return cleaned
}

export async function inspectFolder(folderPath: string): Promise<FolderInspection> {
  let stats: Awaited<ReturnType<typeof fs.stat>>
  try {
    stats = await fs.stat(folderPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'missing', hasEntries: false }
    }
    throw error
  }

  if (!stats.isDirectory()) {
    return { kind: 'missing', hasEntries: false }
  }

  const entries = await fs.readdir(folderPath)
  const metaPath = path.join(folderPath, 'inventory.json')
  try {
    const raw = JSON.parse(await fs.readFile(metaPath, 'utf8')) as Partial<InventoryMeta>
    if (typeof raw.formatVersion === 'number' && raw.formatVersion > FORMAT_VERSION) {
      return { kind: 'newer-version', hasEntries: entries.length > 0 }
    }
    try {
      return {
        kind: 'inventory',
        hasEntries: entries.length > 0,
        inventory: parseMeta(raw)
      }
    } catch {
      return { kind: 'plain', hasEntries: entries.length > 0 }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'plain', hasEntries: entries.length > 0 }
    }
    if (error instanceof SyntaxError) {
      return { kind: 'plain', hasEntries: entries.length > 0 }
    }
    throw error
  }
}

export async function createInventory(
  folderPath: string,
  details: { shopName: string; currency: string; address?: string; phone?: string; email?: string }
): Promise<InventoryMeta> {
  await fs.mkdir(folderPath, { recursive: true })
  const stats = await fs.stat(folderPath)
  if (!stats.isDirectory()) {
    throw new Error('Choose a folder for the inventory')
  }

  const inspection = await inspectFolder(folderPath)
  if (inspection.kind === 'inventory') {
    throw new Error('This folder is already an inventory')
  }
  if (inspection.kind === 'newer-version') {
    throw new Error('This folder was created by a newer version of the app')
  }

  const metaPath = path.join(folderPath, 'inventory.json')
  try {
    await fs.access(metaPath)
    throw new Error('This folder has an inventory.json file that this app cannot use')
  } catch (error) {
    if (error instanceof Error && error.message.includes('inventory.json file')) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const meta: InventoryMeta = {
    formatVersion: FORMAT_VERSION,
    shopName: normalizeShopName(details.shopName),
    currency: normalizeCurrency(details.currency || 'INR'),
    address: optionalContact(details.address, 'Address', 300),
    phone: optionalContact(details.phone, 'Phone', 30),
    email: optionalEmail(details.email),
    createdAt: new Date().toISOString()
  }
  await atomicWriteJson(metaPath, meta)
  await fs.mkdir(path.join(folderPath, 'products'), { recursive: true })
  return meta
}

export async function updateInventoryMeta(
  folderPath: string,
  details: { shopName: string; currency: string; address?: string; phone?: string; email?: string }
): Promise<InventoryMeta> {
  const current = await readMeta(folderPath)
  const next: InventoryMeta = {
    ...current,
    shopName: normalizeShopName(details.shopName),
    currency: normalizeCurrency(details.currency),
    address: optionalContact(details.address, 'Address', 300),
    phone: optionalContact(details.phone, 'Phone', 30),
    email: optionalEmail(details.email)
  }
  await atomicWriteJson(path.join(folderPath, 'inventory.json'), next)
  return next
}

export async function listProducts(dataRoot: string): Promise<ProductList> {
  await assertInventory(dataRoot)
  const productsDir = await ensureProductsDir(dataRoot)
  const entries = await fs.readdir(productsDir, { withFileTypes: true })
  const products: ProductSummary[] = []
  const unreadable: string[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const productPath = path.join(productsDir, entry.name, 'product.json')
    try {
      await fs.access(productPath)
    } catch {
      continue
    }
    try {
      const product = await readProductFile(path.join(productsDir, entry.name))
      products.push(toSummary(entry.name, product))
    } catch {
      unreadable.push(entry.name)
    }
  }

  products.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.title.localeCompare(b.title)))
  return { products, unreadable }
}

export async function getProduct(dataRoot: string, folderName: string): Promise<ProductDetails> {
  await assertInventory(dataRoot)
  const productDir = resolveProductDir(dataRoot, folderName)
  const product = await readProductFile(productDir)
  return { ...product, folderName }
}

export async function saveProduct(dataRoot: string, input: SaveProductInput): Promise<ProductDetails> {
  await assertInventory(dataRoot)
  if (!input || !Array.isArray(input.colors)) throw new Error('Product details are missing')
  const coverImageInput = normalizeImageInput(input.coverImage)
  const title = normalizeText(input.title, 'Title', 200)
  if (!title) throw new Error('Enter a title')
  const brand = normalizeText(input.brand, 'Brand', 120)
  const category = normalizeText(input.category, 'Category', 120)
  const sku = normalizeText(input.sku, 'SKU', 120)
  const sellingPrice = normalizePrice(input.sellingPrice, 'Selling price')
  const purchasingPrice = normalizePrice(input.purchasingPrice, 'Purchasing price')
  if (sellingPrice < purchasingPrice) {
    throw new Error("Selling price can't be less than the purchasing price")
  }
  const units = normalizeUnits(input.units, 'Units')
  const description = normalizeText(input.description, 'Description', 20000)
  const notes = normalizeText(input.notes, 'Notes', 20000)
  const preparedColors = prepareColors(input.colors)
  const productsDir = await ensureProductsDir(dataRoot)

  let folderName = input.folderName?.trim() ?? ''
  let createdFolder = false
  let productDir = ''

  try {
    if (!folderName) {
      folderName = await allocateFolder(productsDir, title)
      createdFolder = true
      productDir = path.join(productsDir, folderName)
    } else {
      productDir = resolveProductDir(dataRoot, folderName)
      try {
        const stats = await fs.stat(productDir)
        if (!stats.isDirectory()) throw new Error('Product folder was not found')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error('Product folder was not found')
        }
        throw error
      }
    }

    const existing = createdFolder ? null : await readProductFile(productDir)
    const now = new Date().toISOString()
    const coverImage = await storeImage(productDir, 'images/cover', coverImageInput)
    const colors = await storeColors(productDir, preparedColors)

    const product: Product = {
      id: existing?.id ?? crypto.randomUUID(),
      title,
      brand,
      category,
      sku,
      sellingPrice,
      purchasingPrice,
      units,
      description,
      notes,
      ...(coverImage ? { coverImage } : {}),
      colors,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }

    await atomicWriteJson(path.join(productDir, 'product.json'), product)
    try {
      await removeOrphanImages(productDir, coverImage, colors)
    } catch {
      // The product file is already saved. A later save can remove leftover images.
    }
    return { ...product, folderName }
  } catch (error) {
    if (createdFolder && productDir) {
      await fs.rm(productDir, { recursive: true, force: true })
    }
    throw error
  }
}

export async function deleteProduct(dataRoot: string, folderName: string): Promise<void> {
  await assertInventory(dataRoot)
  const productDir = resolveProductDir(dataRoot, folderName)
  try {
    const stats = await fs.stat(productDir)
    if (!stats.isDirectory()) throw new Error('Product folder was not found')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Product folder was not found')
    }
    throw error
  }
  await fs.rm(productDir, { recursive: true, force: true })
}

export async function createBill(dataRoot: string, input: CreateBillInput): Promise<Bill> {
  await assertInventory(dataRoot)
  const customerName = normalizeText(input?.customerName ?? '', 'Customer', 120)
  if (!input || !Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('Add at least one product to the bill')
  }

  const quantities = new Map<string, number>()
  const requestedPrices = new Map<string, number>()
  for (const item of input.items) {
    if (!item || typeof item.folderName !== 'string') throw new Error('A bill line is missing its product')
    const quantity = normalizeUnits(item.quantity, 'Quantity')
    if (quantity < 1) throw new Error('Each bill line needs at least 1 unit')
    quantities.set(item.folderName, (quantities.get(item.folderName) ?? 0) + quantity)
    if (item.unitPrice != null) requestedPrices.set(item.folderName, normalizePrice(item.unitPrice, 'Price'))
  }

  const lines: Array<{ product: ProductDetails; quantity: number }> = []
  for (const [folderName, quantity] of quantities) {
    const product = await getProduct(dataRoot, folderName)
    if (quantity > product.units) {
      const available = product.units === 1 ? '1 unit' : `${product.units} units`
      throw new Error(`${product.title} has ${available} in stock, and this bill asks for ${quantity}`)
    }
    lines.push({ product, quantity })
  }

  const savedAt = new Date().toISOString()
  const issuedAt = timestampForIssueDate(input.issuedOn)
  const day = billDay(issuedAt)
  const taxRate = normalizeTaxRate(input.taxRate)
  const items: BillLine[] = lines.map(({ product, quantity }) => {
    const unitPrice = requestedPrices.get(product.folderName) ?? product.sellingPrice
    return {
      folderName: product.folderName,
      productId: product.id,
      title: product.title,
      sku: product.sku,
      category: product.category.trim(),
      quantity,
      unitPrice,
      lineTotal: roundMoney(unitPrice * quantity)
    }
  })
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0))
  const taxAmount = roundMoney((subtotal * taxRate) / 100)
  const number = await nextBillNumber(dataRoot)
  const bill: Bill = {
    id: crypto.randomUUID(),
    number,
    customerName,
    customerAddress: optionalContact(input.customerAddress, 'Customer address', 300),
    customerPhone: optionalContact(input.customerPhone, 'Customer phone', 30),
    customerEmail: optionalEmail(input.customerEmail),
    notes: optionalContact(input.notes, 'Notes', 2000),
    paymentMode: normalizePaymentMode(input.paymentMode),
    taxRate,
    subtotal,
    taxAmount,
    createdAt: issuedAt,
    items,
    total: roundMoney(subtotal + taxAmount),
    shopName: optionalContact(input.shopName, 'Company name', 80) || (await readMeta(dataRoot)).shopName,
    shopAddress: optionalContact(input.shopAddress, 'Address', 300),
    shopPhone: optionalContact(input.shopPhone, 'Phone', 30),
    shopEmail: optionalEmail(input.shopEmail)
  }

  const previous = lines.map(({ product }) => product)
  try {
    for (const { product, quantity } of lines) {
      await writeStoredProduct(dataRoot, { ...product, units: product.units - quantity, updatedAt: savedAt }, product.folderName)
    }
    await migrateFlatBills(dataRoot)
    const dir = path.join(dataRoot, 'bills', day)
    await fs.mkdir(dir, { recursive: true })
    await atomicWriteJson(path.join(dir, billFileName(number)), bill)
  } catch (error) {
    for (const product of previous) {
      await writeStoredProduct(dataRoot, product, product.folderName).catch(() => undefined)
    }
    throw error
  }

  try {
    await writeDayLog(dataRoot, day, await inventoryCurrency(dataRoot))
  } catch {
    // The bill file is already saved. The next bill rewrites this day's log.
  }

  return bill
}

export async function listBills(dataRoot: string): Promise<Bill[]> {
  await assertInventory(dataRoot)
  await migrateFlatBills(dataRoot)
  return readAllBills(dataRoot)
}

export async function getBill(dataRoot: string, number: number): Promise<Bill> {
  await assertInventory(dataRoot)
  await migrateFlatBills(dataRoot)
  const filePath = await findBillFile(dataRoot, number)
  if (!filePath) throw new Error('That bill was not found')
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown
    return parseBill(raw)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('That bill was not found')
    throw error
  }
}

export async function deleteBill(dataRoot: string, number: number): Promise<DeleteBillResult> {
  await assertInventory(dataRoot)
  await migrateFlatBills(dataRoot)
  const filePath = await findBillFile(dataRoot, number)
  if (!filePath) throw new Error('That bill was not found')
  const bill = parseBill(JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown)

  const quantities = new Map<string, { title: string; quantity: number }>()
  for (const item of bill.items) {
    const current = quantities.get(item.folderName)
    if (current) current.quantity += item.quantity
    else quantities.set(item.folderName, { title: item.title, quantity: item.quantity })
  }

  const snapshots: ProductDetails[] = []
  const restored: DeleteBillResult['restored'] = []
  const missing: DeleteBillResult['missing'] = []
  for (const [folderName, change] of quantities) {
    try {
      snapshots.push(await getProduct(dataRoot, folderName))
      restored.push(change)
    } catch (error) {
      if (error instanceof Error && error.message === 'Product folder was not found') {
        missing.push(change)
        continue
      }
      throw error
    }
  }

  const now = new Date().toISOString()
  try {
    for (const product of snapshots) {
      const change = quantities.get(product.folderName)
      if (!change) continue
      await writeStoredProduct(
        dataRoot,
        { ...product, units: product.units + change.quantity, updatedAt: now },
        product.folderName
      )
    }
    await fs.rm(filePath)
  } catch (error) {
    for (const product of snapshots) {
      await writeStoredProduct(dataRoot, product, product.folderName).catch(() => undefined)
    }
    throw error
  }

  try {
    const day = path.basename(path.dirname(filePath))
    await writeDayLog(dataRoot, day, await inventoryCurrency(dataRoot))
  } catch {
    // Stock is back and the bill file is gone. The day's log is rebuilt on the next bill.
  }

  return { restored, missing }
}

export function billDay(createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return 'unknown-date'
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function billFileName(number: number): string {
  return `${String(number).padStart(4, '0')}.json`
}

function isDayFolder(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(name) || name === 'unknown-date'
}

async function nextBillNumber(dataRoot: string): Promise<number> {
  await migrateFlatBills(dataRoot)
  const bills = await readAllBills(dataRoot)
  return bills.reduce((max, bill) => Math.max(max, bill.number), 0) + 1
}

async function readAllBills(dataRoot: string): Promise<Bill[]> {
  const billsDir = path.join(dataRoot, 'bills')
  let names: string[] = []
  try {
    names = await fs.readdir(billsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const bills: Bill[] = []
  for (const name of names) {
    const entryPath = path.join(billsDir, name)
    if (/^\d+\.json$/.test(name)) {
      bills.push(...(await readBillFile(entryPath)))
      continue
    }
    if (!isDayFolder(name)) continue
    let children: string[] = []
    try {
      const stats = await fs.stat(entryPath)
      if (!stats.isDirectory()) continue
      children = await fs.readdir(entryPath)
    } catch {
      continue
    }
    for (const child of children) {
      if (!/^\d+\.json$/.test(child)) continue
      bills.push(...(await readBillFile(path.join(entryPath, child))))
    }
  }
  bills.sort((a, b) => b.number - a.number)
  return bills
}

async function readBillFile(filePath: string): Promise<Bill[]> {
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown
    return [parseBill(raw)]
  } catch {
    return []
  }
}

async function findBillFile(dataRoot: string, number: number): Promise<string | null> {
  if (!Number.isInteger(number) || number < 1) return null
  const billsDir = path.join(dataRoot, 'bills')
  const fileName = billFileName(number)
  const flat = path.join(billsDir, fileName)
  try {
    const stats = await fs.stat(flat)
    if (stats.isFile()) return flat
  } catch {
    // Older bills may already live in a date folder.
  }
  let names: string[] = []
  try {
    names = await fs.readdir(billsDir)
  } catch {
    return null
  }
  for (const name of names) {
    if (!isDayFolder(name)) continue
    const candidate = path.join(billsDir, name, fileName)
    try {
      const stats = await fs.stat(candidate)
      if (stats.isFile()) return candidate
    } catch {
      continue
    }
  }
  return null
}

async function migrateFlatBills(dataRoot: string): Promise<void> {
  const billsDir = path.join(dataRoot, 'bills')
  let names: string[] = []
  try {
    names = await fs.readdir(billsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  const days = new Set<string>()
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue
    const from = path.join(billsDir, name)
    try {
      const stats = await fs.stat(from)
      if (!stats.isFile()) continue
      const [bill] = await readBillFile(from)
      if (!bill) continue
      const day = billDay(bill.createdAt)
      const destDir = path.join(billsDir, day)
      await fs.mkdir(destDir, { recursive: true })
      await fs.rename(from, path.join(destDir, name))
      days.add(day)
    } catch {
      continue
    }
  }
  if (days.size === 0) return
  const currency = await inventoryCurrency(dataRoot)
  for (const day of days) {
    await writeDayLog(dataRoot, day, currency).catch(() => undefined)
  }
}

async function writeDayLog(dataRoot: string, day: string, currency: string): Promise<void> {
  if (!isDayFolder(day)) return
  const dir = path.join(dataRoot, 'bills', day)
  let names: string[] = []
  try {
    names = await fs.readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const bills: Bill[] = []
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue
    bills.push(...(await readBillFile(path.join(dir, name))))
  }
  if (bills.length === 0) {
    await fs.rm(dir, { recursive: true, force: true })
    return
  }
  bills.sort((a, b) => a.number - b.number)
  const heading =
    day === 'unknown-date'
      ? 'Unknown date'
      : new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  const blocks = bills.map((bill) => {
    const when = bill.createdAt ? new Date(bill.createdAt).toLocaleString() : ''
    const customer = bill.customerName ? `  ${bill.customerName}` : ''
    const lines = bill.items.map((item) => {
      const sku = item.sku ? ` · ${item.sku}` : ''
      return `- ${item.title}${sku} × ${item.quantity}  ${formatLogMoney(item.lineTotal, currency)}`
    })
    const taxLine = bill.taxRate > 0 ? [`Tax (${bill.taxRate}%): ${formatLogMoney(bill.taxAmount, currency)}`] : []
    const payment = bill.paymentMode ? [`Payment: ${bill.paymentMode}`] : []
    return [
      `INV-${String(bill.number).padStart(4, '0')}  ${when}${customer}`,
      ...lines,
      `Subtotal ${formatLogMoney(bill.subtotal, currency)}`,
      ...taxLine,
      ...payment,
      `Total ${formatLogMoney(bill.total, currency)}`
    ].join('\n')
  })
  await fs.writeFile(path.join(dir, 'log.txt'), `${heading}\n\n${blocks.join('\n\n')}\n`, 'utf8')
}

async function inventoryCurrency(dataRoot: string): Promise<string> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dataRoot, 'inventory.json'), 'utf8')) as Partial<InventoryMeta>
    if (typeof raw.currency === 'string' && /^[A-Za-z]{3}$/.test(raw.currency)) return raw.currency.toUpperCase()
  } catch {
    // A missing currency still leaves a readable log.
  }
  return 'INR'
}

function formatLogMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function parseBill(raw: unknown): Bill {
  if (!raw || typeof raw !== 'object') throw new Error('This bill could not be read')
  const record = raw as Partial<Bill>
  const billNumber = record.number
  if (typeof record.id !== 'string' || typeof billNumber !== 'number' || !Number.isInteger(billNumber) || !Array.isArray(record.items)) {
    throw new Error('This bill could not be read')
  }
  const items: BillLine[] = record.items.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('This bill could not be read')
    const line = item as Partial<BillLine>
    if (typeof line.folderName !== 'string' || typeof line.title !== 'string' || typeof line.productId !== 'string') {
      throw new Error('This bill could not be read')
    }
    return {
      folderName: line.folderName,
      productId: line.productId,
      title: line.title,
      sku: typeof line.sku === 'string' ? line.sku : '',
      category: typeof line.category === 'string' ? line.category : '',
      quantity: requireStoredPrice(line.quantity),
      unitPrice: requireStoredPrice(line.unitPrice),
      lineTotal: requireStoredPrice(line.lineTotal)
    }
  })
  const total = requireStoredPrice(record.total)
  const subtotal = typeof record.subtotal === 'number' && Number.isFinite(record.subtotal) ? record.subtotal : total
  const taxRate = typeof record.taxRate === 'number' && Number.isFinite(record.taxRate) ? record.taxRate : 0
  const taxAmount = typeof record.taxAmount === 'number' && Number.isFinite(record.taxAmount) ? record.taxAmount : 0
  return {
    id: record.id,
    number: billNumber,
    customerName: typeof record.customerName === 'string' ? record.customerName : '',
    customerAddress: typeof record.customerAddress === 'string' ? record.customerAddress : '',
    customerPhone: typeof record.customerPhone === 'string' ? record.customerPhone : '',
    customerEmail: typeof record.customerEmail === 'string' ? record.customerEmail : '',
    notes: typeof record.notes === 'string' ? record.notes : '',
    paymentMode: typeof record.paymentMode === 'string' ? record.paymentMode : '',
    taxRate,
    subtotal,
    taxAmount,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
    items,
    total,
    shopName: typeof record.shopName === 'string' ? record.shopName : '',
    shopAddress: typeof record.shopAddress === 'string' ? record.shopAddress : '',
    shopPhone: typeof record.shopPhone === 'string' ? record.shopPhone : '',
    shopEmail: typeof record.shopEmail === 'string' ? record.shopEmail : ''
  }
}

async function writeStoredProduct(dataRoot: string, product: Product, folderName: string): Promise<void> {
  const productDir = resolveProductDir(dataRoot, folderName)
  const stored: Product = {
    id: product.id,
    title: product.title,
    brand: product.brand,
    category: product.category,
    sku: product.sku,
    sellingPrice: product.sellingPrice,
    purchasingPrice: product.purchasingPrice,
    units: product.units,
    description: product.description,
    notes: product.notes,
    ...(product.coverImage ? { coverImage: product.coverImage } : {}),
    colors: product.colors,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt
  }
  await atomicWriteJson(path.join(productDir, 'product.json'), stored)
}

async function allocateFolder(productsDir: string, title: string): Promise<string> {
  const slug = folderSlug(title)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const name = `${slug}__${crypto.randomBytes(3).toString('hex')}`
    try {
      await fs.mkdir(path.join(productsDir, name))
      return name
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('Could not create a folder for this product')
}

function prepareColors(colors: SaveProductInput['colors']): Array<{
  id: string
  name: string
  isDefault: boolean
  image: SaveProductInput['coverImage']
}> {
  if (colors.length > 24) throw new Error('A product can have up to 24 colors')
  const prepared: Array<{ id: string; name: string; isDefault: boolean; image: SaveProductInput['coverImage'] }> = []
  for (const color of colors) {
    if (!color || typeof color !== 'object') continue
    const image = normalizeImageInput(color.image)
    const name = typeof color.name === 'string' ? color.name.trim() : ''
    const hasImage = image.kind !== 'empty'
    if (!name && !hasImage) continue
    if (!name) throw new Error('Each color needs a name')
    if (name.length > 80) throw new Error('Color names must be 80 characters or fewer')
    const id = color.id?.trim() || crypto.randomUUID()
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid color id')
    prepared.push({ id, name, isDefault: color.isDefault === true, image })
  }
  return prepared
}

async function storeColors(
  productDir: string,
  colors: ReturnType<typeof prepareColors>
): Promise<ProductColor[]> {
  const stored: ProductColor[] = []
  for (const color of colors) {
    const image = await storeImage(productDir, `images/colors/${color.id}`, color.image)
    stored.push({
      id: color.id,
      name: color.name,
      isDefault: color.isDefault,
      ...(image ? { image } : {})
    })
  }
  return normalizeDefaults(stored)
}

function normalizeDefaults(colors: ProductColor[]): ProductColor[] {
  if (colors.length === 0) return []
  let chosen = false
  const next = colors.map((color) => {
    if (color.isDefault && !chosen) {
      chosen = true
      return { ...color, isDefault: true }
    }
    return { ...color, isDefault: false }
  })
  if (!chosen) next[0] = { ...next[0], isDefault: true }
  return next
}

function normalizeImageInput(value: unknown): ImageInput {
  if (value == null) return { kind: 'empty' }
  if (typeof value !== 'object') throw new Error('That image could not be used')
  const image = value as { kind?: unknown; relativePath?: unknown; sourcePath?: unknown }
  if (image.kind === 'empty' || image.kind == null) return { kind: 'empty' }
  if (image.kind === 'keep') {
    if (typeof image.relativePath !== 'string' || !image.relativePath) return { kind: 'empty' }
    return { kind: 'keep', relativePath: image.relativePath }
  }
  if (image.kind === 'file') {
    if (typeof image.sourcePath !== 'string' || !image.sourcePath) {
      throw new Error('Choose an image file, or leave the photo empty')
    }
    return { kind: 'file', sourcePath: image.sourcePath }
  }
  throw new Error('That image could not be used')
}

async function storeImage(productDir: string, destWithoutExt: string, input: SaveProductInput['coverImage']): Promise<string | undefined> {
  if (input.kind === 'empty') return undefined
  if (input.kind === 'keep') {
    assertRelativeImage(input.relativePath)
    return input.relativePath
  }

  const sourcePath = path.resolve(input.sourcePath)
  const stats = await fs.stat(sourcePath).catch(() => {
    throw new Error('The selected image could not be read')
  })
  if (!stats.isFile()) throw new Error('Choose an image file')
  if (stats.size > MAX_IMAGE_BYTES) throw new Error('Image must be under 30 MB')

  const extension = path.extname(sourcePath).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(extension)) {
    throw new Error('Use a JPG, PNG, WebP, or GIF image')
  }
  const normalizedExt = extension === '.jpeg' ? '.jpg' : extension
  const relativePath = `${destWithoutExt}${normalizedExt}`
  const destination = resolveInside(productDir, relativePath)
  if (sourcePath !== destination) {
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.copyFile(sourcePath, destination)
  }
  return relativePath
}

async function removeOrphanImages(productDir: string, coverImage: string | undefined, colors: ProductColor[]): Promise<void> {
  const imagesDir = path.join(productDir, 'images')
  const referenced = new Set<string>()
  if (coverImage) referenced.add(coverImage)
  for (const color of colors) {
    if (color.image) referenced.add(color.image)
  }

  let entries: string[] = []
  try {
    entries = await fs.readdir(imagesDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  for (const name of entries) {
    if (!name.startsWith('cover.')) continue
    const relativePath = `images/${name}`
    if (!referenced.has(relativePath)) {
      await fs.rm(path.join(imagesDir, name), { force: true })
    }
  }

  const colorsDir = path.join(imagesDir, 'colors')
  let colorFiles: string[] = []
  try {
    colorFiles = await fs.readdir(colorsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  for (const name of colorFiles) {
    const relativePath = `images/colors/${name}`
    if (!referenced.has(relativePath)) {
      await fs.rm(path.join(colorsDir, name), { force: true })
    }
  }
}

async function readProductFile(productDir: string): Promise<Product> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(productDir, 'product.json'), 'utf8')) as unknown
    return parseProduct(raw)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('This product file could not be read')
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Product folder was not found')
    throw error
  }
}

function parseProduct(raw: unknown): Product {
  if (!raw || typeof raw !== 'object') throw new Error('This product file could not be read')
  const record = raw as Partial<Product>
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!id || !title) throw new Error('This product file could not be read')
  if (!Array.isArray(record.colors)) throw new Error('This product file could not be read')

  const colors: ProductColor[] = []
  for (const color of record.colors) {
    if (!color || typeof color !== 'object') continue
    const entry = color as Partial<ProductColor>
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string' || !entry.name.trim()) continue
    colors.push({
      id: entry.id,
      name: entry.name.trim(),
      isDefault: entry.isDefault === true,
      ...(typeof entry.image === 'string' && entry.image ? { image: entry.image } : {})
    })
  }

  return {
    id,
    title,
    brand: typeof record.brand === 'string' ? record.brand : '',
    category: typeof record.category === 'string' ? record.category : '',
    sku: typeof record.sku === 'string' ? record.sku : '',
    sellingPrice: requireStoredPrice(record.sellingPrice),
    purchasingPrice: requireStoredPrice(record.purchasingPrice),
    units: readStoredUnits(record.units),
    description: typeof record.description === 'string' ? record.description : '',
    notes: typeof record.notes === 'string' ? record.notes : '',
    ...(typeof record.coverImage === 'string' && record.coverImage ? { coverImage: record.coverImage } : {}),
    colors: normalizeDefaults(colors),
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : ''
  }
}

function defaultColorName(product: Product): { defaultColor: string } | Record<string, never> {
  const name = product.colors.find((color) => color.isDefault)?.name
  return name ? { defaultColor: name } : {}
}

function toSummary(folderName: string, product: Product): ProductSummary {
  return {
    folderName,
    id: product.id,
    title: product.title,
    brand: product.brand,
    category: product.category,
    sku: product.sku,
    sellingPrice: product.sellingPrice,
    purchasingPrice: product.purchasingPrice,
    units: product.units,
    ...(product.coverImage ? { coverImage: product.coverImage } : {}),
    ...defaultColorName(product),
    updatedAt: product.updatedAt
  }
}

function readStoredUnits(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

function normalizeUnits(value: unknown, label: string): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(number) || number < 0 || number > 1_000_000) {
    throw new Error(`${label} must be a whole number from 0 up`)
  }
  return number
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function requireStoredPrice(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('This product file could not be read')
  }
  return value
}

async function readMeta(folderPath: string): Promise<InventoryMeta> {
  const inspection = await inspectFolder(folderPath)
  if (inspection.kind === 'missing') throw new Error('Inventory folder was not found')
  if (inspection.kind === 'newer-version') {
    throw new Error('This folder was created by a newer version of the app')
  }
  if (inspection.kind !== 'inventory' || !inspection.inventory) {
    throw new Error('Choose an inventory folder first')
  }
  return inspection.inventory
}

function parseMeta(raw: Partial<InventoryMeta>): InventoryMeta {
  if (raw.formatVersion !== FORMAT_VERSION) {
    throw new Error('This folder is not an inventory this app can open')
  }
  return {
    formatVersion: FORMAT_VERSION,
    shopName: typeof raw.shopName === 'string' ? raw.shopName : '',
    currency: typeof raw.currency === 'string' && raw.currency.trim() ? raw.currency : 'INR',
    address: typeof raw.address === 'string' ? raw.address : '',
    phone: typeof raw.phone === 'string' ? raw.phone : '',
    email: typeof raw.email === 'string' ? raw.email : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : ''
  }
}

async function assertInventory(dataRoot: string): Promise<void> {
  await readMeta(dataRoot)
}

async function ensureProductsDir(dataRoot: string): Promise<string> {
  const productsDir = path.join(dataRoot, 'products')
  try {
    const stats = await fs.stat(productsDir)
    if (!stats.isDirectory()) throw new Error('The products folder is not a directory')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await fs.mkdir(productsDir, { recursive: true })
    } else {
      throw error
    }
  }
  return productsDir
}

function resolveProductDir(dataRoot: string, folderName: string): string {
  if (!folderName || folderName !== path.basename(folderName) || folderName === '.' || folderName === '..') {
    throw new Error('Invalid product folder')
  }
  const productsDir = path.resolve(dataRoot, 'products')
  const productDir = path.resolve(productsDir, folderName)
  if (!isInside(productsDir, productDir)) throw new Error('Invalid product folder')
  return productDir
}

function resolveInside(root: string, relativePath: string): string {
  assertRelativeImage(relativePath)
  const full = path.resolve(root, relativePath)
  if (!isInside(path.resolve(root), full)) throw new Error('Invalid image path')
  return full
}

function assertRelativeImage(relativePath: string): void {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(/[/\\]/).includes('..')) {
    throw new Error('Invalid image path')
  }
  if (!relativePath.startsWith('images/')) throw new Error('Invalid image path')
}

function normalizeText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new Error(`${label} must be ${max} characters or fewer`)
  return trimmed
}

const TAX_RATES = new Set([0, 5, 12, 18, 28])
const PAYMENT_MODES = new Set(['Cash', 'UPI', 'Card', 'Credit'])

function optionalContact(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  return normalizeText(value, label, max)
}

function optionalEmail(value: unknown): string {
  const email = optionalContact(value, 'Email', 120)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email')
  return email
}

function normalizeTaxRate(value: unknown): number {
  if (value == null || value === '') return 0
  const number = typeof value === 'number' ? value : Number(value)
  if (!TAX_RATES.has(number)) throw new Error('Choose a GST rate of 0, 5, 12, 18, or 28')
  return number
}

function normalizePaymentMode(value: unknown): string {
  if (value == null || value === '') return 'Cash'
  if (typeof value !== 'string' || !PAYMENT_MODES.has(value)) throw new Error('Choose a payment mode')
  return value
}

function timestampForIssueDate(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return new Date().toISOString()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Enter a valid bill date')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date()
  date.setFullYear(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error('Enter a valid bill date')
  }
  return date.toISOString()
}

export async function setBanner(dataRoot: string, sourcePath: string): Promise<void> {
  await assertInventory(dataRoot)
  if (!sourcePath || typeof sourcePath !== 'string') throw new Error('Choose an image')
  const extension = path.extname(sourcePath).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(extension)) throw new Error('Choose a JPG, PNG, WebP, or GIF')
  const stats = await fs.stat(sourcePath)
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_IMAGE_BYTES) throw new Error('That image could not be used')
  const names = await fs.readdir(dataRoot).catch(() => [] as string[])
  await Promise.all(
    names
      .filter((name) => /^banner\.(png|jpe?g|webp|gif)$/i.test(name))
      .map((name) => fs.rm(path.join(dataRoot, name), { force: true }))
  )
  await fs.copyFile(sourcePath, path.join(dataRoot, `banner${extension}`))
}

function normalizeShopName(value: string): string {
  return normalizeText(value ?? '', 'Shop name', 80)
}

function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a 3-letter code, such as INR')
  return currency
}

function normalizePrice(value: unknown, label: string): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 100_000_000) {
    throw new Error(`${label} must be a number from 0 up`)
  }
  return Math.round(number * 100) / 100
}

async function atomicWriteJson(target: string, value: unknown): Promise<void> {
  const tmp = `${target}.${process.pid}.tmp`
  try {
    await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    try {
      await fs.rename(tmp, target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EEXIST') throw error
      await fs.rm(target, { force: true })
      await fs.rename(tmp, target)
    }
  } catch (error) {
    await fs.rm(tmp, { force: true })
    throw error
  }
}
