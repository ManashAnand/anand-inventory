import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell, type MenuItemConstructorOptions } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { isInside, resolveProductMedia } from '../shared/media'
import type { AppState, CreateBillInput, FolderInspection, SaveProductInput, SetDataRootResult, ShopDetails } from '../shared/types'
import { currentAccess, saveAccessCode } from './access'
import { createBill, createInventory, deleteBill, deleteProduct, getBill, getProduct, inspectFolder, listBills, listProducts, saveProduct, setBanner, updateInventoryMeta } from './store'

app.setName('Inventory')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'inventory',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

let currentRoot: string | null = null

function imageType(extension: string): string {
  switch (extension.toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    default:
      return 'image/jpeg'
  }
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

async function readDataRoot(): Promise<string | null> {
  try {
    const raw = JSON.parse(await fs.readFile(configPath(), 'utf8')) as { dataRoot?: unknown }
    return typeof raw.dataRoot === 'string' && raw.dataRoot.trim() ? raw.dataRoot : null
  } catch {
    return null
  }
}

async function writeDataRoot(dataRoot: string): Promise<void> {
  await fs.mkdir(path.dirname(configPath()), { recursive: true })
  const tmp = `${configPath()}.${process.pid}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify({ dataRoot }, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, configPath()).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPERM' && error.code !== 'EEXIST') throw error
    await fs.rm(configPath(), { force: true })
    await fs.rename(tmp, configPath())
  })
}

async function getSettings(): Promise<AppState> {
  const dataRoot = await readDataRoot()
  if (!dataRoot) {
    currentRoot = null
    return { status: 'unset', dataRoot: null, inventory: null }
  }

  const inspection = await inspectFolder(dataRoot)
  if (inspection.kind === 'inventory' && inspection.inventory) {
    currentRoot = dataRoot
    await ensureBanner(dataRoot)
    return { status: 'ready', dataRoot, inventory: inspection.inventory }
  }

  currentRoot = null
  if (inspection.kind === 'missing') return { status: 'missing', dataRoot, inventory: null }
  if (inspection.kind === 'newer-version') return { status: 'newer-version', dataRoot, inventory: null }
  return { status: 'not-inventory', dataRoot, inventory: null }
}

function requireRoot(): string {
  if (!currentRoot) throw new Error('Choose an inventory folder first')
  return currentRoot
}

async function requireOpen(): Promise<void> {
  const status = await currentAccess()
  if (status.state === 'locked') throw new Error('Enter an access code to open the shop')
}

function detailsFrom(value: unknown): ShopDetails {
  if (!value || typeof value !== 'object') return { shopName: '', currency: 'INR' }
  const record = value as Record<string, unknown>
  return {
    shopName: typeof record.shopName === 'string' ? record.shopName : '',
    currency: typeof record.currency === 'string' ? record.currency : 'INR',
    address: typeof record.address === 'string' ? record.address : '',
    phone: typeof record.phone === 'string' ? record.phone : '',
    email: typeof record.email === 'string' ? record.email : ''
  }
}

const BANNER_NAMES = ['banner.png', 'banner.jpg', 'banner.jpeg', 'banner.webp', 'banner.gif']

async function ensureBanner(dataRoot: string): Promise<void> {
  for (const name of BANNER_NAMES) {
    try {
      const stats = await fs.stat(path.join(dataRoot, name))
      if (stats.isFile() && stats.size > 0) return
    } catch {
      // Try the next filename.
    }
  }
  const source = app.isPackaged
    ? path.join(process.resourcesPath, 'letterhead.png')
    : path.join(app.getAppPath(), 'resources', 'letterhead.png')
  try {
    await fs.copyFile(source, path.join(dataRoot, 'banner.png'))
  } catch (error) {
    console.error('Could not copy the shop banner', error)
  }
}

async function readBanner(dataRoot: string): Promise<{ data: Buffer; type: string } | null> {
  for (const name of BANNER_NAMES) {
    const filePath = path.resolve(dataRoot, name)
    if (!isInside(path.resolve(dataRoot), filePath)) continue
    try {
      const data = await fs.readFile(filePath)
      return { data, type: imageType(path.extname(filePath)) }
    } catch {
      continue
    }
  }
  return null
}

function registerIpc(): void {
  ipcMain.handle('inventory:access-status', () => currentAccess())

  ipcMain.handle('inventory:activate-access', async (_event, code: unknown) => {
    if (typeof code !== 'string' || !code.trim()) throw new Error('Enter an access code')
    return saveAccessCode(code)
  })

  ipcMain.handle('inventory:get-settings', async () => {
    await requireOpen()
    return getSettings()
  })

  ipcMain.handle('inventory:pick-folder', async () => {
    await requireOpen()
    const state = await getSettings()
    const result = await dialog.showOpenDialog({
      title: 'Choose inventory folder',
      defaultPath: state.dataRoot ?? app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('inventory:inspect-folder', async (_event, folderPath: unknown): Promise<FolderInspection> => {
    await requireOpen()
    if (typeof folderPath !== 'string' || !folderPath.trim()) throw new Error('Choose a folder')
    return inspectFolder(folderPath)
  })

  ipcMain.handle('inventory:set-data-root', async (_event, folderPath: unknown): Promise<SetDataRootResult> => {
    await requireOpen()
    if (typeof folderPath !== 'string' || !folderPath.trim()) throw new Error('Choose a folder')
    const inspection = await inspectFolder(folderPath)
    if (inspection.kind === 'newer-version') {
      throw new Error('That folder was created by a newer version of this app')
    }
    if (inspection.kind === 'missing') throw new Error('That folder could not be opened')
    if (inspection.kind !== 'inventory') {
      return { state: await getSettings(), needsCreate: true }
    }
    await writeDataRoot(folderPath)
    return { state: await getSettings(), needsCreate: false }
  })

  ipcMain.handle('inventory:create', async (_event, folderPath: unknown, details: unknown) => {
    await requireOpen()
    if (typeof folderPath !== 'string' || !folderPath.trim()) throw new Error('Choose a folder')
    await createInventory(folderPath, detailsFrom(details))
    await writeDataRoot(folderPath)
    return getSettings()
  })

  ipcMain.handle('inventory:update-settings', async (_event, details: unknown) => {
    await requireOpen()
    const root = requireRoot()
    await updateInventoryMeta(root, detailsFrom(details))
    return getSettings()
  })

  ipcMain.handle('inventory:list-products', async () => {
    await requireOpen()
    return listProducts(requireRoot())
  })

  ipcMain.handle('inventory:get-product', async (_event, folderName: unknown) => {
    await requireOpen()
    if (typeof folderName !== 'string') throw new Error('Invalid product folder')
    return getProduct(requireRoot(), folderName)
  })

  ipcMain.handle('inventory:save-product', async (_event, input: unknown) => {
    await requireOpen()
    if (!input || typeof input !== 'object') throw new Error('Product details are missing')
    return saveProduct(requireRoot(), input as SaveProductInput)
  })

  ipcMain.handle('inventory:delete-product', async (_event, folderName: unknown) => {
    await requireOpen()
    if (typeof folderName !== 'string') throw new Error('Invalid product folder')
    await deleteProduct(requireRoot(), folderName)
  })

  ipcMain.handle('inventory:create-bill', async (_event, input: unknown) => {
    await requireOpen()
    if (!input || typeof input !== 'object') throw new Error('Bill details are missing')
    return createBill(requireRoot(), input as CreateBillInput)
  })

  ipcMain.handle('inventory:list-bills', async () => {
    await requireOpen()
    return listBills(requireRoot())
  })

  ipcMain.handle('inventory:get-bill', async (_event, number: unknown) => {
    await requireOpen()
    if (typeof number !== 'number') throw new Error('That bill was not found')
    return getBill(requireRoot(), number)
  })

  ipcMain.handle('inventory:delete-bill', async (_event, number: unknown) => {
    await requireOpen()
    if (typeof number !== 'number') throw new Error('That bill was not found')
    return deleteBill(requireRoot(), number)
  })

  ipcMain.handle('inventory:reveal-folder', async () => {
    await requireOpen()
    const root = requireRoot()
    shell.showItemInFolder(root)
  })

  ipcMain.handle('inventory:set-banner', async (_event, sourcePath: unknown) => {
    await requireOpen()
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) throw new Error('Choose an image')
    await setBanner(requireRoot(), sourcePath)
  })

  ipcMain.handle('inventory:export-csv', async (_event, defaultName: unknown, csv: unknown) => {
    await requireOpen()
    if (typeof defaultName !== 'string' || typeof csv !== 'string') throw new Error('Could not export this bill')
    const result = await dialog.showSaveDialog({
      title: 'Export to Excel',
      defaultPath: defaultName.endsWith('.csv') ? defaultName : `${defaultName}.csv`,
      filters: [{ name: 'Excel', extensions: ['csv'] }]
    })
    if (result.canceled || !result.filePath) return false
    await fs.writeFile(result.filePath, csv, 'utf8')
    return true
  })

  ipcMain.handle('inventory:export-pdf', async (event, defaultName: unknown) => {
    await requireOpen()
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || typeof defaultName !== 'string') throw new Error('Could not create the PDF')
    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4'
    })
    const result = await dialog.showSaveDialog({
      title: 'Download PDF',
      defaultPath: defaultName.endsWith('.pdf') ? defaultName : `${defaultName}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return false
    await fs.writeFile(result.filePath, pdf)
    return true
  })

  ipcMain.handle('inventory:share-whatsapp', async (_event, text: unknown) => {
    await requireOpen()
    if (typeof text !== 'string' || !text.trim()) throw new Error('There is nothing to share')
    await shell.openExternal(`https://wa.me/?text=${encodeURIComponent(text)}`)
  })
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#f3eee6',
    show: false,
    autoHideMenuBar: true,
    title: 'Inventory',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.on('did-fail-load', (_event, code, description) => {
    console.error(`Failed to load the window (${code}): ${description}`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`The window stopped: ${details.reason}`)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  protocol.handle('inventory', async (request) => {
    try {
      if (!currentRoot) return new Response('Not found', { status: 404 })
      const url = new URL(request.url)
      if (url.hostname === 'shop') {
        const banner = await readBanner(currentRoot)
        if (!banner) return new Response('Not found', { status: 404 })
        return new Response(new Uint8Array(banner.data), {
          headers: { 'Content-Type': banner.type, 'Cache-Control': 'no-cache' }
        })
      }
      if (url.hostname !== 'media') return new Response('Not found', { status: 404 })
      const filePath = resolveProductMedia(currentRoot, url.pathname)
      const data = await fs.readFile(filePath)
      const type = imageType(path.extname(filePath))
      return new Response(new Uint8Array(data), {
        headers: { 'Content-Type': type, 'Cache-Control': 'no-cache' }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  const template: MenuItemConstructorOptions[] = [
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  if (process.platform === 'darwin') template.unshift({ role: 'appMenu' })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; img-src 'self' blob: inventory: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'"
          ]
        }
      })
    })
  }

  await getSettings()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
