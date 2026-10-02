import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { resolveProductMedia } from '../shared/media'
import { mediaUrl } from '../shared/mediaUrl'
import type { SaveProductInput } from '../shared/types'
import { billDay, createBill, createInventory, deleteBill, deleteProduct, folderSlug, getBill, getProduct, inspectFolder, listBills, listProducts, saveProduct } from '../electron/store'

function productInput(overrides: Partial<SaveProductInput> = {}): SaveProductInput {
  return {
    title: 'Black cotton shirt',
    brand: 'Anand',
    category: 'Shirts',
    sku: 'SH-1',
    sellingPrice: 1200,
    purchasingPrice: 700,
    units: 4,
    description: 'Soft cotton',
    notes: 'Shelf A',
    coverImage: { kind: 'empty' },
    colors: [{ name: 'Black', isDefault: true, image: { kind: 'empty' } }],
    ...overrides
  }
}

async function tempInventory(shopName = 'Anand Store'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inventory-'))
  await createInventory(dir, { shopName, currency: 'INR' })
  return dir
}

test('folder slug keeps a readable filesystem-safe name', () => {
  assert.equal(folderSlug('Black Cotton Shirt'), 'black-cotton-shirt')
  assert.equal(folderSlug('Red/Blue'), 'red-blue')
  assert.equal(folderSlug('!!!'), 'product')
  assert.equal(folderSlug('कमीज़'), 'कमीज़')
})

test('creates an inventory and refuses a plain folder until asked', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inventory-plain-'))
  const plain = await inspectFolder(dir)
  assert.equal(plain.kind, 'plain')
  assert.equal(plain.hasEntries, false)

  const meta = await createInventory(dir, { shopName: 'Corner Shop', currency: 'inr' })
  assert.equal(meta.formatVersion, 1)
  assert.equal(meta.currency, 'INR')
  assert.equal(meta.shopName, 'Corner Shop')

  const ready = await inspectFolder(dir)
  assert.equal(ready.kind, 'inventory')
  await assert.rejects(() => createInventory(dir, { shopName: 'Again', currency: 'INR' }), /already an inventory/)
})

test('stores each product in its own folder and keeps photos inside it', async () => {
  const root = await tempInventory()
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inventory-photo-'))
  const sourceImage = path.join(sourceDir, 'phone.jpeg')
  await fs.writeFile(sourceImage, 'cover-bytes')
  const colorImage = path.join(sourceDir, 'navy.png')
  await fs.writeFile(colorImage, 'navy-bytes')

  const saved = await saveProduct(
    root,
    productInput({
      coverImage: { kind: 'file', sourcePath: sourceImage },
      colors: [
        { name: 'Navy', isDefault: false, image: { kind: 'file', sourcePath: colorImage } },
        { name: 'Black', isDefault: true, image: { kind: 'empty' } },
        { name: 'Red', isDefault: true, image: { kind: 'empty' } }
      ]
    })
  )

  assert.match(saved.folderName, /^black-cotton-shirt__[a-f0-9]{6}$/)
  assert.equal(saved.coverImage, 'images/cover.jpg')
  assert.equal(saved.colors.filter((color) => color.isDefault).length, 1)
  assert.equal(saved.colors.find((color) => color.isDefault)?.name, 'Black')
  assert.equal(saved.colors[0]?.image, `images/colors/${saved.colors[0]?.id}.png`)

  const productDir = path.join(root, 'products', saved.folderName)
  assert.equal(await fs.readFile(path.join(productDir, 'images/cover.jpg'), 'utf8'), 'cover-bytes')
  assert.equal(await fs.readFile(sourceImage, 'utf8'), 'cover-bytes')

  const json = await fs.readFile(path.join(productDir, 'product.json'), 'utf8')
  assert.equal(json.includes(sourceDir), false)
  assert.equal(json.includes(root), false)

  const renamed = await saveProduct(root, productInput({ folderName: saved.folderName, title: 'Blue linen shirt', coverImage: { kind: 'keep', relativePath: 'images/cover.jpg' }, colors: saved.colors.map((color) => ({ id: color.id, name: color.name, isDefault: color.isDefault, image: color.image ? { kind: 'keep' as const, relativePath: color.image } : { kind: 'empty' as const } })) }))
  assert.equal(renamed.folderName, saved.folderName)
  assert.equal(renamed.title, 'Blue linen shirt')
  assert.equal(renamed.id, saved.id)
})

