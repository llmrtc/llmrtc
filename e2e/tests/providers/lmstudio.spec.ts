import { test, expect } from '@playwright/test';
import { checkLMStudio } from '../../utils/service-checks';

/**
 * LMStudio Provider Integration Tests
 *
 * Tests the LMStudio local LLM provider (OpenAI-compatible API).
 * Requires LMStudio running locally with a model loaded.
 */

test.describe('LMStudio Provider', () => {
  test.beforeAll(async () => {
    const status = await checkLMStudio();
    if (!status.available) {
      test.skip(true, 'LMStudio not running');
    }
    console.log('[LMStudio] Available models:', status.models);
  });

  // LMStudio tests require manual setup
  test.skip(true, 'LMStudio requires manual setup - run with npm run test:e2e:local');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).llmrtcClient !== undefined);

    await page.click('[data-testid="connect-btn"]');
    await expect(page.locator('[data-testid="connect-btn"]')).toHaveText('Connected', {
      timeout: 15000,
    });
  });

  test('LMStudio generates response via OpenAI-compatible API', async ({ page }) => {
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    const llmResponse = page.locator('[data-testid="llm-response"]');
    await expect(llmResponse).not.toContainText('Assistant response will appear here', {
      timeout: 120000,
    });

    const text = await llmResponse.textContent();
    expect(text?.length).toBeGreaterThan(10);
    console.log('[LMStudio] Response:', text?.substring(0, 200));
  });
});
