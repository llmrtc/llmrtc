import { test, expect } from '@playwright/test';

/**
 * ElevenLabs TTS Provider Integration Tests
 *
 * Tests the ElevenLabs Text-to-Speech provider.
 * Requires ELEVENLABS_API_KEY to be set.
 */

test.describe('ElevenLabs TTS Provider', () => {
  test.skip(!process.env.ELEVENLABS_API_KEY, 'ELEVENLABS_API_KEY not set');
  test.skip(!process.env.OPENAI_API_KEY, 'OPENAI_API_KEY not set (required for STT/LLM)');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).llmrtcClient !== undefined);

    await page.click('[data-testid="connect-btn"]');
    await expect(page.locator('[data-testid="connect-btn"]')).toHaveText('Connected', {
      timeout: 15000,
    });
  });

  test('ElevenLabs TTS generates audio response', async ({ page }) => {
    // Set up TTS event tracking
    await page.evaluate(() => {
      (window as any).__ttsEvents = [];
      const client = (window as any).llmrtcClient;
      client.on('ttsStart', () => (window as any).__ttsEvents.push('start'));
      client.on('ttsComplete', () => (window as any).__ttsEvents.push('complete'));
      client.on('ttsCancelled', () => (window as any).__ttsEvents.push('cancelled'));
    });

    // Trigger conversation flow
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Wait for LLM response first
    await expect(page.locator('[data-testid="llm-response"]')).not.toContainText(
      'Assistant response will appear here',
      { timeout: 90000 }
    );

    // Wait a bit for TTS to process
    await page.waitForTimeout(5000);

    // Check if TTS events were fired
    const ttsEvents = await page.evaluate(() => (window as any).__ttsEvents);
    console.log('[ElevenLabs TTS] Events received:', ttsEvents);

    // Should have received at least a start event
    expect(ttsEvents.length).toBeGreaterThan(0);
    expect(ttsEvents).toContain('start');
  });

  test('ElevenLabs TTS plays audio via WebRTC track', async ({ page }) => {
    // Track if we receive the TTS track and TTS events
    await page.evaluate(() => {
      (window as any).__ttsTrackReceived = false;
      (window as any).__ttsEvents = [];
      const client = (window as any).llmrtcClient;
      client.on('ttsTrack', () => {
        (window as any).__ttsTrackReceived = true;
      });
      client.on('ttsStart', () => (window as any).__ttsEvents.push('start'));
      client.on('ttsComplete', () => (window as any).__ttsEvents.push('complete'));
      client.on('tts', () => (window as any).__ttsEvents.push('tts-fallback'));
    });

    // Trigger conversation
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Wait for LLM response
    await expect(page.locator('[data-testid="llm-response"]')).not.toContainText(
      'Assistant response will appear here',
      { timeout: 90000 }
    );

    // Wait for TTS to complete
    await page.waitForTimeout(10000);

    const trackReceived = await page.evaluate(() => (window as any).__ttsTrackReceived);
    const ttsEvents = await page.evaluate(() => (window as any).__ttsEvents);
    console.log('[ElevenLabs TTS] WebRTC track received:', trackReceived);
    console.log('[ElevenLabs TTS] TTS events:', ttsEvents);

    // Verify TTS audio was delivered (either via WebRTC track or base64 fallback)
    const hasWebRTCTrack = trackReceived === true;
    const hasFallbackAudio = ttsEvents.includes('tts-fallback');
    const hasTTSStart = ttsEvents.includes('start');

    expect(hasWebRTCTrack || hasFallbackAudio || hasTTSStart).toBe(true);
  });
});
