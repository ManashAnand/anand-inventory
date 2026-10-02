export function stockCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

export function stockLabel(value: unknown): string {
  const count = stockCount(value)
  return count === 1 ? '1 in stock' : `${count} in stock`
}

export function billDayKey(createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return 'unknown-date'
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function stockRestoreMessage(result: { restored: Array<{ title: string; quantity: number }>; missing: Array<{ title: string }> }): string {
  const parts: string[] = []
  if (result.restored.length > 0) {
    const detail = result.restored
      .map((item) => `${item.quantity} ${item.quantity === 1 ? 'unit' : 'units'} to ${item.title}`)
      .join(', ')
    parts.push(`Returned ${detail}.`)
  }
  if (result.missing.length > 0) {
    const names = result.missing.map((item) => item.title).join(', ')
    parts.push(`${names} ${result.missing.length === 1 ? 'is' : 'are'} no longer in the catalog, so that stock was not returned.`)
  }
  return parts.join(' ') || 'Bill deleted.'
}

export function formatBillNumber(number: number): string {
  return `#${String(number).padStart(4, '0')}`
}

export function formatInvoiceNumber(number: number): string {
  return `INV-${String(number).padStart(4, '0')}`
}

export function todayInputDate(): string {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export function folderLabel(folderPath: string): string {
  const parts = folderPath.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? folderPath
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallback
}
