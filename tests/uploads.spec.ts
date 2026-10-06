import { test, expect, type Page } from '@playwright/test'
import { as, signUp } from './helpers'

// Photo durability against the local emulators (npm run emulators + npm run dev:emu).
const PROJECT = 'demo-takeawalk'
const BUCKET = 'demo-takeawalk.appspot.com'
const STORAGE = `http://127.0.0.1:9199/v0/b/${BUCKET}/o`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`

const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64',
)

async function uploadRaw(name: string, auth: Record<string, string> = as('m1')) {
  return fetch(`${STORAGE}?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', ...auth }, body: jpeg })
}

test('rules: photos are write-once and records keep their image', async () => {
  const name = `trips/rules-${Date.now()}/polaroids/p1.jpg`
  expect((await uploadRaw(name, {})).status).toBe(403) // signed out: refused
  expect((await uploadRaw(name)).status).toBe(200) // create: allowed
  expect((await uploadRaw(name)).status).toBe(403) // overwrite: refused
  const del = await fetch(`${STORAGE}/${encodeURIComponent(name)}`, { method: 'DELETE', headers: as('m1') })
  expect(del.status).toBe(403) // delete: refused
  expect((await fetch(`${STORAGE}/${encodeURIComponent(name)}`)).status).toBe(200) // still there

  const trip = `rules-${Date.now()}`
  // The walk has to exist (and be ongoing) for a photo to be added to it.
  await fetch(`${FS}/trips?documentId=${trip}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: { name: { stringValue: 'rules' }, code: { stringValue: 'RULE' }, status: { stringValue: 'active' }, memberUids: { arrayValue: { values: [{ stringValue: 'm1' }] } } } }),
  })
  const make = await fetch(`${FS}/trips/${trip}/polaroids?documentId=p1`, {
    method: 'POST',
    headers: as('m1'),
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
    headers: as('m1'),
    body: JSON.stringify({ fields: { imageUrl: { stringValue: 'https://evil.example/x.jpg' } } }),
  })
  expect(hijack.status).toBe(403)
  // Someone else can't change your caption; you can.
  const theirs = await fetch(`${doc}?updateMask.fieldPaths=caption`, {
    method: 'PATCH',
    headers: as('someone-else'),
    body: JSON.stringify({ fields: { caption: { stringValue: 'not yours' } } }),
  })
  expect(theirs.status).toBe(403)
  const recaption = await fetch(`${doc}?updateMask.fieldPaths=caption`, {
    method: 'PATCH',
    headers: as('m1'),
    body: JSON.stringify({ fields: { caption: { stringValue: 'new words' } } }),
  })
  expect(recaption.status).toBe(200)
  expect((await fetch(doc, { method: 'DELETE', headers: as('m1') })).status).toBe(403)
})

// --- helpers for the app-driven tests

async function phoneOnNewWalk(page: Page, walkName: string) {
  await page.context().addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined }))
  await signUp(page, 'saver')
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

test('rules: a finished walk takes no new route or photos, except ones taken before it finished', async () => {
  const id = `done-${Date.now()}`
  const finishedAt = Date.now() - 60_000
  const t = await fetch(`${FS}/trips?documentId=${id}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: { name: { stringValue: 'done' }, code: { stringValue: 'DONE' }, status: { stringValue: 'published' }, visibility: { stringValue: 'private' }, finishedAt: { integerValue: String(finishedAt) }, createdBy: { stringValue: 'm1' }, memberUids: { arrayValue: { values: [{ stringValue: 'm1' }] } }, members: { mapValue: { fields: { m1: { mapValue: { fields: { name: { stringValue: 'm' } } } } } } } } }),
  })
  expect(t.status).toBe(200)
  const seg = await fetch(`${FS}/trips/${id}/segments`, {
    method: 'POST',
    headers: as('m1'),
    body: JSON.stringify({ fields: { memberId: { stringValue: 'm1' }, points: { arrayValue: { values: [] } } } }),
  })
  expect(seg.status).toBe(403)
  const photo = (takenAt: number) =>
    fetch(`${FS}/trips/${id}/polaroids`, {
      method: 'POST',
      headers: as('m1'),
      body: JSON.stringify({
        fields: {
          caption: { stringValue: '' },
          description: { stringValue: '' },
          memberId: { stringValue: 'm1' },
          lat: { doubleValue: 43.6 },
          lng: { doubleValue: -79.3 },
          takenAt: { integerValue: String(takenAt) },
        },
      }),
    })
  expect((await photo(Date.now())).status).toBe(403) // taken after it finished
  expect((await photo(finishedAt - 5_000)).status).toBe(200) // taken before, still uploading
  // And it can't be reopened.
  const reopen = await fetch(`${FS}/trips/${id}?updateMask.fieldPaths=status`, {
    method: 'PATCH',
    headers: as('m1'),
    body: JSON.stringify({ fields: { name: { stringValue: 'done' }, status: { stringValue: 'active' } } }),
  })
  expect(reopen.status).toBe(403)
})

test('rules: private walks are invisible to non-members; public ones are visible to all', async () => {
  const id = `priv-${Date.now()}`
  const make = (visibility: string) =>
    fetch(`${FS}/trips?documentId=${id}-${visibility}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner' },
      body: JSON.stringify({ fields: { name: { stringValue: visibility }, status: { stringValue: 'active' }, visibility: { stringValue: visibility }, memberUids: { arrayValue: { values: [{ stringValue: 'owner1' }] } } } }),
    })
  await make('private')
  await make('public')
  expect((await fetch(`${FS}/trips/${id}-private`, { headers: as('owner1') })).status).toBe(200)
  expect((await fetch(`${FS}/trips/${id}-private`, { headers: as('stranger') })).status).toBe(403)
  expect((await fetch(`${FS}/trips/${id}-private`)).status).toBe(403)
  expect((await fetch(`${FS}/trips/${id}-public`, { headers: as('stranger') })).status).toBe(200)
  // A stranger can't add themselves to a walk directly (joining goes through the server).
  const sneak = await fetch(`${FS}/trips/${id}-public?updateMask.fieldPaths=memberUids&updateMask.fieldPaths=name&updateMask.fieldPaths=status&updateMask.fieldPaths=visibility`, {
    method: 'PATCH',
    headers: as('stranger'),
    body: JSON.stringify({ fields: { name: { stringValue: 'public' }, status: { stringValue: 'active' }, visibility: { stringValue: 'public' }, memberUids: { arrayValue: { values: [{ stringValue: 'owner1' }, { stringValue: 'stranger' }] } } } }),
  })
  expect(sneak.status).toBe(403)
})
