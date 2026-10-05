import { test, expect, type Page } from '@playwright/test'

// Photo durability against the local emulators (npm run emulators + npm run dev:emu).
const PROJECT = 'demo-takeawalk'
const BUCKET = 'demo-takeawalk.appspot.com'
const STORAGE = `http://127.0.0.1:9199/v0/b/${BUCKET}/o`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`

const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64',
)

async function uploadRaw(name: string) {
  return fetch(`${STORAGE}?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg })
}

test('rules: photos are write-once and records keep their image', async () => {
  const name = `trips/rules-${Date.now()}/polaroids/p1.jpg`
  expect((await uploadRaw(name)).status).toBe(200) // create: allowed
  expect((await uploadRaw(name)).status).toBe(403) // overwrite: refused
  const del = await fetch(`${STORAGE}/${encodeURIComponent(name)}`, { method: 'DELETE' })
  expect(del.status).toBe(403) // delete: refused
  expect((await fetch(`${STORAGE}/${encodeURIComponent(name)}`)).status).toBe(200) // still there

  const trip = `rules-${Date.now()}`
  const make = await fetch(`${FS}/trips/${trip}/polaroids?documentId=p1`, {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        caption: { stringValue: 'hi' },
        description: { stringValue: '' },
        memberId: { stringValue: 'm1' },
        lat: { doubleValue: 43.6 },
        lng: { doubleValue: -79.3 },
        imagePath: { stringValue: name },
        imageUrl: { stringValue: 'https://example.com/real.jpg' },
      },
    }),
  })
  expect(make.status).toBe(200)
  const doc = `${FS}/trips/${trip}/polaroids/p1`
  const hijack = await fetch(`${doc}?updateMask.fieldPaths=imageUrl`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { imageUrl: { stringValue: 'https://evil.example/x.jpg' } } }),
  })
  expect(hijack.status).toBe(403)
  const recaption = await fetch(`${doc}?updateMask.fieldPaths=caption`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { caption: { stringValue: 'new words' } } }),
  })
  expect(recaption.status).toBe(200)
  expect((await fetch(doc, { method: 'DELETE' })).status).toBe(403)
})

// --- helpers for the app-driven tests

async function phoneOnNewWalk(page: Page, walkName: string) {
  await page.context().addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined }))
  await page.goto('/')
  await page.getByPlaceholder('your name').fill('Saver')
  await page.getByRole('button', { name: 'Get ready' }).click()
  await page.getByPlaceholder(/walk$/).fill(walkName)
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.locator('.trip-title h1')).toHaveText(walkName)
  await page.getByRole('button', { name: /^Start$/ }).click()
  await expect(page.locator('.status-line')).toContainText('Walking', { timeout: 20_000 })
  return page.url().split('/t/')[1]
}

async function takePhoto(page: Page, caption: string) {
  await page.getByRole('button', { name: 'Take a polaroid' }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: await fakePhoto(page) })
  await page.getByPlaceholder('write a caption').fill(caption)
  await page.getByRole('button', { name: 'Pin it to the map' }).click()
}

async function fakePhoto(page: Page): Promise<Buffer> {
  const p = await page.context().newPage()
  await p.setViewportSize({ width: 1200, height: 800 }) // landscape: not square on purpose
  await p.setContent('<body style="margin:0;background:linear-gradient(90deg,#b8432f,#2f6f3a)"></body>')
  const buf = await p.screenshot({ type: 'jpeg', quality: 80 })
  await p.close()
  return buf
}

const queued = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const r = indexedDB.open('takeawalk', 1)
        r.onsuccess = () => {
          const c = r.result.transaction('pendingUploads').objectStore('pendingUploads').count()
          c.onsuccess = () => resolve(c.result)
        }
        r.onerror = () => resolve(-1)
      }),
  )

async function polaroidsInFirestore(tripId: string) {
  const r = await fetch(`${FS}/trips/${tripId}/polaroids`, { headers: { Authorization: 'Bearer owner' } })
  return ((await r.json()).documents ?? []) as Array<{ fields: Record<string, { stringValue?: string }> }>
}
async function tripCount(tripId: string) {
  const r = await fetch(`${FS}/trips/${tripId}`, { headers: { Authorization: 'Bearer owner' } })
  return Number((await r.json()).fields.polaroidCount?.integerValue ?? 0)
}

test('a photo survives a failed upload, leaving the walk and a reload', async ({ page }) => {
  const tripId = await phoneOnNewWalk(page, `offline ${Date.now().toString(36).slice(-4)}`)

  // Cloud Storage unreachable.
  await page.route('**/127.0.0.1:9199/**', (r) => r.abort())
  await takePhoto(page, 'no signal')
  await expect(page.locator('.pin-photo.pending')).toHaveCount(1)
  await expect.poll(() => queued(page)).toBe(1)

  // Leave the walk and reload the whole app: the photo is still queued on the phone.
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByText('All walks')).toBeVisible()
  await page.reload()
  await expect(page.getByText('All walks')).toBeVisible()
  expect(await queued(page)).toBe(1)
  expect(await polaroidsInFirestore(tripId)).toHaveLength(0)

  // Signal back, still on the home page: the app-wide uploader finishes it.
  await page.unroute('**/127.0.0.1:9199/**')
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => queued(page), { timeout: 30_000 }).toBe(0)
  const pols = await polaroidsInFirestore(tripId)
  expect(pols).toHaveLength(1)
  expect(pols[0].fields.caption.stringValue).toBe('no signal')
  const img = await fetch(pols[0].fields.imageUrl.stringValue!)
  expect(img.status).toBe(200)
  expect((await img.arrayBuffer()).byteLength).toBeGreaterThan(1000)
  expect(await tripCount(tripId)).toBe(1)
})

test('a retry after the file uploaded but the record failed writes exactly one record', async ({ page }) => {
  const tripId = await phoneOnNewWalk(page, `halfway ${Date.now().toString(36).slice(-4)}`)

  // Uploads work, but the transaction that writes the record fails.
  await page.route('**/documents:commit*', (r) => r.abort())
  await takePhoto(page, 'halfway there')
  await expect(page.locator('.pin-photo.pending')).toHaveCount(1)
  // The file made it to Storage...
  await expect
    .poll(async () => (await fetch(`${STORAGE}?prefix=${encodeURIComponent(`trips/${tripId}/polaroids/`)}`, { headers: { Authorization: 'Bearer owner' } }).then((r) => r.json())).items?.length ?? 0, { timeout: 20_000 })
    .toBe(1)
  // ...but no record yet, and it's still queued.
  expect(await polaroidsInFirestore(tripId)).toHaveLength(0)
  expect(await queued(page)).toBe(1)

  // Reload and let it retry. Storage refuses overwrites, so this only works
  // if the uploader reuses the file that's already there.
  await page.unroute('**/documents:commit*')
  await page.reload()
  await expect.poll(() => queued(page), { timeout: 30_000 }).toBe(0)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForTimeout(2000)
  expect(await polaroidsInFirestore(tripId)).toHaveLength(1)
  expect(await tripCount(tripId)).toBe(1)
  await expect(page.locator('.pin-photo')).toHaveCount(1)
  await expect(page.locator('.pin-photo.pending')).toHaveCount(0)
})
