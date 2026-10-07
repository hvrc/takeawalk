import { test, expect } from '@playwright/test'
import { signUp } from './helpers'

// Needs the admin server on :8787 against the emulators (see the README's
// "Develop locally"); the dev server proxies /api to it.
const PROJECT = 'demo-takeawalk'
const BUCKET = 'demo-takeawalk.appspot.com'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const STORAGE = `http://127.0.0.1:9199/v0/b/${BUCKET}/o`
const OWNER = { Authorization: 'Bearer owner' }

async function seedWalk(name: string) {
  const id = `admin${Date.now().toString(36)}`
  const now = Date.now()
  const post = (path: string, fields: object) => fetch(`${FS}/${path}`, { method: 'POST', headers: OWNER, body: JSON.stringify({ fields }) })
  await post(`trips?documentId=${id}`, {
    name: { stringValue: name },
    code: { stringValue: 'ADMN' },
    status: { stringValue: 'active' },
    visibility: { stringValue: 'public' },
    createdAt: { integerValue: String(now) },
    updatedAt: { integerValue: String(now) },
    polaroidCount: { integerValue: '1' },
  })
  await post(`trips/${id}/segments?documentId=s1`, { memberId: { stringValue: 'm1' }, points: { arrayValue: { values: [] } } })
  const image = `trips/${id}/polaroids/p1.jpg`
  await fetch(`${STORAGE}?name=${encodeURIComponent(image)}`, { method: 'POST', headers: { ...OWNER, 'Content-Type': 'image/jpeg' }, body: Buffer.alloc(2000, 1) })
  await post(`trips/${id}/polaroids?documentId=p1`, { caption: { stringValue: 'x' }, imagePath: { stringValue: image }, memberId: { stringValue: 'm1' } })
  return { id, image }
}

const exists = async (url: string) => (await fetch(url, { headers: OWNER })).status === 200

test('admin can sign in, hide and delete walks; nobody else can', async ({ page }) => {
  const walk = await seedWalk(`admin test ${Date.now().toString(36).slice(-4)}`)
  const name = (await (await fetch(`${FS}/trips/${walk.id}`, { headers: OWNER })).json()).fields.name.stringValue

  // The API refuses requests without a sign-in.
  expect((await page.request.get('/api/admin/walks')).status()).toBe(401)
  expect((await page.request.delete(`/api/admin/walks/${walk.id}`)).status()).toBe(401)

  await page.goto('/admin')
  await page.getByLabel('Password').fill('nope')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Wrong name or password.')).toBeVisible()
  await page.getByLabel('Password').fill('1234')
  await page.getByRole('button', { name: 'Sign in' }).click()
  const card = page.locator('.admin-walk', { hasText: name })
  await expect(card).toHaveCount(1)
  await page.screenshot({ path: 'test-results/shots/12-admin.png' })

  // Hide: gone from the public list.
  await card.getByRole('button', { name: 'Hide' }).click()
  await expect(card.locator('.badge', { hasText: 'hidden' })).toBeVisible()
  const home = await (await page.context().browser()!.newContext()).newPage()
  await signUp(home, 'viewer')
  await home.waitForTimeout(1500)
  await expect(home.locator('.trip-card', { hasText: name })).toHaveCount(0)

  // Delete only marks it deleted: the walk, route, photo record and photo file all stay.
  await card.getByRole('button', { name: 'Delete' }).click()
  await card.getByRole('button', { name: 'Delete it' }).click()
  await expect(card.locator('.badge.deleted')).toBeVisible()
  expect(await exists(`${FS}/trips/${walk.id}`)).toBe(true)
  expect(await exists(`${FS}/trips/${walk.id}/segments/s1`)).toBe(true)
  expect(await exists(`${FS}/trips/${walk.id}/polaroids/p1`)).toBe(true)
  expect(await exists(`${STORAGE}/${encodeURIComponent(walk.image)}`)).toBe(true)
  // And it comes back.
  await card.getByRole('button', { name: 'Restore' }).click()
  await expect(card.locator('.badge.deleted')).toHaveCount(0)
})
