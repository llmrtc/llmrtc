import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { ZaiLLMProvider } from '../src/index.js';

// Mock the OpenAI SDK (Z.ai exposes an OpenAI-compatible API)
vi.mock('openai', () => ({
  default: vi.fn()
}));

import OpenAI from 'openai';

describe('ZaiLLMProvider', () => {
  let provider: ZaiLLMProvider;
  let mockCreate: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Hello from GLM' }, finish_reason: 'stop' }]
    });
    (OpenAI as unknown as Mock).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } }
    }));
    provider = new ZaiLLMProvider({ apiKey: 'test-key' });
  });

  describe('constructor', () => {
    it('uses the Z.ai base URL and glm-5.2 by default', async () => {
      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: 'https://api.z.ai/api/paas/v4' })
      );
      await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
      expect(mockCreate.mock.calls[0][0].model).toBe('glm-5.2');
    });

    it('accepts custom model and base URL', () => {
      new ZaiLLMProvider({
        apiKey: 'k',
        model: 'glm-5',
        baseURL: 'https://api.z.ai/api/coding/paas/v4'
      });
      expect(OpenAI).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseURL: 'https://api.z.ai/api/coding/paas/v4' })
      );
    });
  });

  describe('complete()', () => {
    it('returns text and stop reason', async () => {
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'hi' }]
      });
      expect(result.fullText).toBe('Hello from GLM');
      expect(result.stopReason).toBe('end_turn');
    });

    it('passes tools and parses tool calls', async () => {
      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' }
            }]
          },
          finish_reason: 'tool_calls'
        }]
      });
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'weather?' }],
        tools: [{
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } }
        }]
      });
      expect(result.stopReason).toBe('tool_use');
      expect(result.toolCalls).toEqual([
        { callId: 'call_1', name: 'get_weather', arguments: { city: 'Tokyo' } }
      ]);
      expect(mockCreate.mock.calls[0][0].tools).toHaveLength(1);
    });

    it('replays assistant tool_calls in history', async () => {
      await provider.complete({
        messages: [
          { role: 'user', content: 'weather?' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ callId: 'call_1', name: 'get_weather', arguments: { city: 'Tokyo' } }]
          },
          { role: 'tool', content: '{"temp":22}', toolCallId: 'call_1', toolName: 'get_weather' }
        ]
      });
      const messages = mockCreate.mock.calls[0][0].messages;
      const assistant = messages.find((m: { role: string }) => m.role === 'assistant');
      expect(assistant.tool_calls).toHaveLength(1);
      expect(assistant.tool_calls[0].id).toBe('call_1');
      const tool = messages.find((m: { role: string }) => m.role === 'tool');
      expect(tool.tool_call_id).toBe('call_1');
    });
  });

  describe('stream()', () => {
    it('yields content chunks and a final chunk with stop reason', async () => {
      mockCreate.mockResolvedValue((async function* () {
        yield { choices: [{ delta: { content: 'Hel' } }] };
        yield { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] };
      })());

      const chunks = [];
      for await (const chunk of provider.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
        chunks.push(chunk);
      }
      expect(chunks.map(c => c.content).join('')).toBe('Hello');
      const final = chunks[chunks.length - 1];
      expect(final.done).toBe(true);
      expect(final.stopReason).toBe('end_turn');
    });

    it('assembles streamed tool calls across deltas', async () => {
      mockCreate.mockResolvedValue((async function* () {
        yield {
          choices: [{
            delta: {
              tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"ci' } }]
            }
          }]
        };
        yield {
          choices: [{
            delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"Tokyo"}' } }] },
            finish_reason: 'tool_calls'
          }]
        };
      })());

      const chunks = [];
      for await (const chunk of provider.stream({ messages: [{ role: 'user', content: 'w?' }] })) {
        chunks.push(chunk);
      }
      const final = chunks[chunks.length - 1];
      expect(final.stopReason).toBe('tool_use');
      expect(final.toolCalls).toEqual([
        { callId: 'call_1', name: 'get_weather', arguments: { city: 'Tokyo' } }
      ]);
    });
  });
});
