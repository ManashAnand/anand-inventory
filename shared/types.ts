export const FORMAT_VERSION = 1

export interface ShopDetails {
  shopName: string
  currency: string
  address?: string
  phone?: string
  email?: string
}

export interface InventoryMeta extends ShopDetails {
  formatVersion: number
  createdAt: string
}

export type RootStatus = 'unset' | 'missing' | 'not-inventory' | 'newer-version' | 'ready'

export interface AppState {
  status: RootStatus
  dataRoot: string | null
  inventory: InventoryMeta | null
}

export interface ProductColor {
  id: string
  name: string
  isDefault: boolean
  image?: string
}

export interface Product {
  id: string
  title: string
  brand: string
  category: string
  sku: string
  sellingPrice: number
  purchasingPrice: number
  units: number
  description: string
  notes: string
  coverImage?: string
  colors: ProductColor[]
  createdAt: string
  updatedAt: string
}

export interface ProductSummary {
  folderName: string
  id: string
  title: string
  brand: string
  category: string
  sku: string
  sellingPrice: number
  purchasingPrice: number
  units: number
  coverImage?: string
  defaultColor?: string
  updatedAt: string
}

export interface ProductDetails extends Product {
  folderName: string
}

export type ImageInput =
  | { kind: 'empty' }
  | { kind: 'keep'; relativePath: string }
  | { kind: 'file'; sourcePath: string }

export interface SaveColorInput {
  id?: string
  name: string
  isDefault: boolean
  image: ImageInput
}

export interface SaveProductInput {
  folderName?: string
  title: string
  brand: string
  category: string
  sku: string
  sellingPrice: number
  purchasingPrice: number
  units: number
  description: string
  notes: string
  coverImage: ImageInput
  colors: SaveColorInput[]
}

export interface ProductList {
  products: ProductSummary[]
  unreadable: string[]
}

export interface BillLine {
  folderName: string
  productId: string
  title: string
  sku: string
  category: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export interface Bill {
  id: string
  number: number
  customerName: string
  customerAddress: string
  customerPhone: string
  customerEmail: string
  notes: string
  paymentMode: string
  taxRate: number
  subtotal: number
  taxAmount: number
  createdAt: string
  items: BillLine[]
  total: number
  shopName: string
  shopAddress: string
  shopPhone: string
  shopEmail: string
}

export interface CreateBillInput {
  customerName: string
  customerAddress?: string
  customerPhone?: string
  customerEmail?: string
  notes?: string
  paymentMode?: string
  taxRate?: number
  issuedOn?: string
  shopName?: string
  shopAddress?: string
  shopPhone?: string
  shopEmail?: string
  items: Array<{ folderName: string; quantity: number; unitPrice?: number }>
}

export interface BillStockChange {
  title: string
  quantity: number
}

export interface DeleteBillResult {
  restored: BillStockChange[]
  missing: BillStockChange[]
}

export interface FolderInspection {
  kind: 'missing' | 'inventory' | 'plain' | 'newer-version'
  hasEntries: boolean
  inventory?: InventoryMeta
}

export interface SetDataRootResult {
  state: AppState
  needsCreate: boolean
}

export interface AccessStatus {
  state: 'trial' | 'licensed' | 'locked'
  plan: 'trial' | 'month' | 'quarter' | 'lifetime' | null
  daysLeft: number | null
  expiresOn: string | null
}

export interface InventoryApi {
  getAccess: () => Promise<AccessStatus>
  activateAccess: (code: string) => Promise<AccessStatus>
  getSettings: () => Promise<AppState>
  pickFolder: () => Promise<string | null>
  inspectFolder: (folderPath: string) => Promise<FolderInspection>
  setDataRoot: (folderPath: string) => Promise<SetDataRootResult>
  createInventory: (folderPath: string, details: ShopDetails) => Promise<AppState>
  updateSettings: (details: ShopDetails) => Promise<AppState>
  setBanner: (sourcePath: string) => Promise<void>
  exportCsv: (defaultName: string, csv: string) => Promise<boolean>
  exportPdf: (defaultName: string) => Promise<boolean>
  shareWhatsApp: (text: string) => Promise<void>
  listProducts: () => Promise<ProductList>
  getProduct: (folderName: string) => Promise<ProductDetails>
  saveProduct: (input: SaveProductInput) => Promise<ProductDetails>
  deleteProduct: (folderName: string) => Promise<void>
  createBill: (input: CreateBillInput) => Promise<Bill>
  listBills: () => Promise<Bill[]>
  getBill: (number: number) => Promise<Bill>
  deleteBill: (number: number) => Promise<DeleteBillResult>
  revealFolder: () => Promise<void>
  getPathForFile: (file: File) => string
  platform: NodeJS.Platform
}
