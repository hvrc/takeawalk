import { defineConfig, devices } from '@playwright/test'

const executablePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

export default defineConfig({
  testDir: './tests',
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:5173',
    ...devices['iPhone 12'],
    // Chromium can emulate the viewport; WebKit isn't installed here.
    defaultBrowserType: 'chromium',
    permissions: ['geolocation'],
    // The sandbox proxies HTTPS through a private CA that Chromium doesn't trust.
    ignoreHTTPSErrors: true,
    geolocation: { latitude: 43.6532, longitude: -79.3832, accuracy: 8 },
    launchOptions: { executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors'] },
    trace: 'retain-on-failure',
  },
})