test('a copied inventory folder opens with the same products', async () => {
  const root = await tempInventory()
  await saveProduct(root, productInput())
  await saveProduct(root, productInput({ title: 'Wool scarf', sku: 'SC-2', colors: [] }))

  const manual = path.join(root, 'products', 'hand-added__abc123')
  await fs.mkdir(manual)
  await fs.writeFile(
    path.join(manual, 'product.json'),
    `${JSON.stringify({
      id: 'manual-1',
      title: 'Hand added',
      brand: '',
      category: '',
      sku: 'HAND',
      sellingPrice: 10,
      purchasingPrice: 4,
      description: '',
      notes: '',
      colors: [],
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z'
    })}\n`
  )

  const copy = await fs.mkdtemp(path.join(os.tmpdir(), 'inventory-copy-'))
  await fs.cp(root, copy, { recursive: true })
  const listed = await listProducts(copy)
  const titles = listed.products.map((product) => product.title).sort()
  assert.deepEqual(titles, ['Black cotton shirt', 'Hand added', 'Wool scarf'])
  assert.equal(listed.unreadable.length, 0)

  const opened = await getProduct(copy, listed.products.find((product) => product.sku === 'SH-1')!.folderName)
  assert.equal(opened.brand, 'Anand')
  assert.equal(opened.units, 4)
  assert.equal(listed.products.find((product) => product.sku === 'HAND')?.units, 0)
  assert.equal(opened.colors[0]?.name, 'Black')
  assert.equal(opened.colors[0]?.isDefault, true)

  const meta = JSON.parse(await fs.readFile(path.join(copy, 'inventory.json'), 'utf8')) as { shopName: string; currency: string }
  assert.equal(meta.shopName, 'Anand Store')
  assert.equal(meta.currency, 'INR')
})

test('failed save does not leave an empty product folder', async () => {
  const root = await tempInventory()
  await assert.rejects(
    () => saveProduct(root, productInput({ coverImage: { kind: 'file', sourcePath: path.join(root, 'missing.jpg') } })),
    /could not be read/
  )
  assert.deepEqual(await fs.readdir(path.join(root, 'products')), [])
})

test('delete removes only that product folder', async () => {
  const root = await tempInventory()
  const saved = await saveProduct(root, productInput())
  await assert.rejects(() => deleteProduct(root, '../inventory.json'), /Invalid product folder/)
  assert.equal(await fs.readFile(path.join(root, 'inventory.json'), 'utf8').then((text) => text.includes('"formatVersion"')), true)
  await deleteProduct(root, saved.folderName)
  await assert.rejects(() => getProduct(root, saved.folderName), /not found/)
  assert.deepEqual((await listProducts(root)).products, [])
})

test('image urls stay inside the products folder', () => {
  const root = '/tmp/shop'
  const url = new URL(mediaUrl('black-cotton-shirt__a1b2c3', 'images/cover.jpg', '2026-01-01T00:00:00.000Z'))
  assert.equal(url.hostname, 'media')
  assert.equal(url.pathname, '/black-cotton-shirt__a1b2c3/images/cover.jpg')
  assert.equal(
    resolveProductMedia(root, url.pathname),
    path.resolve(root, 'products/black-cotton-shirt__a1b2c3/images/cover.jpg')
  )
  assert.throws(() => resolveProductMedia(root, '/../inventory.json'))
  assert.throws(() => resolveProductMedia(root, '/shirt/../../inventory.json'))
})

