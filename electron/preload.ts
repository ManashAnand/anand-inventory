import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { InventoryApi } from '../shared/types'

const api: InventoryApi = {
  getAccess: () => ipcRenderer.invoke('inventory:access-status'),
  activateAccess: (code) => ipcRenderer.invoke('inventory:activate-access', code),
  getSettings: () => ipcRenderer.invoke('inventory:get-settings'),
  pickFolder: () => ipcRenderer.invoke('inventory:pick-folder'),
  inspectFolder: (folderPath) => ipcRenderer.invoke('inventory:inspect-folder', folderPath),
  setDataRoot: (folderPath) => ipcRenderer.invoke('inventory:set-data-root', folderPath),
  createInventory: (folderPath, details) => ipcRenderer.invoke('inventory:create', folderPath, details),
  updateSettings: (details) => ipcRenderer.invoke('inventory:update-settings', details),
  listProducts: () => ipcRenderer.invoke('inventory:list-products'),
  getProduct: (folderName) => ipcRenderer.invoke('inventory:get-product', folderName),
  saveProduct: (input) => ipcRenderer.invoke('inventory:save-product', input),
  deleteProduct: (folderName) => ipcRenderer.invoke('inventory:delete-product', folderName),
  createBill: (input) => ipcRenderer.invoke('inventory:create-bill', input),
  listBills: () => ipcRenderer.invoke('inventory:list-bills'),
  getBill: (number) => ipcRenderer.invoke('inventory:get-bill', number),
  deleteBill: (number) => ipcRenderer.invoke('inventory:delete-bill', number),
  setBanner: (sourcePath) => ipcRenderer.invoke('inventory:set-banner', sourcePath),
  exportCsv: (defaultName, csv) => ipcRenderer.invoke('inventory:export-csv', defaultName, csv),
  exportPdf: (defaultName) => ipcRenderer.invoke('inventory:export-pdf', defaultName),
  shareWhatsApp: (text) => ipcRenderer.invoke('inventory:share-whatsapp', text),
  revealFolder: () => ipcRenderer.invoke('inventory:reveal-folder'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  platform: process.platform
}

contextBridge.exposeInMainWorld('inventory', api)
