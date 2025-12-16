import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import { config } from 'dotenv';

// Get the directory of this config file
const __dirname = path.dirname(__filename);

// Load .env.test BEFORE defining config so env vars are available
const envTestPath = path.resolve(__dirname, '..', '.env.test');
config({ path: envTestPath });

// Default ports (can be overridden in .env.test)
const BACKEND_PORT = process.env.TEST_BACKEND_PORT ?? '8787';
const FRONTEND_PORT = process.env.TEST_FRONTEND_PORT ?? '5173';
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
const SIGNAL_URL = `ws://localhost:${BACKEND_PORT}`;

// Build env object for webServer processes (pass through relevant env vars)
const serverEnv = {
  // Pass through all current env vars
  ...process.env,
  // Explicitly set the port
  PORT: BACKEND_PORT,
  HOST: '127.0.0.1',
  // Signal URL for frontend
  VITE_SIGNAL_URL: SIGNAL_URL,
};

/**
 * Playwright E2E Test Configuration for @llmrtc/llmrtc
 *
 * Fully self-contained: starts both backend and frontend servers.
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
    baseURL: process.env.TEST_FRONTEND_URL ?? FRONTEND_URL,
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      testIgnore: '**/barge-in.spec.ts', // Barge-in tests run in separate project
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
    {
      // Special project for barge-in tests that need longer audio with silence
      name: 'barge-in',
      testMatch: '**/barge-in.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            // Use barge-in audio: speech + 8s silence (loops to trigger barge-in)
            `--use-file-for-fake-audio-capture=${path.join(__dirname, 'fixtures', 'barge-in-audio.wav')}`,
            `--use-file-for-fake-video-capture=${path.join(__dirname, 'fixtures', 'test-video.y4m')}`,
            '--disable-web-security',
            '--allow-running-insecure-content',
          ],
        },
        permissions: ['microphone', 'camera'],
        contextOptions: {
          permissions: ['microphone', 'camera'],
        },
      },
    },
  ],

  // Web server configuration - start both backend and frontend
  // Backend must start first since frontend connects to it
  webServer: [
    {
      command: 'npm run dev:backend',
      url: `${BACKEND_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60000, // Backend needs time to load wrtc and VAD model
      stdout: 'pipe',
      stderr: 'pipe',
      env: serverEnv,
    },
    {
      command: 'npm run dev',
      url: FRONTEND_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: serverEnv,
    },
  ],
});
