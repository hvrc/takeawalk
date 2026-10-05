import { test, expect } from '@playwright/test'

test('a slow walk creation shows a pop-up that can be closed', async ({ page }) => {
  await page.goto('/')
  await page.screenshot({ path: 'test-results/shots/00-welcome.png' })
  await expect(page.getByText('What should we call you?')).toHaveCount(0)
  await page.getByPlaceholder('your name').fill('Slowpoke')
  await page.getByRole('button', { name: 'Get ready' }).click()
  await expect(page.getByText('All walks')).toBeVisible()
  await page.screenshot({ path: 'test-results/shots/00b-home.png' })

  // Hold back Firestore's write channel so creating the walk is slow.
  await page.route(/google\.firestore\.v1\.Firestore\/Write/, async (r) => {
    await new Promise((res) => setTimeout(res, 6000))
    await r.continue().catch(() => undefined)
  })
  await page.getByPlaceholder(/walk$/).fill('slow one')
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByText('Creating your walk…')).toBeVisible()
  await page.screenshot({ path: 'test-results/shots/00c-creating.png' })
  await page.getByRole('button', { name: 'Stop waiting' }).click()
  await expect(page.getByText('Creating your walk…')).toHaveCount(0)
  await expect(page.getByText('All walks')).toBeVisible() // still home
  await page.waitForTimeout(7000)
  await expect(page).toHaveURL(/\/$/) // didn't jump into the walk afterwards
})
