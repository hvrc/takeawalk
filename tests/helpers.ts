import { expect, type Page } from '@playwright/test'

export const PROJECT = 'demo-takeawalk'
export const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
export const STORAGE = `http://127.0.0.1:9199/v0/b/${PROJECT}.appspot.com/o`
export const OWNER = { Authorization: 'Bearer owner' } // emulator admin: skips rules

/** An unsigned ID token the emulators accept: lets a REST call act as `uid` under the rules. */
export function as(uid: string) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const jwt = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: uid, user_id: uid, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'password' } })}.`
  return { Authorization: `Bearer ${jwt}` }
}

/** Sign up through the landing page and land on home. Returns the username. */
export async function signUp(page: Page, name: string, password = 'walking1') {
  const username = `${name}${Date.now().toString(36).slice(-5)}`.toLowerCase()
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign up' }).click()
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Email').fill(`${username}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Make my account' }).click()
  await expect(page.getByText('All walks')).toBeVisible({ timeout: 20_000 })
  return username
}
