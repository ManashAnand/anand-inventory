import type { Bill, BillLine } from '../shared/types'
import { billDayKey } from './format'

export interface StockCategory {
  name: string
  units: number
  stockValue: number
  purchasing: number
}

export interface StockSummary {
  units: number
  stockValue: number
  purchasing: number
  categories: StockCategory[]
}

export interface SalesCategory {
  name: string
  units: number
  amount: number
}

export interface SalesSummary {
  bills: number
  units: number
  amount: number
  categories: SalesCategory[]
}

export function categoryName(value: string | undefined | null): string {
  const name = value?.trim()
  return name || 'Uncategorized'
}

export function monthKeyFromDay(day: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.slice(0, 7) : ''
}

export function monthLabel(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey)
  if (!match) return 'This month'
  const year = Number(match[1])
  const month = Number(match[2])
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function stockSummary(
  products: Array<{ category?: string; units: number; sellingPrice: number; purchasingPrice: number }>
): StockSummary {
  const categories = new Map<string, { name: string; units: number; stockValue: number; purchasing: number }>()
  let units = 0
  let stockValue = 0
  let purchasing = 0
  for (const product of products) {
    const count = Math.max(0, Math.floor(product.units))
    const sellingCents = cents(product.sellingPrice * count)
    const purchasingCents = cents(product.purchasingPrice * count)
    const named = categoryKey(product.category)
    const current = categories.get(named.key) ?? { name: named.name, units: 0, stockValue: 0, purchasing: 0 }
    current.units += count
    current.stockValue += sellingCents
    current.purchasing += purchasingCents
    categories.set(named.key, current)
    units += count
    stockValue += sellingCents
    purchasing += purchasingCents
  }
  return {
    units,
    stockValue: fromCents(stockValue),
    purchasing: fromCents(purchasing),
    categories: [...categories.entries()]
      .map(([, value]) => ({
        name: value.name,
        units: value.units,
        stockValue: fromCents(value.stockValue),
        purchasing: fromCents(value.purchasing)
      }))
      .sort((a, b) => b.stockValue - a.stockValue || a.name.localeCompare(b.name))
  }
}

export function salesSummary(bills: Bill[], categoryOf: (line: BillLine) => string): SalesSummary {
  const categories = new Map<string, { name: string; units: number; amount: number }>()
  let amount = 0
  let units = 0
  for (const bill of bills) {
    amount += cents(bill.total)
    for (const share of lineShareCents(bill)) {
      const named = categoryKey(categoryOf(share.line))
      const current = categories.get(named.key) ?? { name: named.name, units: 0, amount: 0 }
      current.units += share.line.quantity
      current.amount += share.cents
      categories.set(named.key, current)
      units += share.line.quantity
    }
  }
  return {
    bills: bills.length,
    units,
    amount: fromCents(amount),
    categories: [...categories.entries()]
      .map(([, value]) => ({ name: value.name, units: value.units, amount: fromCents(value.amount) }))
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
  }
}

export function groupByCategory<T extends { category?: string; title: string }>(items: T[]): Array<{ name: string; items: T[] }> {
  const groups = new Map<string, { name: string; items: T[] }>()
  for (const item of items) {
    const named = categoryKey(item.category)
    const current = groups.get(named.key) ?? { name: named.name, items: [] }
    current.items.push(item)
    groups.set(named.key, current)
  }
  for (const group of groups.values()) {
    group.items.sort((a, b) => a.title.localeCompare(b.title))
  }
  return [...groups.values()].sort((a, b) => {
    if (a.name === 'Uncategorized') return 1
    if (b.name === 'Uncategorized') return -1
    return a.name.localeCompare(b.name)
  })
}

export function billsInMonth(bills: Bill[], monthKey: string): Bill[] {
  return bills.filter((bill) => monthKeyFromDay(billDayKey(bill.createdAt)) === monthKey)
}

function lineShareCents(bill: Bill): Array<{ line: BillLine; cents: number }> {
  const lines = bill.items
  if (lines.length === 0) return []
  const totalCents = cents(bill.total)
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0)
  const raw = lines.map((line) => (subtotal > 0 ? line.lineTotal / subtotal : 1 / lines.length) * totalCents)
  const shares = raw.map((value) => Math.floor(value))
  let leftover = totalCents - shares.reduce((sum, value) => sum + value, 0)
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (const item of order) {
    if (leftover <= 0) break
    shares[item.index] += 1
    leftover -= 1
  }
  return lines.map((line, index) => ({ line, cents: shares[index] ?? 0 }))
}

function categoryKey(value: string | undefined | null): { key: string; name: string } {
  const name = categoryName(value)
  return { key: name.toLowerCase(), name }
}

function cents(value: number): number {
  return Math.round(value * 100)
}

function fromCents(value: number): number {
  return value / 100
}
