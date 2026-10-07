import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { signUp } from './helpers'

const SHOTS = process.env.SHOTS_DIR || 'test-results/shots'

// A short stroll in downtown Toronto, ~20 m per step.
const START = { latitude: 43.6532, longitude: -79.3832 }
function step(i: number, bearing: 'east' | 'north') {
  const dLat = bearing === 'north' ? 0.00018 * i : 0
  const dLng = bearing === 'east' ? 0.00025 * i : 0
  return { latitude: START.latitude + dLat, longitude: START.longitude + dLng, accuracy: 7 }
}

async function newPhone(browser: Browser, name: string): Promise<{ ctx: BrowserContext; page: Page; username: string }> {
  const ctx = await browser.newContext({ geolocation: { ...START, accuracy: 8 }, permissions: ['geolocation'], ignoreHTTPSErrors: true })
  // No share sheet in tests, so saves fall through to a real download.
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined }))
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${name}] console.error`, m.text())
  })
  const username = await signUp(page, name)
  return { ctx, page, username }
}

async function fakePhoto(page: Page, hue: number): Promise<Buffer> {
  const p = await page.context().newPage()
  await p.setViewportSize({ width: 900, height: 1200 })
  await p.setContent(
    `<body style="margin:0;background:linear-gradient(135deg,hsl(${hue},70%,55%),hsl(${hue + 60},70%,35%));display:grid;place-items:center;font:700 120px sans-serif;color:#fff">walk</body>`,
  )
  const buf = await p.screenshot({ type: 'jpeg', quality: 80 })
  await p.close()
  return buf
}

async function walk(page: Page, bearing: 'east' | 'north', steps: number) {
  for (let i = 1; i <= steps; i++) {
    await page.context().setGeolocation(step(i, bearing))
    await page.waitForTimeout(700)
  }
}

test('two walkers share a trip, pin polaroids, publish', async ({ browser }) => {
  const TRIP = `Harbourfront loop ${Date.now().toString(36).slice(-4)}`
  const a = await newPhone(browser, 'Harsh')
  await a.page.screenshot({ path: `${SHOTS}/01-home-empty.png` })

  // --- A starts a walk
  await a.page.getByPlaceholder(/walk$/).fill(TRIP)
  await a.page.getByRole('button', { name: 'Start' }).click()
  await expect(a.page.locator('.trip-title h1')).toHaveText(TRIP)

  await a.page.getByRole('button', { name: /^Start$/ }).click()
  await expect(a.page.locator('.status-line')).toContainText('Walking', { timeout: 20_000 })
  await walk(a.page, 'east', 6)
  await a.page.screenshot({ path: `${SHOTS}/02-trip-tracking.png` })

  // --- A takes a polaroid
  const photoA = await fakePhoto(a.page, 20)
  await a.page.getByRole('button', { name: 'Take a polaroid' }).click()
  await a.page.locator('input[type=file]').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photoA })
  await expect(a.page.locator('.sheet')).toBeVisible()
  await a.page.getByPlaceholder('write a caption').fill('ducks at the pier')
  await a.page.locator('.sheet .flip-front .flip-btn').click()
  await expect(a.page.locator('.sheet .flip')).toHaveClass(/is-flipped/)
  await a.page.getByPlaceholder('write on the back…').fill('Three ducks, one very opinionated goose.')
  await a.page.screenshot({ path: `${SHOTS}/03-capture-sheet.png` })
  await a.page.getByRole('button', { name: 'Pin it to the map' }).click()
  await expect(a.page.locator('.pin-photo')).toHaveCount(1)
  // Upload finishes and the pending pin becomes the real one.
  await expect(a.page.locator('.pin-photo.pending')).toHaveCount(0, { timeout: 30_000 })

  // --- B finds A's (public) walk in the list and joins it
  const b = await newPhone(browser, 'Friend')
  await b.page.locator('.trip-card', { hasText: TRIP }).click()
  await b.page.getByRole('button', { name: `Join as ${b.username}` }).click()
  await expect(b.page.locator('.trip-title h1')).toHaveText(TRIP)
  await expect(b.page.locator('.trip-title .member-chip')).toHaveCount(2)
  await expect(a.page.locator('.trip-title .member-chip')).toHaveCount(2)
  // B sees A's polaroid
  await expect(b.page.locator('.pin-photo')).toHaveCount(1)

  await b.page.getByRole('button', { name: /^Start$/ }).click()
  await expect(b.page.locator('.status-line')).toContainText('Walking', { timeout: 20_000 })
  await walk(b.page, 'north', 6)

  // Wait for both flush cycles so routes are in Firestore.
  await a.page.waitForTimeout(10_000)
  const routesA = await a.page.evaluate(() => document.querySelectorAll('.head-marker').length)
  expect(routesA).toBe(2)
  await expect(a.page.locator('.stat').nth(1).locator('b')).not.toHaveText('0 m')

  // B takes a polaroid too
  const photoB = await fakePhoto(b.page, 200)
  await b.page.getByRole('button', { name: 'Take a polaroid' }).click()
  await b.page.locator('input[type=file]').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photoB })
  await b.page.getByPlaceholder('write a caption').fill('found a cat')
  await b.page.getByRole('button', { name: 'Pin it to the map' }).click()
  await expect(b.page.locator('.pin-photo')).toHaveCount(2)
  await expect(a.page.locator('.pin-photo')).toHaveCount(2)
  await a.page.screenshot({ path: `${SHOTS}/05-two-walkers.png` })
  // Toggle to polaroids on the map and back to pins.
  await a.page.getByRole('button', { name: 'Show photos as polaroids' }).click()
  await expect(a.page.locator('.pin-polaroid')).toHaveCount(2)
  await expect(a.page.locator('.pin-photo')).toHaveCount(0)
  await a.page.screenshot({ path: `${SHOTS}/05a-polaroids-on-map.png` })
  await a.page.getByRole('button', { name: 'Show photos as pins' }).click()
  await expect(a.page.locator('.pin-photo')).toHaveCount(2)

  // --- A opens B's polaroid, flips it (fit the map to everything first)
  await a.page.getByRole('button', { name: 'Recenter' }).click()
  await a.page.waitForTimeout(1000)
  await a.page.screenshot({ path: `${SHOTS}/05b-fit-all.png` })
  await a.page.locator('.pin-photo').nth(1).dispatchEvent('click')
  await expect(a.page.locator('.viewer')).toBeVisible()
  await expect(a.page.locator('.viewer .polaroid-caption')).toHaveText('found a cat')
  await a.page.waitForTimeout(400)
  await a.page.screenshot({ path: `${SHOTS}/06-viewer-front.png` })
  // Tapping the photo shows it whole, and it can be saved at full size.
  await a.page.locator('.flip-front .full-btn').click()
  await expect(a.page.locator('.fullview img')).toBeVisible()
  await a.page.screenshot({ path: `${SHOTS}/06b-full-photo.png` })
  const [full] = await Promise.all([a.page.waitForEvent('download'), a.page.getByRole('button', { name: 'Save full photo' }).click()])
  expect(full.suggestedFilename()).toBe('found-a-cat-full.jpg')
  await a.page.locator('.fullview-bar').getByRole('button', { name: 'Close' }).click()
  await expect(a.page.locator('.fullview')).toHaveCount(0)
  // The flip button turns it over.
  await a.page.locator('.flip-front .flip-btn').click()
  await expect(a.page.locator('.viewer .flip')).toHaveClass(/is-flipped/)
  await a.page.waitForTimeout(700)
  await expect(a.page.locator('.polaroid-back')).toContainText(b.username)
  await expect(a.page.locator('.polaroid-back textarea')).toHaveCount(0) // not A's photo: read-only
  await a.page.screenshot({ path: `${SHOTS}/07-viewer-back.png` })
  // Google Maps link opens a new tab with the coordinates.
  await a.page.locator('.flip-back .flip-btn').click()
  await expect(a.page.locator('.viewer .flip')).not.toHaveClass(/is-flipped/)
  const [popup] = await Promise.all([
    a.page.context().waitForEvent('page'),
    a.page.getByRole('button', { name: 'Open in Google Maps' }).click(),
  ])
  expect(popup.url()).toContain('google.com/maps/search/?api=1&query=')
  await popup.close()
  // Save renders the polaroid and triggers a download (no share sheet in headless).
  const [download] = await Promise.all([
    a.page.waitForEvent('download'),
    a.page.getByRole('button', { name: 'Save image' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('found-a-cat.jpg')
  await download.saveAs(`${SHOTS}/08-saved-polaroid.jpg`)
  await a.page.locator('.viewer-close').click()

  // --- A edits own caption in place (Enter saves and drops the keyboard) and writes on the back
  await a.page.locator('.pin-photo').nth(0).dispatchEvent('click')
  const cap = a.page.getByLabel('Caption')
  await cap.fill('ducks, and a goose')
  await cap.press('Enter')
  await expect(cap).not.toBeFocused()
  await expect(a.page.locator('.toast')).toContainText('Saved')
  await a.page.locator('.flip-front .flip-btn').click()
  await a.page.locator('.polaroid-back textarea').fill('Updated from the back.')
  await a.page.locator('.polaroid-back .foot').click() // blur saves
  await expect(a.page.locator('.toast')).toContainText('Saved')
  await a.page.locator('.viewer-close').click()
  // Reopen: both edits came back from Firestore.
  await a.page.locator('.pin-photo').nth(0).dispatchEvent('click')
  await expect(a.page.getByLabel('Caption')).toHaveValue('ducks, and a goose')
  await expect(a.page.locator('.polaroid-back textarea')).toHaveValue('Updated from the back.')
  await a.page.locator('.viewer-close').click()

  // --- pause / resume
  await a.page.getByRole('button', { name: 'Pause' }).click()
  await expect(a.page.locator('.status-line')).toContainText('Paused')
  await a.page.getByRole('button', { name: 'Resume' }).click()
  await expect(a.page.locator('.status-line')).toContainText('Walking', { timeout: 20_000 })

  // --- hide the details bubble, pause/resume from the dock, and bring details back
  await a.page.getByRole('button', { name: 'Hide details' }).click()
  await expect(a.page.locator('.details-bubble')).toHaveCount(0)
  await a.page.screenshot({ path: `${SHOTS}/08b-compact.png` })
  await a.page.locator('.dock').getByRole('button', { name: 'Pause' }).click()
  await expect(a.page.locator('.map-walker')).toHaveClass(/looking/)
  await a.page.locator('.dock').getByRole('button', { name: 'Resume' }).click()
  await expect(a.page.locator('.dock').getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 20_000 })
  await expect(a.page.locator('.map-walker')).toHaveClass(/walking/)
  await a.page.getByRole('button', { name: 'Show details' }).click()
  await expect(a.page.locator('.stats')).toBeVisible()

  // --- B finishes: the walk is finished for everyone, and stays finished
  b.page.once('dialog', (d) => d.accept())
  await b.page.getByRole('button', { name: 'Finish' }).click()
  await expect(b.page.locator('.toast')).toContainText('Published')
  await expect(b.page.locator('.finished-line')).toBeVisible()
  // A was still walking: their phone stops and the controls go away.
  await expect(a.page.locator('.finished-line')).toBeVisible({ timeout: 15_000 })
  await expect(a.page.getByRole('button', { name: 'Take a polaroid' })).toHaveCount(0)
  await expect(a.page.getByRole('button', { name: /^(Resume|Start|Pause)$/ })).toHaveCount(0)
  await a.page.getByRole('button', { name: 'Back' }).click()
  const cardA = a.page.locator('.trip-card', { hasText: TRIP })
  await expect(cardA).toHaveCount(1, { timeout: 30_000 })
  await expect(cardA.locator('.badge', { hasText: 'finished' })).toBeVisible()
  await a.page.screenshot({ path: `${SHOTS}/09-home-published.png` })

  // Reopening: still finished, no way to add to it, photos still there.
  await cardA.click()
  await expect(a.page.locator('.finished-line')).toBeVisible()
  await expect(a.page.getByRole('button', { name: /^(Resume|Start)$/ })).toHaveCount(0)
  await expect(a.page.locator('.pin-photo')).toHaveCount(2)
  await a.page.waitForTimeout(1500)
  await a.page.screenshot({ path: `${SHOTS}/10-reopened.png` })

  await a.ctx.close()
  await b.ctx.close()
})
