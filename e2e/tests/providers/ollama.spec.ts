import { test, expect } from '@playwright/test';
import { checkOllama } from '../../utils/service-checks';

/**
 * Ollama Provider Integration Tests
 *
 * Tests the Ollama local LLM provider.
 * Requires LOCAL_ONLY=true and Ollama running locally.
 */

test.describe('Ollama Provider', () => {
  test.beforeAll(async () => {
    // Check if Ollama is available
    const status = await checkOllama();
    if (!status.available) {
      test.skip(true, 'Ollama not running');
    }
    console.log('[Ollama] Available models:', status.models);
  });

  test.skip(process.env.LOCAL_ONLY !== 'true', 'LOCAL_ONLY mode not enabled');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).llmrtcClient !== undefined);

    await page.click('[data-testid="connect-btn"]');
    await expect(page.locator('[data-testid="connect-btn"]')).toHaveText('Connected', {
      timeout: 15000,
    });
  });

  test('Ollama generates LLM response', async ({ page }) => {
    // Share audio to trigger the flow
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Wait for LLM response (Ollama may be slower)
    const llmResponse = page.locator('[data-testid="llm-response"]');
    await expect(llmResponse).not.toContainText('Assistant response will appear here', {
      timeout: 120000, // Longer timeout for local LLM
    });

    const text = await llmResponse.textContent();
    expect(text?.length).toBeGreaterThan(10);
    console.log('[Ollama] Response:', text?.substring(0, 200));
  });

  test('Ollama handles streaming responses', async ({ page }) => {
    // Track streaming chunks
    await page.evaluate(() => {
      (window as any).__chunkCount = 0;
      const client = (window as any).llmrtcClient;
      client.on('llmChunk', () => {
        (window as any).__chunkCount++;
      });
    });

    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Wait for response
    await expect(page.locator('[data-testid="llm-response"]')).not.toContainText(
      'Assistant response will appear here',
      { timeout: 120000 }
    );

    const chunkCount = await page.evaluate(() => (window as any).__chunkCount);
    console.log('[Ollama] Streaming chunks received:', chunkCount);

    // Should have received multiple chunks (streaming)
    expect(chunkCount).toBeGreaterThan(0);
  });
});
