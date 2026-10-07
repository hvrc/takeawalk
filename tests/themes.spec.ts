import { test, expect } from '@playwright/test'
import { signUp } from './helpers'

test('the theme button cycles through all five themes, on sign-in and in the app', async ({ page }) => {
  await page.goto('/')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-theme', 'paper')
  const seen: string[] = []
  for (let i = 0; i < 5; i++) {
    seen.push((await html.getAttribute('data-theme'))!)
    await page.screenshot({ path: `test-results/shots/30-theme-signin-${seen[i]}.png` })
    await page.getByRole('button', { name: /^Theme:/ }).click()
  }
  expect(new Set(seen)).toEqual(new Set(['paper', 'night', 'blueprint', 'riso', 'newsprint']))
  await expect(html).toHaveAttribute('data-theme', 'paper') // wrapped round

  await signUp(page, 'themer')
  await page.getByRole('button', { name: /^Theme:/ }).click()
  await expect(html).toHaveAttribute('data-theme', 'night')
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'night') // remembered
  for (const t of ['night', 'blueprint', 'riso', 'newsprint']) {
    await expect(html).toHaveAttribute('data-theme', t)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `test-results/shots/31-theme-home-${t}.png` })
    await page.getByRole('button', { name: /^Theme:/ }).click()
  }
})
