import type { Bill } from '../shared/types'
import { formatInvoiceNumber, formatMoney } from './format'

export const shopContactDefaults = {
  address: 'Near Krishna Niketan, jakariyapur , patna , Bihar 800030',
  phone: '7050104072',
  email: 'abhinavanand.aj@gmail.com'
}

export const taxRates = [0, 5, 12, 18, 28] as const

export const paymentModes = [
  { value: 'Cash', label: 'Cash Payment' },
  { value: 'UPI', label: 'UPI' },
  { value: 'Card', label: 'Card' },
  { value: 'Credit', label: 'Credit' }
] as const

export interface InvoiceModel {
  numberLabel: string
  dateLabel: string
  shopName: string
  address: string
  phone: string
  email: string
  customerName: string
  customerAddress: string
  customerPhone: string
  customerEmail: string
  notes: string
  paymentMode: string
  taxRate: number
  items: Array<{ key: string; title: string; quantity: number; unitPrice: number; lineTotal: number }>
  subtotal: number
  taxAmount: number
  total: number
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export function billTotals(lines: Array<{ quantity: number; unitPrice: number }>, taxRate: number) {
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0))
  const taxAmount = roundMoney((subtotal * taxRate) / 100)
  return { subtotal, taxAmount, total: roundMoney(subtotal + taxAmount) }
}

export function filledContact(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? ''
  return trimmed || fallback
}

export function modelFromBill(
  bill: Bill,
  shop: { shopName?: string; address?: string; phone?: string; email?: string }
): InvoiceModel {
  return {
    numberLabel: formatInvoiceNumber(bill.number),
    dateLabel: bill.createdAt ? new Date(bill.createdAt).toLocaleDateString() : '',
    shopName: bill.shopName || shop.shopName || '',
    address: bill.shopAddress || shop.address || '',
    phone: bill.shopPhone || shop.phone || '',
    email: bill.shopEmail || shop.email || '',
    customerName: bill.customerName,
    customerAddress: bill.customerAddress,
    customerPhone: bill.customerPhone,
    customerEmail: bill.customerEmail,
    notes: bill.notes,
    paymentMode: bill.paymentMode,
    taxRate: bill.taxRate,
    items: bill.items.map((item) => ({
      key: `${item.folderName}-${item.productId}`,
      title: item.title,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal
    })),
    subtotal: bill.subtotal,
    taxAmount: bill.taxAmount,
    total: bill.total
  }
}

export function whatsAppText(model: InvoiceModel, currency: string): string {
  const items = model.items
    .map((item) => `${item.title} × ${item.quantity} = ${formatMoney(item.lineTotal, currency)}`)
    .join('\n')
  const customer = [model.customerName, model.customerAddress, model.customerPhone, model.customerEmail]
    .filter(Boolean)
    .join('\n')
  return [
    model.shopName,
    model.address,
    [model.phone, model.email].filter(Boolean).join(' · '),
    '',
    model.numberLabel,
    model.dateLabel,
    customer ? `\nBill to:\n${customer}` : '',
    '',
    items,
    '',
    `Subtotal: ${formatMoney(model.subtotal, currency)}`,
    `Tax (${model.taxRate}%): ${formatMoney(model.taxAmount, currency)}`,
    `Total: ${formatMoney(model.total, currency)}`,
    model.paymentMode ? `Payment: ${paymentLabel(model.paymentMode)}` : '',
    model.notes ? `Notes: ${model.notes}` : ''
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export function invoiceCsv(model: InvoiceModel): string {
  const header = [
    'Invoice',
    'Date',
    'Company',
    'Customer',
    'Customer address',
    'Customer phone',
    'Customer email',
    'Description',
    'Quantity',
    'Price',
    'Amount',
    'Payment',
    'Tax rate',
    'Tax',
    'Total',
    'Notes'
  ]
  const rows = model.items.map((item, index) => [
    model.numberLabel,
    model.dateLabel,
    model.shopName,
    model.customerName,
    model.customerAddress,
    model.customerPhone,
    model.customerEmail,
    item.title,
    item.quantity,
    item.unitPrice,
    item.lineTotal,
    index === 0 ? paymentLabel(model.paymentMode) : '',
    index === 0 ? model.taxRate : '',
    index === 0 ? model.taxAmount : '',
    index === 0 ? model.total : '',
    index === 0 ? model.notes : ''
  ])
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`
}

export function paymentLabel(mode: string): string {
  return paymentModes.find((item) => item.value === mode)?.label ?? mode
}

function csvCell(value: string | number): string {
  const text = String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}
