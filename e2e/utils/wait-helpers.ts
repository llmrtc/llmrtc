import type { Page } from '@playwright/test';

/**
 * Wait for a WebSocket message of a specific type.
 */
export async function waitForWsMessage(
  page: Page,
  messageType: string,
  timeout = 10000
): Promise<unknown> {
  return page.evaluate(
    ({ messageType, timeout }) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timeout waiting for WS message: ${messageType}`)),
          timeout
        );

        // Assume we've exposed the client on window
        const client = (window as any).llmrtcClient;
        if (!client) {
          clearTimeout(timer);
          reject(new Error('llmrtcClient not found on window'));
          return;
        }

        const handler = (data: unknown) => {
          clearTimeout(timer);
          client.off(messageType, handler);
          resolve(data);
        };

        client.on(messageType, handler);
      });
    },
    { messageType, timeout }
  );
}

/**
 * Wait for the client to reach a specific connection state.
 */
export async function waitForConnectionState(
  page: Page,
  state: 'connected' | 'disconnected',
  timeout = 15000
): Promise<void> {
  const eventName = state === 'connected' ? 'connected' : 'disconnected';
  await waitForWsMessage(page, eventName, timeout);
}

/**
 * Wait for a transcript to be received.
 */
export async function waitForTranscript(
  page: Page,
  timeout = 30000
): Promise<string> {
  const result = (await page.evaluate(
    ({ timeout }) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timeout waiting for transcript')),
          timeout
        );

        const client = (window as any).llmrtcClient;
        if (!client) {
          clearTimeout(timer);
          reject(new Error('llmrtcClient not found on window'));
          return;
        }

        const handler = (data: { text: string; isFinal: boolean }) => {
          if (data.isFinal) {
            clearTimeout(timer);
            client.off('transcript', handler);
            resolve(data.text);
          }
        };

        client.on('transcript', handler);
      });
    },
    { timeout }
  )) as string;

  return result;
}

/**
 * Wait for an LLM response to complete.
 */
export async function waitForLLMResponse(
  page: Page,
  timeout = 60000
): Promise<string> {
  const result = (await page.evaluate(
    ({ timeout }) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timeout waiting for LLM response')),
          timeout
        );

        const client = (window as any).llmrtcClient;
        if (!client) {
          clearTimeout(timer);
          reject(new Error('llmrtcClient not found on window'));
          return;
        }

        let fullText = '';

        const chunkHandler = (data: { content: string; done: boolean }) => {
          fullText += data.content;
          if (data.done) {
            clearTimeout(timer);
            client.off('llm-chunk', chunkHandler);
            resolve(fullText);
          }
        };

        const fullHandler = (data: { text: string }) => {
          clearTimeout(timer);
          client.off('llm', fullHandler);
          client.off('llm-chunk', chunkHandler);
          resolve(data.text);
        };

        client.on('llm-chunk', chunkHandler);
        client.on('llm', fullHandler);
      });
    },
    { timeout }
  )) as string;

  return result;
}

/**
 * Wait for TTS playback to start.
 */
export async function waitForTTSStart(
  page: Page,
  timeout = 30000
): Promise<void> {
  await waitForWsMessage(page, 'tts-start', timeout);
}

/**
 * Wait for TTS playback to complete.
 */
export async function waitForTTSComplete(
  page: Page,
  timeout = 60000
): Promise<void> {
  await waitForWsMessage(page, 'tts-complete', timeout);
}

/**
 * Wait for speech detection events.
 */
export async function waitForSpeechStart(
  page: Page,
  timeout = 10000
): Promise<void> {
  await waitForWsMessage(page, 'speech-start', timeout);
}

export async function waitForSpeechEnd(
  page: Page,
  timeout = 10000
): Promise<void> {
  await waitForWsMessage(page, 'speech-end', timeout);
}

/**
 * Wait for the page to have the llmrtcClient available.
 */
export async function waitForClientReady(
  page: Page,
  timeout = 10000
): Promise<void> {
  await page.waitForFunction(
    () => (window as any).llmrtcClient !== undefined,
    { timeout }
  );
}

/**
 * Sleep helper for tests.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
