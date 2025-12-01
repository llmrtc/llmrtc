import type { Page } from '@playwright/test';

/**
 * Force close the WebSocket connection to trigger reconnection.
 * Uses the testing helper exposed on the demo app.
 */
export async function forceWebSocketClose(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const helpers = (window as any).llmrtcTestHelpers;
    if (helpers?.forceDisconnect) {
      helpers.forceDisconnect();
      console.log('[e2e] Force disconnect called via helper');
      return true;
    } else {
      // Fallback: try to close WebSocket directly
      const client = (window as any).llmrtcClient;
      if (client && (client as any).ws) {
        const ws = (client as any).ws as WebSocket;
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(4000, 'Test: simulating disconnect');
          console.log('[e2e] Force disconnect called directly on WebSocket');
          return true;
        }
      }
      console.log('[e2e] Could not force disconnect - no WebSocket found');
      return false;
    }
  });
}

/**
 * Wait for the client to enter reconnecting state.
 */
export async function waitForReconnecting(
  page: Page,
  timeout = 10000
): Promise<{ attempt: number; maxAttempts: number }> {
  return page.evaluate(
    ({ timeout }) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timeout waiting for reconnecting state')),
          timeout
        );

        const client = (window as any).llmrtcClient;
        if (!client) {
          clearTimeout(timer);
          reject(new Error('llmrtcClient not found on window'));
          return;
        }

        const handler = (attempt: number, maxAttempts: number) => {
          clearTimeout(timer);
          client.off('reconnecting', handler);
          resolve({ attempt, maxAttempts });
        };

        client.on('reconnecting', handler);
      });
    },
    { timeout }
  );
}

/**
 * Wait for reconnection to complete successfully.
 */
export async function waitForReconnection(
  page: Page,
  timeout = 30000
): Promise<void> {
  await page.evaluate(
    ({ timeout }) => {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timeout waiting for reconnection')),
          timeout
        );

        const client = (window as any).llmrtcClient;
        if (!client) {
          clearTimeout(timer);
          reject(new Error('llmrtcClient not found on window'));
          return;
        }

        // Already connected
        if (client.state === 'connected') {
          clearTimeout(timer);
          resolve();
          return;
        }

        // Listen for stateChange event (client emits stateChange, not 'connected')
        const handler = (state: string) => {
          if (state === 'connected') {
            clearTimeout(timer);
            client.off('stateChange', handler);
            resolve();
          }
        };

        client.on('stateChange', handler);
      });
    },
    { timeout }
  );
}

/**
 * Get current session ID from the client.
 */
export async function getSessionId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const helpers = (window as any).llmrtcTestHelpers;
    if (helpers?.getSessionId) {
      return helpers.getSessionId();
    }
    const client = (window as any).llmrtcClient;
    return client?.currentSessionId ?? null;
  });
}

/**
 * Get current connection state from the client.
 */
export async function getConnectionState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const client = (window as any).llmrtcClient;
    return client?.state ?? 'unknown';
  });
}

/**
 * Wait for TTS to be cancelled (barge-in).
 */
export async function waitForTTSCancelled(
  page: Page,
  timeout = 30000
): Promise<void> {
  await page.evaluate(
    ({ timeout }) => {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timeout waiting for TTS cancellation')),
          timeout
        );

        const client = (window as any).llmrtcClient;
        if (!client) {
          clearTimeout(timer);
          reject(new Error('llmrtcClient not found on window'));
          return;
        }

        const handler = () => {
          clearTimeout(timer);
          client.off('ttsCancelled', handler);
          resolve();
        };

        client.on('ttsCancelled', handler);
      });
    },
    { timeout }
  );
}

/**
 * Check if TTS is currently playing.
 */
export async function isTTSPlaying(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // Check the TTS status from the demo app's state
    const statusEl = document.querySelector('[data-testid="tts-status"]');
    return statusEl !== null;
  });
}
