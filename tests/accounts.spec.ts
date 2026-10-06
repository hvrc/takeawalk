import { test, expect } from '@playwright/test'
import { signUp } from './helpers'

const HERE = { geolocation: { latitude: 43.6532, longitude: -79.3832, accuracy: 8 }, permissions: ['geolocation'] }

test('sign up, sign out, sign in with username or email; wrong password; forgot password', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  await page.screenshot({ path: 'test-results/shots/20-sign-in.png' })
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await expect(page.getByText('harshrajmachikar@gmail.com')).toBeVisible()
  await expect(page.getByText("He'll fix it for you.")).toBeVisible()
  await page.getByRole('button', { name: 'Back to sign in' }).click()

  // The eye shows and hides the password.
  await page.getByRole('button', { name: 'Sign up' }).click()
  await page.screenshot({ path: 'test-results/shots/21-sign-up.png' })
  await page.getByLabel('Password', { exact: true }).fill('secret')
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide password' }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password')

  const username = await signUp(page, 'walker', 'walking1')
  await expect(page.locator('.name-pill')).toContainText(username)

  // Signed in survives a reload.
  await page.reload()
  await expect(page.getByText('All walks')).toBeVisible()

  // Same username can't be taken twice.
  const res = await page.request.post('/api/auth/signup', { data: { username, email: `other-${username}@example.com`, password: 'walking1' } })
  expect(res.status()).toBe(409)

  // Sign out (the account menu confirms).
  page.once('dialog', (d) => d.accept())
  await page.locator('.name-pill').click()
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()

  // Wrong password, then username, then email.
  await page.getByLabel('Username or email').fill(username)
  await page.getByLabel('Password', { exact: true }).fill('nope-nope')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('Wrong username or password.')).toBeVisible()
  await page.getByLabel('Password', { exact: true }).fill('walking1')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('All walks')).toBeVisible()
  page.once('dialog', (d) => d.accept())
  await page.locator('.name-pill').click()
  await page.getByLabel('Username or email').fill(`${username}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill('walking1')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('All walks')).toBeVisible()
})

test('walks are private until made public; far-away people can’t join', async ({ browser }) => {
  const a = await (await browser.newContext(HERE)).newPage()
  await signUp(a, 'owner')
  const walk = `secret ${Date.now().toString(36).slice(-4)}`
  await a.getByPlaceholder(/walk$/).fill(walk)
  await a.getByRole('button', { name: 'Start' }).click()
  await expect(a.locator('.trip-title h1')).toHaveText(walk)
  await expect(a.locator('.vis-chip')).toHaveText('private')
  await a.getByRole('button', { name: /^Start$/ }).click()
  await expect(a.locator('.status-line')).toContainText('Walking', { timeout: 20_000 })
  await a.waitForTimeout(9500) // first route flush, so the walk has a location
  const url = a.url()

  // Someone else doesn't see it in their list.
  const b = await (await browser.newContext(HERE)).newPage()
  await signUp(b, 'other')
  await b.waitForTimeout(1500)
  await expect(b.locator('.trip-card', { hasText: walk })).toHaveCount(0)

  // Made public: now they do.
  a.once('dialog', (d) => d.accept())
  await a.locator('.vis-chip').click()
  await expect(a.locator('.vis-chip')).toHaveText('public')
  await expect(b.locator('.trip-card', { hasText: walk })).toHaveCount(1, { timeout: 15_000 })

  // Far away (Montreal): can open the link but can't join.
  const far = await (await browser.newContext({ geolocation: { latitude: 45.5019, longitude: -73.5674, accuracy: 10 }, permissions: ['geolocation'] })).newPage()
  const farName = await signUp(far, 'far')
  await far.goto(url)
  await far.getByRole('button', { name: `Join as ${farName}` }).click()
  await expect(far.locator('.toast')).toContainText('km from this walk', { timeout: 20_000 })
  await expect(a.locator('.members-row .chip')).toHaveCount(1)
})
