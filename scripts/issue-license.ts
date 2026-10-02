import { readFileSync } from 'node:fs'
import { createPrivateKey } from 'node:crypto'
import path from 'node:path'
import { addCalendarDays, localDate, PLAN_LENGTH, signAccessCode, type LicensePlan } from '../electron/license'

const plan = process.argv[2] as LicensePlan
if (plan !== 'trial' && plan !== 'month' && plan !== 'quarter' && plan !== 'lifetime') {
  console.error('Usage: npm run license -- trial|month|quarter|lifetime')
  process.exit(1)
}

const keyPath = path.join(process.cwd(), 'license', 'private.pem')
let privateKey
try {
  privateKey = createPrivateKey(readFileSync(keyPath))
} catch {
  console.error(`Could not read the private key at ${keyPath}`)
  process.exit(1)
}

const code = signAccessCode(plan, privateKey)
const length = plan === 'lifetime' ? 'Lifetime' : `Valid through ${addCalendarDays(localDate(), PLAN_LENGTH[plan])}`
console.log(code)
console.log(length)