test('a bill decreases stock by the quantity sold', async () => {
  const root = await tempInventory()
  const shirt = await saveProduct(root, productInput({ units: 5 }))
  const scarf = await saveProduct(root, productInput({ title: 'Wool scarf', sku: 'SC-2', units: 2, sellingPrice: 400, purchasingPrice: 200, colors: [] }))

  await assert.rejects(
    () => createBill(root, { customerName: 'Ravi', items: [{ folderName: shirt.folderName, quantity: 6 }] }),
    /in stock/
  )
  assert.equal((await getProduct(root, shirt.folderName)).units, 5)

  const bill = await createBill(root, {
    customerName: 'Ravi',
    items: [
      { folderName: shirt.folderName, quantity: 2 },
      { folderName: scarf.folderName, quantity: 1 }
    ]
  })
  assert.equal(bill.number, 1)
  assert.equal(bill.total, 2800)
  assert.equal((await getProduct(root, shirt.folderName)).units, 3)
  assert.equal((await getProduct(root, scarf.folderName)).units, 1)

  const single = await createBill(root, { customerName: '', items: [{ folderName: scarf.folderName, quantity: 1 }] })
  assert.equal(single.number, 2)
  assert.equal((await getProduct(root, scarf.folderName)).units, 0)
  await assert.rejects(
    () => createBill(root, { customerName: '', items: [{ folderName: scarf.folderName, quantity: 1 }] }),
    /in stock/
  )

  const copy = await fs.mkdtemp(path.join(os.tmpdir(), 'inventory-bills-'))
  await fs.cp(root, copy, { recursive: true })
  const bills = await listBills(copy)
  assert.deepEqual(bills.map((item) => item.number), [2, 1])
  assert.equal(bills[1]?.customerName, 'Ravi')
  assert.equal((await getProduct(copy, shirt.folderName)).units, 3)

  const dayName = (await fs.readdir(path.join(root, 'bills'))).find((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
  assert.ok(dayName)
  const log = await fs.readFile(path.join(root, 'bills', dayName, 'log.txt'), 'utf8')
  assert.match(log, /INV-0001/)
  assert.match(log, /INV-0002/)
  assert.match(log, /Wool scarf/)
  await assert.rejects(() => fs.stat(path.join(root, 'bills', '0001.json')))
})

test('deleting a bill returns stock, and an older flat bill file moves into its date folder', async () => {
  const root = await tempInventory()
  const charger = await saveProduct(root, productInput({ title: 'Charger', sku: 'CH-1', units: 4, sellingPrice: 120, purchasingPrice: 80, colors: [] }))
  const bill = await createBill(root, { customerName: '', items: [{ folderName: charger.folderName, quantity: 2 }] })
  assert.equal((await getProduct(root, charger.folderName)).units, 2)

  const removed = await deleteBill(root, bill.number)
  assert.equal(removed.restored[0]?.quantity, 2)
  assert.deepEqual(removed.missing, [])
  assert.equal((await getProduct(root, charger.folderName)).units, 4)
  assert.deepEqual(await listBills(root), [])
  await assert.rejects(() => getBill(root, bill.number), /not found/)

  const legacy = {
    id: 'legacy-1',
    number: 9,
    customerName: 'Old',
    createdAt: '2026-09-01T12:00:00.000Z',
    items: [
      {
        folderName: charger.folderName,
        productId: charger.id,
        title: 'Charger',
        sku: 'CH-1',
        quantity: 1,
        unitPrice: 120,
        lineTotal: 120
      }
    ],
    total: 120
  }
  await fs.writeFile(path.join(root, 'bills', '0009.json'), JSON.stringify(legacy))
  const listed = await listBills(root)
  assert.equal(listed[0]?.number, 9)
  await fs.stat(path.join(root, 'bills', '2026-09-01', '0009.json'))
  const movedLog = await fs.readFile(path.join(root, 'bills', '2026-09-01', 'log.txt'), 'utf8')
  assert.match(movedLog, /Charger/)
  await assert.rejects(() => fs.stat(path.join(root, 'bills', '0009.json')))

  await deleteProduct(root, charger.folderName)
  const gone = await deleteBill(root, 9)
  assert.equal(gone.missing[0]?.title, 'Charger')
  assert.deepEqual(await listBills(root), [])
})

test('a bill keeps GST, a custom price, and the chosen date', async () => {
  const root = await tempInventory()
  const charger = await saveProduct(root, productInput({ title: 'Charger', sku: 'CH-1', units: 4, sellingPrice: 120, purchasingPrice: 80, colors: [] }))
  const bill = await createBill(root, {
    customerName: 'Ravi',
    customerAddress: 'Patna',
    customerPhone: '7050104072',
    customerEmail: 'a@b.co',
    notes: 'Paid at the counter',
    paymentMode: 'UPI',
    taxRate: 18,
    issuedOn: '2026-10-02',
    shopName: 'Anand Communication',
    shopAddress: 'Jakariyapur',
    items: [{ folderName: charger.folderName, quantity: 2, unitPrice: 100 }]
  })
  assert.equal(bill.items[0]?.category, 'Shirts')
  assert.equal(bill.subtotal, 200)
  assert.equal(bill.taxAmount, 36)
  assert.equal(bill.total, 236)
  assert.equal(bill.paymentMode, 'UPI')
  assert.equal(bill.shopName, 'Anand Communication')
  assert.equal(billDay(bill.createdAt), '2026-10-02')
  const stored = await getProduct(root, charger.folderName)
  assert.equal(stored.sellingPrice, 120)
  assert.equal(stored.units, 2)
  const log = await fs.readFile(path.join(root, 'bills', '2026-10-02', 'log.txt'), 'utf8')
  assert.match(log, /Tax \(18%\)/)
  assert.match(log, /UPI/)
})

test('selling price cannot be below purchasing price, and a photo can be left empty', async () => {
  const root = await tempInventory()
  await assert.rejects(
    () => saveProduct(root, productInput({ sellingPrice: 50, purchasingPrice: 80 })),
    /can't be less than the purchasing price/
  )
  const saved = await saveProduct(root, {
    ...productInput({ sellingPrice: 80, purchasingPrice: 80, units: 3 }),
    coverImage: null as unknown as SaveProductInput['coverImage'],
    colors: [{ name: 'Red', isDefault: true, image: null as unknown as SaveProductInput['coverImage'] }]
  })
  assert.equal(saved.coverImage, undefined)
  assert.equal(saved.units, 3)
  assert.equal(saved.colors[0]?.image, undefined)
  assert.equal((await listProducts(root)).products[0]?.units, 3)
})

test('unreadable product files are reported and skipped', async () => {
  const root = await tempInventory()
  const broken = path.join(root, 'products', 'broken__aaaaaa')
  await fs.mkdir(broken)
  await fs.writeFile(path.join(broken, 'product.json'), '{')
  const listed = await listProducts(root)
  assert.deepEqual(listed.unreadable, ['broken__aaaaaa'])
  assert.deepEqual(listed.products, [])
})
