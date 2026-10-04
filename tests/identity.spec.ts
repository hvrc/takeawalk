import { test, expect } from '@playwright/test'

// The iPhone case: Safari and the home-screen app don't share storage, and
// Safari can clear it, so a returning walker can land on the name screen.
test('a returning walker on a fresh browser can take their identity back', async ({ browser }) => {
  const geo = { geolocation: { latitude: 43.6532, longitude: -79.3832, accuracy: 8 }, permissions: ['geolocation'] }
  const first = await browser.newContext(geo)
  const a = await first.newPage()
  await a.goto('/')
  await a.getByPlaceholder('your name').fill('Harsh')
  await a.getByRole('button', { name: 'Get ready' }).click()
  const walk = `return ${Date.now().toString(36).slice(-4)}`
  await a.getByPlaceholder(/walk$/).fill(walk)
  await a.getByRole('button', { name: 'Start' }).click()
  await expect(a.locator('.trip-title h1')).toHaveText(walk)
  const url = a.url()
  const myId = await a.evaluate(() => localStorage.getItem('taw.deviceId'))
  await a.getByRole('button', { name: /^Start$/ }).click()
  await expect(a.locator('.status-line')).toContainText('Walking', { timeout: 20_000 })

  // Cold start at home while walking: straight back to the walk.
  await a.goto('/')
  await expect(a).toHaveURL(url)
  await expect(a.locator('.trip-title h1')).toHaveText(walk)

  // Same person, different storage (Safari vs home-screen app).
  const second = await browser.newContext(geo)
  const b = await second.newPage()
  await b.goto(url)
  await expect(b.getByText('been here before? tap your name')).toBeVisible()
  await b.locator('.known-list').getByRole('button', { name: 'Harsh' }).click()
  await expect(b.locator('.trip-title h1')).toHaveText(walk)
  // Recognised as the same walker: no "Join as" card, own controls are there.
  await expect(b.getByRole('button', { name: /Join as/ })).toHaveCount(0)
  await expect(b.locator('.members-row .chip')).toHaveCount(1)
  expect(await b.evaluate(() => localStorage.getItem('taw.deviceId'))).toBe(myId)
  await b.screenshot({ path: 'test-results/shots/11-identity-restored.png' })
})
