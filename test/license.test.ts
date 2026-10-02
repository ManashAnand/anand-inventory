import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { test } from 'node:test'
import { addCalendarDays, chooseAccess, evaluateAccess, parseAccessCopy, sealAccess, signAccessCode, verifyAccessCode } from '../electron/license'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')

test('a signed month code unlocks through its end date and then locks', () => {
  const code = signAccessCode('month', privateKey, '2026-10-02')
  const payload = verifyAccessCode(code, '2026-10-02', publicKey)
  assert.equal(payload.plan, 'month')
  assert.equal(payload.exp, '2026-11-01')

  const active = evaluateAccess({ trialStartedOn: '2026-09-01', code }, '2026-11-01', publicKey)
  assert.equal(active.state, 'licensed')
  assert.equal(active.daysLeft, 1)

  assert.throws(() => verifyAccessCode(code, '2026-11-02', publicKey), /ended on 2026-11-01/)
  const locked = evaluateAccess({ trialStartedOn: '2026-09-01', code }, '2026-11-02', publicKey)
  assert.equal(locked.state, 'locked')
})

test('lifetime has no expiry and a changed code is rejected', () => {
  const code = signAccessCode('lifetime', privateKey, '2026-10-02')
  const status = evaluateAccess({ trialStartedOn: '2020-01-01', code }, '2030-01-01', publicKey)
  assert.equal(status.state, 'licensed')
  assert.equal(status.daysLeft, null)
  assert.throws(() => verifyAccessCode(`${code}x`, '2026-10-02', publicKey), /not valid/)
})

test('a signed trial lasts 10 days and opening with no code stays locked', () => {
  const code = signAccessCode('trial', privateKey, '2026-10-02')
  const first = evaluateAccess({ trialStartedOn: '2026-10-02', code }, '2026-10-02', publicKey)
  assert.equal(first.state, 'trial')
  assert.equal(first.daysLeft, 10)
  assert.equal(first.expiresOn, '2026-10-11')

  const last = evaluateAccess({ trialStartedOn: '2026-10-02', code }, '2026-10-11', publicKey)
  assert.equal(last.state, 'trial')
  assert.equal(last.daysLeft, 1)

  const ended = evaluateAccess({ trialStartedOn: '2026-10-02', code }, '2026-10-12', publicKey)
  assert.equal(ended.state, 'locked')
  const fresh = evaluateAccess({ trialStartedOn: '2026-10-13', code: null }, '2026-10-13')
  assert.equal(fresh.state, 'locked')
  assert.equal(addCalendarDays('2026-10-02', 30), '2026-11-01')
})

test('editing the saved trial date does not start the trial over', () => {
  const sealed = sealAccess({ trialStartedOn: '2026-09-21', code: null })
  const edited = sealed.replace('2026-09-21', '2026-10-02')
  assert.equal(parseAccessCopy(edited).kind, 'invalid')
  const choice = chooseAccess([parseAccessCopy(edited), parseAccessCopy(sealed)])
  assert.equal(choice.kind, 'ready')
  if (choice.kind === 'ready') assert.equal(choice.record.trialStartedOn, '2026-09-21')
  assert.equal(chooseAccess([parseAccessCopy(edited)]).kind, 'tampered')
  assert.equal(chooseAccess([{ kind: 'missing' }, { kind: 'missing' }]).kind, 'first')
})

test('wiping the saved date does not create a trial without a code', () => {
  const status = evaluateAccess({ trialStartedOn: '2026-10-02', code: null }, '2026-10-02')
  assert.equal(status.state, 'locked')
})
