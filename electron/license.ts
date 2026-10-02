import { createHmac, createPrivateKey, createPublicKey, randomBytes, sign, verify, type KeyObject } from 'node:crypto'
import type { AccessStatus } from '../shared/types'

export const PLAN_LENGTH = { trial: 9, month: 30, quarter: 90 } as const

export type LicensePlan = keyof typeof PLAN_LENGTH | 'lifetime'

export interface LicensePayload {
  v: 1
  plan: LicensePlan
  exp: string | null
  id: string
}

export const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAC4hwo5kZrg3C70LqOnulaJaTlqQDZGVbLWZy588i6GU=
-----END PUBLIC KEY-----`

const PLANS = new Set<LicensePlan>(['trial', 'month', 'quarter', 'lifetime'])

export function localDate(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function addCalendarDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const next = new Date(year, month - 1, date)
  next.setDate(next.getDate() + days)
  return localDate(next)
}

export function calendarDaysFrom(start: string, today: string): number {
  const [startYear, startMonth, startDay] = start.split('-').map(Number)
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number)
  const startUtc = Date.UTC(startYear, startMonth - 1, startDay)
  const todayUtc = Date.UTC(todayYear, todayMonth - 1, todayDay)
  return Math.round((todayUtc - startUtc) / 86_400_000)
}

export function signAccessCode(plan: LicensePlan, privateKey: KeyObject | string, today = localDate()): string {
  if (!PLANS.has(plan)) throw new Error('Choose month, quarter, or lifetime')
  const payload: LicensePayload = {
    v: 1,
    plan,
    exp: plan === 'lifetime' ? null : addCalendarDays(today, PLAN_LENGTH[plan]),
    id: randomBytes(6).toString('hex')
  }
  const body = canonical(payload)
  const signature = sign(null, Buffer.from(body), typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey)
  return `ANAND.${encode(body)}.${encode(signature)}`
}

export function verifyAccessCode(code: string, today = localDate(), publicKey: KeyObject | string = PUBLIC_KEY_PEM): LicensePayload {
  const cleaned = code.trim().replace(/\s+/g, '')
  const parts = cleaned.split('.')
  if (parts.length !== 3 || parts[0] !== 'ANAND') throw new Error('This access code is not valid')
  let payload: LicensePayload
  let signature: Buffer
  try {
    payload = JSON.parse(decode(parts[1]).toString('utf8')) as LicensePayload
    signature = decode(parts[2])
  } catch {
    throw new Error('This access code is not valid')
  }
  if (!payload || payload.v !== 1 || !PLANS.has(payload.plan) || typeof payload.id !== 'string') {
    throw new Error('This access code is not valid')
  }
  if (payload.plan === 'lifetime') {
    if (payload.exp !== null) throw new Error('This access code is not valid')
  } else if (typeof payload.exp !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.exp)) {
    throw new Error('This access code is not valid')
  }
  const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey
  const ok = verify(null, Buffer.from(canonical(payload)), key, signature)
  if (!ok) throw new Error('This access code is not valid')
  if (payload.exp && payload.exp < today) throw new Error(`This access code ended on ${payload.exp}`)
  return payload
}

export function evaluateAccess(
  file: { trialStartedOn: string; code?: string | null },
  today = localDate(),
  publicKey: KeyObject | string = PUBLIC_KEY_PEM
): AccessStatus {
  if (file.code) {
    try {
      const payload = verifyAccessCode(file.code, today, publicKey)
      return {
        state: payload.plan === 'trial' ? 'trial' : 'licensed',
        plan: payload.plan,
        daysLeft: payload.exp ? calendarDaysFrom(today, payload.exp) + 1 : null,
        expiresOn: payload.exp
      }
    } catch {
      // An expired or damaged code leaves the screens locked.
    }
  }
  return { state: 'locked', plan: null, daysLeft: 0, expiresOn: null }
}

export interface SavedAccess {
  trialStartedOn: string
  code: string | null
}

export type AccessCopy =
  | { kind: 'missing' }
  | { kind: 'sealed'; record: SavedAccess }
  | { kind: 'legacy'; record: SavedAccess }
  | { kind: 'invalid' }

const ACCESS_SEAL_SECRET = 'b7e1c4a9f03d48e6a25c91d7e8b0461f5c3a9d27e6b814f0c5d2a7e9b1f46380'

export function sealAccess(record: SavedAccess): string {
  const body = { v: 1 as const, trialStartedOn: record.trialStartedOn, code: record.code }
  const sealed = { ...body, seal: accessSeal(body) }
  return `${JSON.stringify(sealed, null, 2)}\n`
}

export function parseAccessCopy(raw: string | null | undefined): AccessCopy {
  if (raw == null || raw.trim() === '') return { kind: 'missing' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return { kind: 'invalid' }
  }
  if (!parsed || typeof parsed !== 'object') return { kind: 'invalid' }
  const record = parsed as { v?: unknown; trialStartedOn?: unknown; code?: unknown; seal?: unknown }
  const trialStartedOn = typeof record.trialStartedOn === 'string' ? record.trialStartedOn : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trialStartedOn)) return { kind: 'invalid' }
  const code = typeof record.code === 'string' && record.code.trim() ? record.code : null
  if (typeof record.seal !== 'string') return { kind: 'legacy', record: { trialStartedOn, code } }
  const body = { v: 1 as const, trialStartedOn, code }
  if (record.v !== 1 || record.seal !== accessSeal(body)) return { kind: 'invalid' }
  return { kind: 'sealed', record: { trialStartedOn, code } }
}

export function chooseAccess(copies: AccessCopy[]): { kind: 'first' } | { kind: 'tampered' } | { kind: 'ready'; record: SavedAccess } {
  const sealed = copies.flatMap((copy) => (copy.kind === 'sealed' ? [copy.record] : []))
  if (sealed.length > 0) return { kind: 'ready', record: earliestAccess(sealed) }
  const legacy = copies.flatMap((copy) => (copy.kind === 'legacy' ? [copy.record] : []))
  const invalid = copies.some((copy) => copy.kind === 'invalid')
  if (legacy.length > 0 && !invalid) return { kind: 'ready', record: earliestAccess(legacy) }
  if (invalid) return { kind: 'tampered' }
  return { kind: 'first' }
}

function earliestAccess(records: SavedAccess[]): SavedAccess {
  const trialStartedOn = [...records.map((record) => record.trialStartedOn)].sort()[0]
  const code = records.find((record) => record.code)?.code ?? null
  return { trialStartedOn, code }
}

function accessSeal(body: { v: 1; trialStartedOn: string; code: string | null }): string {
  return createHmac('sha256', ACCESS_SEAL_SECRET).update(`${body.v}|${body.trialStartedOn}|${body.code ?? ''}`).digest('hex')
}

function canonical(payload: LicensePayload): string {
  return JSON.stringify({ v: payload.v, plan: payload.plan, exp: payload.exp, id: payload.id })
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

function decode(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}
