import { test, expect } from '@playwright/test';

/**
 * OpenAI Provider Integration Tests
 *
 * Tests the OpenAI LLM, Whisper STT, and TTS providers.
 * Requires OPENAI_API_KEY to be set.
 */

test.describe('OpenAI Provider', () => {
  test.skip(!process.env.OPENAI_API_KEY, 'OPENAI_API_KEY not set');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).llmrtcClient !== undefined);

    // Connect
    await page.click('[data-testid="connect-btn"]');
    await expect(page.locator('[data-testid="connect-btn"]')).toHaveText('Connected', {
      timeout: 15000,
    });
  });

  test('OpenAI Whisper transcription works', async ({ page }) => {
    // Share audio to trigger transcription
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Wait for transcript (Whisper will process the fake audio)
    const transcript = page.locator('[data-testid="transcript"]');
    await expect(transcript).not.toContainText('Your transcribed speech will appear here', {
      timeout: 60000,
    });

    // Transcript should have meaningful content matching test audio
    // Test audio says: "Hello, can you tell me a short joke about programming?"
    const text = await transcript.textContent();
    expect(text?.trim().length).toBeGreaterThan(10);
    expect(text?.toLowerCase()).toMatch(/hello|joke|programming/);
    console.log('[OpenAI Whisper] Transcript:', text);
  });

  test('OpenAI LLM generates response', async ({ page }) => {
    // Share audio
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Wait for LLM response
    const llmResponse = page.locator('[data-testid="llm-response"]');
    await expect(llmResponse).not.toContainText('Assistant response will appear here', {
      timeout: 90000,
    });

    const text = await llmResponse.textContent();
    expect(text?.length).toBeGreaterThan(10);
    console.log('[OpenAI LLM] Response:', text?.substring(0, 200));
  });

  test('OpenAI TTS generates audio', async ({ page }) => {
    // Note: Backend uses ElevenLabs for TTS by default
    // This test verifies the TTS flow works regardless of provider
    test.skip(!process.env.ELEVENLABS_API_KEY, 'ELEVENLABS_API_KEY not set for TTS');

    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Wait for TTS to start playing
    await expect(page.locator('[data-testid="tts-status"]')).toBeVisible({
      timeout: 120000,
    });
  });
});
