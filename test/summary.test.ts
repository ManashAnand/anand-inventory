import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Bill, BillLine } from '../shared/types'
import { billsInMonth, categoryName, groupByCategory, salesSummary, stockSummary } from '../src/summary'

function line(overrides: Partial<BillLine> = {}): BillLine {
  return {
    folderName: 'charger__abc',
    productId: 'p1',
    title: 'Charger',
    sku: 'CH-1',
    category: 'Chargers',
    quantity: 2,
    unitPrice: 100,
    lineTotal: 200,
    ...overrides
  }
}

function bill(overrides: Partial<Bill> = {}): Bill {
  const items = overrides.items ?? [line()]
  return {
    id: 'b1',
    number: 1,
    customerName: 'Ravi',
    customerAddress: '',
    customerPhone: '',
    customerEmail: '',
    notes: '',
    paymentMode: 'Cash',
    taxRate: 0,
    subtotal: 200,
    taxAmount: 0,
    createdAt: '2026-10-02T10:00:00.000Z',
    items,
    total: 200,
    shopName: 'Anand',
    shopAddress: '',
    shopPhone: '',
    shopEmail: '',
    ...overrides
  }
}

test('stock value and purchasing total are grouped by category', () => {
  const summary = stockSummary([
    { category: 'Chargers', units: 4, sellingPrice: 120, purchasingPrice: 80 },
    { category: ' chargers ', units: 1, sellingPrice: 100, purchasingPrice: 50 },
    { category: '', units: 2, sellingPrice: 10, purchasingPrice: 4 }
  ])
  assert.equal(summary.units, 7)
  assert.equal(summary.stockValue, 600)
  assert.equal(summary.purchasing, 378)
  assert.equal(summary.categories[0]?.name, 'Chargers')
  assert.equal(summary.categories[0]?.units, 5)
  assert.equal(summary.categories[0]?.stockValue, 580)
  assert.equal(summary.categories[0]?.purchasing, 370)
  assert.equal(summary.categories[1]?.name, 'Uncategorized')
  assert.equal(categoryName('  '), 'Uncategorized')
})

test('a taxed bill splits the total across categories, and the month keeps only its own bills', () => {
  const taxed = bill({
    taxRate: 18,
    subtotal: 300,
    taxAmount: 54,
    total: 354,
    items: [
      line({ category: 'Chargers', quantity: 2, lineTotal: 200 }),
      line({ folderName: 'case__def', title: 'Case', category: 'Cases', quantity: 1, unitPrice: 100, lineTotal: 100 })
    ]
  })
  const older = bill({
    id: 'b2',
    number: 2,
    createdAt: '2026-09-30T10:00:00.000Z',
    total: 50,
    subtotal: 50,
    items: [line({ category: 'Chargers', quantity: 1, lineTotal: 50 })]
  })
  const october = salesSummary(billsInMonth([taxed, older], '2026-10'), (item) => item.category)
  assert.equal(october.bills, 1)
  assert.equal(october.amount, 354)
  assert.equal(october.units, 3)
  const chargers = october.categories.find((item) => item.name === 'Chargers')
  const cases = october.categories.find((item) => item.name === 'Cases')
  assert.equal(chargers?.units, 2)
  assert.equal(cases?.units, 1)
  assert.equal((chargers?.amount ?? 0) + (cases?.amount ?? 0), 354)

  const savedCategory = salesSummary([bill({ items: [line({ category: '' })] })], () => 'Cables')
  assert.equal(savedCategory.categories[0]?.name, 'Cables')
})

test('a price list groups products by category and sorts each group by name', () => {
  const groups = groupByCategory([
    { category: 'Chargers', title: 'Wall charger' },
    { category: ' chargers ', title: 'Car charger' },
    { category: '', title: 'Loose cable' },
    { category: 'Cases', title: 'Clear case' }
  ])
  assert.deepEqual(
    groups.map((group) => [group.name, group.items.map((item) => item.title)]),
    [
      ['Cases', ['Clear case']],
      ['Chargers', ['Car charger', 'Wall charger']],
      ['Uncategorized', ['Loose cable']]
    ]
  )
})
