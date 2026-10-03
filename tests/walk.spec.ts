import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

const SHOTS = process.env.SHOTS_DIR || 'test-results/shots'

// A short stroll in downtown Toronto, ~20 m per step.
const START = { latitude: 43.6532, longitude: -79.3832 }
function step(i: number, bearing: 'east' | 'north') {
  const dLat = bearing === 'north' ? 0.00018 * i : 0
  const dLng = bearing === 'east' ? 0.00025 * i : 0
  return { latitude: START.latitude + dLat, longitude: START.longitude + dLng, accuracy: 7 }
}

async function newPhone(browser: Browser, name: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ geolocation: { ...START, accuracy: 8 }, permissions: ['geolocation'], ignoreHTTPSErrors: true })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${name}] console.error`, m.text())
  })
  await page.goto('/')
  await page.getByPlaceholder('your name').fill(name)
  await page.getByRole('button', { name: "Let's go" }).click()
  await expect(page.getByText('All walks')).toBeVisible()
  return { ctx, page }
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
  const code = (await a.page.locator('.code-chip').textContent())!.trim()
  expect(code).toMatch(/^[A-Z0-9]{4}$/)
  console.log('join code', code)

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
  await a.page.getByPlaceholder(/Description for the back/).fill('Three ducks, one very opinionated goose.')
  await a.page.screenshot({ path: `${SHOTS}/03-capture-sheet.png` })
  await a.page.getByRole('button', { name: 'Pin it to the map' }).click()
  await expect(a.page.locator('.pin-polaroid')).toHaveCount(1)
  // Upload finishes and the pending pin becomes the real one.
  await expect(a.page.locator('.pin-polaroid.pending')).toHaveCount(0, { timeout: 30_000 })

  // --- B joins with the code
  const b = await newPhone(browser, 'Friend')
  const cardB = b.page.locator('.trip-card', { hasText: TRIP })
  await expect(cardB).toHaveCount(1)
  await expect(cardB.locator('.badge.live')).toBeVisible()
  await b.page.screenshot({ path: `${SHOTS}/04-home-with-trip.png` })
  await b.page.getByPlaceholder('CODE').fill(code)
  await b.page.getByRole('button', { name: 'Join' }).click()
  await expect(b.page.locator('.trip-title h1')).toHaveText(TRIP)
  await expect(b.page.locator('.members-row .chip')).toHaveCount(2)
  await expect(a.page.locator('.members-row .chip')).toHaveCount(2)
  // B sees A's polaroid
  await expect(b.page.locator('.pin-polaroid')).toHaveCount(1)

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
  await expect(b.page.locator('.pin-polaroid')).toHaveCount(2)
  await expect(a.page.locator('.pin-polaroid')).toHaveCount(2)
  await a.page.screenshot({ path: `${SHOTS}/05-two-walkers.png` })

  // --- A opens B's polaroid, flips it (fit the map to everything first)
  await a.page.getByRole('button', { name: 'Recenter' }).click()
  await a.page.waitForTimeout(1000)
  await a.page.screenshot({ path: `${SHOTS}/05b-fit-all.png` })
  await a.page.locator('.pin-polaroid').nth(1).click()
  await expect(a.page.locator('.viewer')).toBeVisible()
  await expect(a.page.locator('.viewer .polaroid-caption')).toHaveText('found a cat')
  await a.page.waitForTimeout(400)
  await a.page.screenshot({ path: `${SHOTS}/06-viewer-front.png` })
  await a.page.locator('.flip-front .polaroid-photo').click()
  await expect(a.page.locator('.flip')).toHaveClass(/is-flipped/)
  await a.page.waitForTimeout(700)
  await expect(a.page.locator('.polaroid-back')).toContainText('Friend')
  await a.page.screenshot({ path: `${SHOTS}/07-viewer-back.png` })
  // Google Maps link opens a new tab with the coordinates.
  await a.page.locator('.flip-back .polaroid-back').click()
  await expect(a.page.locator('.flip')).not.toHaveClass(/is-flipped/)
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

  // --- A edits own polaroid text from the back
  await a.page.locator('.pin-polaroid').nth(0).click()
  await a.page.locator('.flip-front .polaroid-photo').click()
  await a.page.getByRole('button', { name: 'Edit' }).click()
  await a.page.locator('.polaroid-back textarea').fill('Updated from the back.')
  await a.page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(a.page.locator('.polaroid-back .desc')).toHaveText('Updated from the back.')
  await a.page.locator('.viewer-close').click()

  // --- pause / resume
  await a.page.getByRole('button', { name: 'Pause' }).click()
  await expect(a.page.locator('.status-line')).toContainText('Paused')
  await a.page.getByRole('button', { name: 'Resume' }).click()
  await expect(a.page.locator('.status-line')).toContainText('Walking', { timeout: 20_000 })

  // --- both finish; the trip is published once nobody is walking
  b.page.once('dialog', (d) => d.accept())
  await b.page.getByRole('button', { name: 'Finish' }).click()
  await expect(b.page.locator('.toast')).toContainText('Published')
  a.page.once('dialog', (d) => d.accept())
  await a.page.getByRole('button', { name: 'Finish' }).click()
  await expect(a.page.locator('.toast')).toContainText('Published')
  await a.page.getByRole('button', { name: 'Back' }).click()
  const cardA = a.page.locator('.trip-card', { hasText: TRIP })
  await expect(cardA).toHaveCount(1)
  await expect(cardA.locator('.badge', { hasText: 'published' })).toBeVisible()
  await a.page.screenshot({ path: `${SHOTS}/09-home-published.png` })

  // Reopening shows Resume (published route stays, new tracking appends).
  await cardA.click()
  await expect(a.page.getByRole('button', { name: /^Resume$/ })).toBeVisible()
  await expect(a.page.locator('.pin-polaroid')).toHaveCount(2)
  await a.page.waitForTimeout(1500)
  await a.page.screenshot({ path: `${SHOTS}/10-reopened.png` })

  await a.ctx.close()
  await b.ctx.close()
})
