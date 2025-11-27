import { test, expect } from '@playwright/test';

/**
 * Audio Flow E2E Tests
 *
 * These tests verify the complete voice conversation flow:
 * 1. User speaks (fake audio from pre-recorded file)
 * 2. Backend transcribes via STT
 * 3. LLM generates response
 * 4. TTS generates audio response
 *
 * NOTE: These tests require:
 * - Backend running with valid API keys (OPENAI_API_KEY, ELEVENLABS_API_KEY)
 * - Pre-recorded test audio file (e2e/fixtures/test-audio.wav)
 *
 * The fake audio file should contain clear speech that can be transcribed.
 */

test.describe('Audio Conversation Flow', () => {
  // Skip all tests if no API keys configured
  test.skip(
    !process.env.OPENAI_API_KEY && !process.env.LOCAL_ONLY,
    'Requires OPENAI_API_KEY or LOCAL_ONLY mode'
  );

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).llmrtcClient !== undefined);

    // Connect to backend
    await page.click('[data-testid="connect-btn"]');
    await expect(page.locator('[data-testid="connect-btn"]')).toHaveText('Connected', {
      timeout: 15000,
    });
  });

  test('should share audio successfully with fake microphone', async ({ page }) => {
    // Click share audio button
    await page.click('[data-testid="share-audio-btn"]');

    // Wait for audio to be shared
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Verify button text changed
    await expect(page.locator('[data-testid="share-audio-btn"]')).toContainText('Stop Audio');
  });

  test('should receive transcript when speech is detected', async ({ page }) => {
    // Share audio
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Wait for transcript to appear (VAD will detect speech in fake audio)
    // This may take a while depending on the fake audio content
    const transcript = page.locator('[data-testid="transcript"]');

    // Wait for transcript to change from placeholder
    await expect(transcript).not.toContainText('Your transcribed speech will appear here', {
      timeout: 60000,
    });

    // Transcript should have meaningful content matching our test audio
    // Test audio says: "Hello, can you tell me a short joke about programming?"
    const text = await transcript.textContent();
    expect(text?.trim().length).toBeGreaterThan(10);
    expect(text?.toLowerCase()).toMatch(/hello|joke|programming/);
    console.log('[test] Received transcript:', text);
  });

  test('should receive LLM response after transcript', async ({ page }) => {
    // Share audio
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Wait for LLM response to appear
    const llmResponse = page.locator('[data-testid="llm-response"]');

    // Wait for response to change from placeholder
    await expect(llmResponse).not.toContainText('Assistant response will appear here', {
      timeout: 90000,
    });

    // Response should have meaningful content
    const text = await llmResponse.textContent();
    expect(text?.length).toBeGreaterThan(10);
    console.log('[test] Received LLM response:', text?.substring(0, 200));
  });

  test('should play TTS audio after LLM response', async ({ page }) => {
    test.skip(!process.env.ELEVENLABS_API_KEY, 'Requires ELEVENLABS_API_KEY for TTS');

    // Share audio
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Wait for TTS status to show playing
    // This requires the full flow: audio → STT → LLM → TTS
    await expect(page.locator('[data-testid="tts-status"]')).toBeVisible({
      timeout: 120000,
    });
  });

  test('complete conversation flow with event verification', async ({ page }) => {
    // Set up event tracking
    const events: string[] = [];
    await page.evaluate(() => {
      const client = (window as any).llmrtcClient;
      ['speechStart', 'speechEnd', 'transcript', 'llmChunk', 'llm', 'ttsStart', 'ttsComplete'].forEach(
        (event) => {
          client.on(event, () => {
            (window as any).__e2eEvents = (window as any).__e2eEvents || [];
            (window as any).__e2eEvents.push(event);
          });
        }
      );
    });

    // Share audio to trigger the flow
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Wait for conversation to complete (LLM response received)
    await expect(page.locator('[data-testid="llm-response"]')).not.toContainText(
      'Assistant response will appear here',
      { timeout: 90000 }
    );

    // Verify events were fired
    const receivedEvents = await page.evaluate(() => (window as any).__e2eEvents || []);
    console.log('[test] Received events:', receivedEvents);

    // Should have received key events in the conversation flow
    expect(receivedEvents).toContain('speechStart');
    expect(receivedEvents).toContain('speechEnd');
    expect(receivedEvents).toContain('transcript');
    expect(receivedEvents).toContain('llm');

    // Verify event order: speechStart should come before speechEnd
    const firstSpeechStart = receivedEvents.indexOf('speechStart');
    const firstSpeechEnd = receivedEvents.indexOf('speechEnd');
    expect(firstSpeechStart).toBeGreaterThanOrEqual(0);
    expect(firstSpeechEnd).toBeGreaterThan(firstSpeechStart);

    // Verify transcript comes after speechEnd
    const firstTranscript = receivedEvents.indexOf('transcript');
    expect(firstTranscript).toBeGreaterThan(firstSpeechEnd);
  });
});

test.describe('Audio Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).llmrtcClient !== undefined);

    await page.click('[data-testid="connect-btn"]');
    await expect(page.locator('[data-testid="connect-btn"]')).toHaveText('Connected', {
      timeout: 15000,
    });
  });

  test('should stop audio sharing', async ({ page }) => {
    // Start audio
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Stop audio
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'off',
      { timeout: 5000 }
    );

    // Button text should change back
    await expect(page.locator('[data-testid="share-audio-btn"]')).toContainText('Share Audio');
  });

  test('should enable video button after audio is shared', async ({ page }) => {
    // Initially video should be disabled
    await expect(page.locator('[data-testid="share-video-btn"]')).toBeDisabled();

    // Start audio
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Now video should be enabled
    await expect(page.locator('[data-testid="share-video-btn"]')).toBeEnabled();
  });

  test('should stop video and screen when audio is stopped', async ({ page }) => {
    // Start audio
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Start video
    await page.click('[data-testid="share-video-btn"]');
    await expect(page.locator('[data-testid="share-video-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Stop audio - should also stop video
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'off',
      { timeout: 5000 }
    );

    // Video should also be stopped
    await expect(page.locator('[data-testid="share-video-btn"]')).toHaveAttribute(
      'data-state',
      'off',
      { timeout: 5000 }
    );
  });
});
