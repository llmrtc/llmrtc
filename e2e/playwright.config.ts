import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

// Get the directory of this config file
const __dirname = path.dirname(__filename);

/**
 * Playwright E2E Test Configuration for @metered/llmrtc
 *
 * Uses Chrome fake media flags to inject pre-recorded audio/video
 * as camera and microphone input for WebRTC testing.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // WebRTC tests need sequential execution
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for WebRTC tests
  reporter: [['html', { open: 'never' }], ['list']],

  globalSetup: require.resolve('./global-setup.ts'),

  use: {
    baseURL: process.env.TEST_FRONTEND_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            // Auto-grant media permissions without prompting
            '--use-fake-ui-for-media-stream',
            // Use fake devices instead of real hardware
            '--use-fake-device-for-media-stream',
            // Inject pre-recorded audio file as microphone input
            `--use-file-for-fake-audio-capture=${path.join(__dirname, 'fixtures', 'test-audio.wav')}`,
            // Inject pre-recorded video file as camera input
            `--use-file-for-fake-video-capture=${path.join(__dirname, 'fixtures', 'test-video.y4m')}`,
            // Additional WebRTC-friendly flags
            '--disable-web-security',
            '--allow-running-insecure-content',
          ],
        },
        permissions: ['microphone', 'camera'],
        contextOptions: {
          // Ensure media permissions are granted
          permissions: ['microphone', 'camera'],
        },
      },
    },
  ],

  // Web server configuration - start frontend dev server if not running
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
