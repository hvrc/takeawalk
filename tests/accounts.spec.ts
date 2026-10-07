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
  await expect(page.getByText('Public walks', { exact: true })).toBeVisible()

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
  await expect(page.getByText('Public walks', { exact: true })).toBeVisible()
  page.once('dialog', (d) => d.accept())
  await page.locator('.name-pill').click()
  await page.getByLabel('Username or email').fill(`${username}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill('walking1')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('Public walks', { exact: true })).toBeVisible()
})

test('walks are public by default and can be made private; far-away people can’t join', async ({ browser }) => {
  const a = await (await browser.newContext(HERE)).newPage()
  await signUp(a, 'owner')
  const walk = `secret ${Date.now().toString(36).slice(-4)}`
  await a.getByPlaceholder(/walk$/).fill(walk)
  await a.getByRole('button', { name: 'Start' }).click()
  await expect(a.locator('.trip-title h1')).toHaveText(walk)
  await expect(a.locator('.vis-chip')).toHaveText('public')
  await a.getByRole('button', { name: /^Start$/ }).click()
  await expect(a.locator('.status-line')).toContainText('Walking', { timeout: 20_000 })
  await a.waitForTimeout(9500) // first route flush, so the walk has a location
  const url = a.url()

  // Someone else sees it in their list.
  const b = await (await browser.newContext(HERE)).newPage()
  await signUp(b, 'other')
  await expect(b.locator('.trip-card', { hasText: walk })).toHaveCount(1, { timeout: 15_000 })

  // Made private: it disappears for them.
  a.once('dialog', (d) => d.accept())
  await a.locator('.vis-chip').click()
  await expect(a.locator('.vis-chip')).toHaveText('private')
  await expect(b.locator('.trip-card', { hasText: walk })).toHaveCount(0, { timeout: 15_000 })

  // Far away (Montreal): can open the link but can't join.
  const far = await (await browser.newContext({ geolocation: { latitude: 45.5019, longitude: -73.5674, accuracy: 10 }, permissions: ['geolocation'] })).newPage()
  const farName = await signUp(far, 'far')
  await far.goto(url)
  await far.getByRole('button', { name: `Join as ${farName}` }).click()
  await expect(far.locator('.toast')).toContainText('km from this walk', { timeout: 20_000 })
  await expect(a.locator('.trip-title .member-chip')).toHaveCount(1)
})

test('continue without signing in: unique username, walks always public', async ({ browser }) => {
  const taken = await signUp(await (await browser.newContext(HERE)).newPage(), 'taken')
  const g = await (await browser.newContext(HERE)).newPage()
  await g.addInitScript(() => localStorage.setItem('taw.details', '1'))
  await g.goto('/')
  await g.getByRole('button', { name: 'Continue without signing in' }).click()
  await expect(g.getByText('Pick a username')).toBeVisible()
  await expect(g.getByText('your walks are always public')).toBeVisible()
  await g.getByLabel('Username').fill(taken)
  await g.getByRole('button', { name: 'Continue' }).click()
  await expect(g.getByText('That username is taken.')).toBeVisible()
  const name = `guest${Date.now().toString(36).slice(-5)}`
  await g.getByLabel('Username').fill(name)
  await g.getByRole('button', { name: 'Continue' }).click()
  await expect(g.getByText('Public walks', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(g.locator('.name-pill')).toContainText(name)
  await g.getByPlaceholder(/walk$/).fill(`guest walk ${name}`)
  await g.getByRole('button', { name: 'Start' }).click()
  await expect(g.locator('.trip-title h1')).toHaveText(`guest walk ${name}`)
  // Public, and not switchable.
  await expect(g.locator('.vis-chip')).toHaveText('public')
  await expect(g.locator('button.vis-chip')).toHaveCount(0)
})

test('anyone on a walk can delete it; it is only hidden and admin can restore it', async ({ browser }) => {
  const a = await (await browser.newContext(HERE)).newPage()
  await signUp(a, 'deleter')
  const walk = `doomed ${Date.now().toString(36).slice(-4)}`
  await a.getByPlaceholder(/walk$/).fill(walk)
  await a.getByRole('button', { name: 'Start' }).click()
  await expect(a.locator('.trip-title h1')).toHaveText(walk)
  const url = a.url()
  a.once('dialog', (d) => d.accept())
  await a.getByRole('button', { name: 'Delete this walk' }).click()
  await expect(a.getByText('Public walks', { exact: true })).toBeVisible()
  await expect(a.locator('.trip-card', { hasText: walk })).toHaveCount(0)
  await a.goto(url)
  await expect(a.getByText('This walk was deleted.')).toBeVisible()

  const admin = await (await browser.newContext()).newPage()
  await admin.goto('/admin')
  await admin.getByLabel('Password').fill('1234')
  await admin.getByRole('button', { name: 'Sign in' }).click()
  const card = admin.locator('.admin-walk', { hasText: walk })
  await expect(card.locator('.badge.deleted')).toContainText('deleted by')
  await card.getByRole('button', { name: 'Restore' }).click()
  await expect(card.locator('.badge.deleted')).toHaveCount(0)
  await a.goto('/')
  await expect(a.locator('.trip-card', { hasText: walk })).toHaveCount(1, { timeout: 15_000 })
})
