import type { InventoryApi } from '../shared/types'

declare global {
  interface Window {
    inventory: InventoryApi
  }
}

export {}
