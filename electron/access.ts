import { execFile } from 'node:child_process'
import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { promisify } from 'node:util'
import type { AccessStatus } from '../shared/types'
import { chooseAccess, evaluateAccess, localDate, parseAccessCopy, sealAccess, verifyAccessCode, type SavedAccess } from './license'

const execFileAsync = promisify(execFile)
const KEYCHAIN_ACCOUNT = 'anand-inventory'
const KEYCHAIN_SERVICE = 'com.anand.inventory.access'

function primaryPath(): string {
  return path.join(app.getPath('userData'), 'access.json')
}

function backupPath(): string {
  return path.join(app.getPath('appData'), 'com.anand.inventory', 'access.json')
}

export async function currentAccess(): Promise<AccessStatus> {
  const copies = await readCopies()
  const choice = chooseAccess(copies)
  if (choice.kind === 'tampered') {
    return { state: 'locked', plan: null, daysLeft: 0, expiresOn: null }
  }
  if (choice.kind === 'first') {
    const created = { trialStartedOn: localDate(), code: null }
    await writeCopies(created)
    return evaluateAccess(created)
  }
  await writeCopies(choice.record)
  return evaluateAccess(choice.record)
}

export async function saveAccessCode(code: string): Promise<AccessStatus> {
  const cleaned = code.trim().replace(/\s+/g, '')
  verifyAccessCode(cleaned)
  const copies = await readCopies()
  const choice = chooseAccess(copies)
  const trialStartedOn = choice.kind === 'ready' ? choice.record.trialStartedOn : localDate()
  const record = { trialStartedOn, code: cleaned }
  await writeCopies(record)
  return evaluateAccess(record)
}

async function readCopies() {
  const [primary, backup, keychain] = await Promise.all([readText(primaryPath()), readText(backupPath()), readKeychain()])
  return [parseAccessCopy(primary), parseAccessCopy(backup), parseAccessCopy(keychain)]
}

async function writeCopies(record: SavedAccess): Promise<void> {
  const sealed = sealAccess(record)
  await Promise.all([writeText(primaryPath(), sealed), writeText(backupPath(), sealed), writeKeychain(sealed)])
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

async function writeText(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, value, 'utf8')
}

async function readKeychain(): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-a',
      KEYCHAIN_ACCOUNT,
      '-s',
      KEYCHAIN_SERVICE,
      '-w'
    ])
    return stdout.trim()
  } catch {
    return null
  }
}

async function writeKeychain(value: string): Promise<void> {
  if (process.platform !== 'darwin') return
  try {
    await execFileAsync('security', [
      'add-generic-password',
      '-U',
      '-a',
      KEYCHAIN_ACCOUNT,
      '-s',
      KEYCHAIN_SERVICE,
      '-w',
      value
    ])
  } catch (error) {
    console.error('Could not save the access record in the keychain', error)
  }
}
