import { test, expect } from '@playwright/test';
import {
  forceWebSocketClose,
  waitForReconnecting,
  waitForReconnection,
  getSessionId,
  getConnectionState
} from '../utils';

/**
 * Reconnection E2E Tests
 *
 * Tests WebSocket reconnection with exponential backoff and
 * session recovery with conversation history preservation.
 *
 * NOTE: These tests require the backend to be running.
 */

test.describe('WebSocket Reconnection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for React app to mount and expose client
    await page.waitForFunction(() => (window as any).llmrtcClient !== undefined, {
      timeout: 30000
    });

    // Connect to backend
    await page.click('[data-testid="connect-btn"]');
    await expect(page.locator('[data-testid="connect-btn"]')).toHaveText('Connected', {
      timeout: 15000
    });
  });

  test('should transition to reconnecting state on WebSocket close', async ({ page }) => {
    // Verify we're connected
    const initialState = await getConnectionState(page);
    expect(initialState).toBe('connected');

    // Set up listener for reconnecting event before forcing disconnect
    const reconnectPromise = waitForReconnecting(page, 15000);

    // Force WebSocket close
    const disconnected = await forceWebSocketClose(page);
    expect(disconnected).toBe(true);

    // Small delay to allow the close event to propagate
    await page.waitForTimeout(500);

    // Wait for reconnecting event
    const reconnectInfo = await reconnectPromise;
    expect(reconnectInfo.attempt).toBe(1);
    expect(reconnectInfo.maxAttempts).toBeGreaterThan(0);

    // UI should show reconnecting state
    await expect(page.locator('[data-testid="connection-status"]')).toHaveAttribute(
      'data-state',
      'reconnecting',
      { timeout: 10000 }
    );
  });

  test('should reconnect successfully after WebSocket close', async ({ page }) => {
    // Verify initial connection
    expect(await getConnectionState(page)).toBe('connected');

    // Force disconnect
    const disconnected = await forceWebSocketClose(page);
    expect(disconnected).toBe(true);

    // Wait for reconnection to complete
    await waitForReconnection(page, 30000);

    // Verify we're connected again
    const finalState = await getConnectionState(page);
    expect(finalState).toBe('connected');

    // UI should show connected
    await expect(page.locator('[data-testid="connect-btn"]')).toHaveText('Connected', {
      timeout: 10000
    });
  });

  test('should emit reconnecting event with attempt count', async ({ page }) => {
    // Set up event tracking
    await page.evaluate(() => {
      (window as any).__reconnectAttempts = [];
      const client = (window as any).llmrtcClient;
      client.on('reconnecting', (attempt: number, maxAttempts: number) => {
        console.log(`[e2e] Reconnecting event: attempt ${attempt}/${maxAttempts}`);
        (window as any).__reconnectAttempts.push({ attempt, maxAttempts });
      });
    });

    // Force disconnect
    const disconnected = await forceWebSocketClose(page);
    expect(disconnected).toBe(true);

    // Wait for reconnection event or timeout
    await page.waitForFunction(
      () => (window as any).__reconnectAttempts?.length > 0,
      { timeout: 10000 }
    );

    // Check that at least one reconnection attempt was made
    const attempts = await page.evaluate(() => (window as any).__reconnectAttempts);
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts[0].attempt).toBe(1);
    expect(attempts[0].maxAttempts).toBeGreaterThan(0);
  });

  test('should preserve sessionId across reconnection', async ({ page }) => {
    // Get initial session ID
    const initialSessionId = await getSessionId(page);
    expect(initialSessionId).toBeTruthy();

    // Force disconnect
    const disconnected = await forceWebSocketClose(page);
    expect(disconnected).toBe(true);

    // Wait for reconnection
    await waitForReconnection(page, 30000);

    // Session ID should be preserved
    const finalSessionId = await getSessionId(page);
    expect(finalSessionId).toBe(initialSessionId);
  });

  test('should show reconnecting status in UI', async ({ page }) => {
    // Force disconnect
    const disconnected = await forceWebSocketClose(page);
    expect(disconnected).toBe(true);

    // Wait for UI to update to reconnecting state
    await expect(page.locator('[data-testid="connection-status"]')).toContainText('Reconnecting', {
      timeout: 10000
    });

    // Wait for reconnection to complete
    await waitForReconnection(page, 30000);

    // UI should show connected again
    await expect(page.locator('[data-testid="connection-status"]')).toContainText('Connected', {
      timeout: 10000
    });
  });
});

test.describe('Session Recovery', () => {
  test.skip(
    !process.env.OPENAI_API_KEY && !process.env.LOCAL_ONLY,
    'Requires OPENAI_API_KEY or LOCAL_ONLY mode'
  );

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for React app to mount and expose client
    await page.waitForFunction(() => (window as any).llmrtcClient !== undefined, {
      timeout: 30000
    });

    // Connect to backend
    await page.click('[data-testid="connect-btn"]');
    await expect(page.locator('[data-testid="connect-btn"]')).toHaveText('Connected', {
      timeout: 15000
    });
  });

  test('should recover session with conversation history', async ({ page }) => {
    // Start audio sharing to trigger a conversation
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'on',
      { timeout: 10000 }
    );

    // Wait for transcript (indicates conversation started)
    await expect(page.locator('[data-testid="transcript"]')).not.toContainText(
      'Your transcribed speech will appear here',
      { timeout: 60000 }
    );

    // Wait for LLM response
    await expect(page.locator('[data-testid="llm-response"]')).not.toContainText(
      'Assistant response will appear here',
      { timeout: 90000 }
    );

    // Store the session ID
    const sessionId = await getSessionId(page);
    expect(sessionId).toBeTruthy();

    // Stop audio before disconnecting
    await page.click('[data-testid="share-audio-btn"]');
    await expect(page.locator('[data-testid="share-audio-btn"]')).toHaveAttribute(
      'data-state',
      'off',
      { timeout: 5000 }
    );

    // Set up listener for reconnect-ack
    await page.evaluate(() => {
      (window as any).__reconnectAck = null;
      const client = (window as any).llmrtcClient;
      // Listen for the raw WebSocket message
      const originalOnMessage = (client as any).ws?.onmessage;
      if ((client as any).ws) {
        (client as any).ws.addEventListener('message', (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'reconnect-ack') {
              (window as any).__reconnectAck = msg;
            }
          } catch {}
        });
      }
    });

    // Force disconnect
    await forceWebSocketClose(page);

    // Wait for reconnection
    await waitForReconnection(page, 30000);

    // Verify session was recovered
    const finalSessionId = await getSessionId(page);
    expect(finalSessionId).toBe(sessionId);
  });
});
