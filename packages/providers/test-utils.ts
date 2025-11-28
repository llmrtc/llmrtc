/**
 * Shared test utilities for provider unit tests.
 * Provides helpers for creating mock streams, responses, and common test patterns.
 */

/**
 * Create a mock AsyncIterable from an array of items.
 * Useful for mocking streaming responses.
 */
export function createMockStream<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item;
      }
    }
  };
}

/**
 * Create a mock Response-like object for fetch testing.
 */
export function createMockFetchResponse(options: {
  data?: unknown;
  buffer?: Buffer;
  ok?: boolean;
  status?: number;
  body?: AsyncIterable<Buffer>;
}) {
  const { data, buffer, ok = true, status = ok ? 200 : 500, body } = options;

  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
    arrayBuffer: () => Promise.resolve(buffer ?? Buffer.from(JSON.stringify(data ?? {}))),
    body
  };
}

/**
 * Create a mock readable stream with a getReader() interface.
 * Matches Web Streams API used by OpenAI SDK responses.
 */
export function createMockReadableStream(chunks: Buffer[]): {
  getReader: () => {
    read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  };
} {
  let index = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (index >= chunks.length) {
          return { done: true };
        }
        return { done: false, value: new Uint8Array(chunks[index++]) };
      }
    })
  };
}

/**
 * Create mock OpenAI chat completion response (non-streaming).
 */
export function createMockOpenAIChatCompletion(content: string | null) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: Date.now(),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content
        },
        finish_reason: 'stop'
      }
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30
    }
  };
}

/**
 * Create mock OpenAI streaming chunks.
 */
export function createMockOpenAIStreamChunks(texts: string[]) {
  return texts.map((text, index) => ({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        delta: {
          content: text
        },
        finish_reason: index === texts.length - 1 ? 'stop' : null
      }
    ]
  }));
}

/**
 * Create mock OpenAI Whisper transcription response.
 */
export function createMockWhisperResponse(text: string) {
  return {
    text,
    task: 'transcribe',
    language: 'en',
    duration: 1.5,
    segments: []
  };
}

/**
 * Create mock OpenAI TTS response.
 */
export function createMockTTSResponse(audioBuffer: Buffer) {
  return {
    arrayBuffer: () => Promise.resolve(audioBuffer),
    body: createMockReadableStream([audioBuffer])
  };
}

/**
 * Create mock Anthropic message response (non-streaming).
 */
export function createMockAnthropicResponse(text: string) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text
      }
    ],
    model: 'claude-sonnet-4-5-20250929',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 20
    }
  };
}

/**
 * Create mock Anthropic streaming events.
 */
export function createMockAnthropicStreamEvents(texts: string[]) {
  const events: Array<{ type: string; delta?: { type: string; text?: string } }> = [];

  // message_start
  events.push({ type: 'message_start' });

  // content_block_start
  events.push({ type: 'content_block_start' });

  // content_block_delta events for each text chunk
  for (const text of texts) {
    events.push({
      type: 'content_block_delta',
      delta: {
        type: 'text_delta',
        text
      }
    });
  }

  // content_block_stop
  events.push({ type: 'content_block_stop' });

  // message_stop
  events.push({ type: 'message_stop' });

  return events;
}

/**
 * Create a test audio buffer (fake PCM data).
 */
export function createTestAudioBuffer(sizeBytes = 4800): Buffer {
  // Create a buffer filled with alternating values to simulate audio
  const buffer = Buffer.alloc(sizeBytes);
  for (let i = 0; i < sizeBytes; i += 2) {
    // Create a simple sine-wave-like pattern
    const value = Math.floor(Math.sin(i / 100) * 32767);
    buffer.writeInt16LE(value, i);
  }
  return buffer;
}
