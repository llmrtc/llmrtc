/**
 * Cross-provider conversation-replay contract tests.
 *
 * Every LLM provider must be able to replay the same canonical multi-turn
 * tool conversation - user message, assistant message with parallel tool
 * calls, one result per call, follow-up user message - into a vendor request
 * its API accepts. These tests capture the outgoing vendor request via
 * mocked SDKs and assert the invariants each API enforces.
 */
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import type { Message } from '@llmrtc/llmrtc-core';

// ---------------------------------------------------------------------------
// SDK mocks (hoisted by vitest; each provider only touches its own SDK)
// ---------------------------------------------------------------------------
vi.mock('openai', () => ({ default: vi.fn(), toFile: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: vi.fn() }));
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(),
  ConverseCommand: vi.fn().mockImplementation((input) => ({ input })),
  ConverseStreamCommand: vi.fn().mockImplementation((input) => ({ input })),
}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import nodeFetch from 'node-fetch';

import { OpenAILLMProvider } from './openai/src/index.js';
import { OpenRouterLLMProvider } from './openrouter/src/index.js';
import { LMStudioLLMProvider } from './lmstudio/src/index.js';
import { AnthropicLLMProvider } from './anthropic/src/index.js';
import { GeminiLLMProvider } from './google/src/index.js';
import { BedrockLLMProvider } from './bedrock/src/index.js';
import { OllamaLLMProvider } from './local/src/index.js';
import {
  processStreamingFunctionCall,
  finalizeToolCalls as finalizeGeminiCalls,
  StreamingFunctionCallAccumulator,
} from './google/src/tool-adapter.js';

/**
 * The canonical tool conversation: parallel tool calls with one result each,
 * exactly as the core PlaybookOrchestrator records them.
 */
const TOOL_CONVERSATION: Message[] = [
  { role: 'system', content: 'You are a test assistant.' },
  { role: 'user', content: 'Weather in Tokyo and Osaka?' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [
      { callId: 'call_tokyo', name: 'get_weather', arguments: { city: 'Tokyo' } },
      { callId: 'call_osaka', name: 'get_weather', arguments: { city: 'Osaka' } },
    ],
  },
  { role: 'tool', content: '{"temp":22}', toolCallId: 'call_tokyo', toolName: 'get_weather' },
  { role: 'tool', content: '{"temp":25}', toolCallId: 'call_osaka', toolName: 'get_weather' },
  { role: 'user', content: 'Which is warmer?' },
];

const TOOLS = [
  {
    name: 'get_weather',
    description: 'Get weather for a city',
    parameters: {
      type: 'object' as const,
      properties: { city: { type: 'string' as const } },
      required: ['city'],
    },
  },
];

// ---------------------------------------------------------------------------
// OpenAI-compatible providers (OpenAI, OpenRouter, LMStudio)
// ---------------------------------------------------------------------------
describe.each([
  ['OpenAI', () => new OpenAILLMProvider({ apiKey: 'k' })],
  ['OpenRouter', () => new OpenRouterLLMProvider({ apiKey: 'k', model: 'openai/gpt-4o' })],
  ['LMStudio', () => new LMStudioLLMProvider({})],
])('%s tool conversation replay', (_name, makeProvider) => {
  let mockCreate: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Osaka' }, finish_reason: 'stop' }],
    });
    (OpenAI as unknown as Mock).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }));
  });

  it('replays assistant tool_calls and correlated tool results', async () => {
    const provider = makeProvider();
    await provider.complete({ messages: TOOL_CONVERSATION, tools: TOOLS });

    const request = mockCreate.mock.calls[0][0];
    const messages = request.messages as Array<Record<string, unknown>>;

    const assistant = messages.find(m => m.role === 'assistant');
    expect(assistant).toBeDefined();
    const toolCalls = assistant!.tool_calls as Array<{
      id: string;
      function: { name: string; arguments: string };
    }>;
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls.map(tc => tc.id)).toEqual(['call_tokyo', 'call_osaka']);
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ city: 'Tokyo' });

    // Every tool result references a call from the assistant message
    const toolMessages = messages.filter(m => m.role === 'tool');
    expect(toolMessages.map(m => m.tool_call_id)).toEqual(['call_tokyo', 'call_osaka']);
  });
});

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------
describe('Anthropic tool conversation replay', () => {
  let mockCreate: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Osaka' }],
      stop_reason: 'end_turn',
    });
    (Anthropic as unknown as Mock).mockImplementation(() => ({
      messages: { create: mockCreate },
    }));
  });

  it('replays tool_use blocks and groups results into one user turn', async () => {
    const provider = new AnthropicLLMProvider({ apiKey: 'k' });
    await provider.complete({ messages: TOOL_CONVERSATION, tools: TOOLS });

    const request = mockCreate.mock.calls[0][0];
    expect(request.system).toBe('You are a test assistant.');

    const messages = request.messages as Array<{ role: string; content: unknown }>;

    const assistant = messages.find(m => m.role === 'assistant')!;
    const toolUses = (assistant.content as Array<{ type: string; id?: string }>).filter(
      b => b.type === 'tool_use'
    );
    expect(toolUses.map(b => b.id)).toEqual(['call_tokyo', 'call_osaka']);

    // Both tool results are in ONE user message directly after the tool_use turn
    const resultTurn = messages[messages.indexOf(assistant) + 1];
    expect(resultTurn.role).toBe('user');
    const results = (resultTurn.content as Array<{ type: string; tool_use_id?: string }>).filter(
      b => b.type === 'tool_result'
    );
    expect(results.map(b => b.tool_use_id)).toEqual(['call_tokyo', 'call_osaka']);
  });

  it('maps toolChoice none to the API none type', async () => {
    const provider = new AnthropicLLMProvider({ apiKey: 'k' });
    await provider.complete({
      messages: TOOL_CONVERSATION,
      tools: TOOLS,
      toolChoice: 'none',
    });
    const request = mockCreate.mock.calls[0][0];
    expect(request.tool_choice).toEqual({ type: 'none' });
  });
});

// ---------------------------------------------------------------------------
// Google Gemini
// ---------------------------------------------------------------------------
describe('Gemini tool conversation replay', () => {
  let mockGenerate: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerate = vi.fn().mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'Osaka' }] }, finishReason: 'STOP' }],
      text: 'Osaka',
    });
    (GoogleGenAI as unknown as Mock).mockImplementation(() => ({
      models: { generateContent: mockGenerate, generateContentStream: vi.fn() },
    }));
  });

  it('replays functionCall parts and groups functionResponses', async () => {
    const provider = new GeminiLLMProvider({ apiKey: 'k' });
    await provider.complete({ messages: TOOL_CONVERSATION, tools: TOOLS });

    const request = mockGenerate.mock.calls[0][0];
    expect(request.config.systemInstruction).toBe('You are a test assistant.');

    const contents = request.contents as Array<{
      role: string;
      parts: Array<Record<string, unknown>>;
    }>;

    // No content entry may have empty parts
    for (const content of contents) {
      expect(content.parts.length).toBeGreaterThan(0);
    }

    // The model turn carries both functionCall parts
    const modelTurn = contents.find(c =>
      c.parts.some(p => p.functionCall)
    )!;
    expect(modelTurn.role).toBe('model');
    const calls = modelTurn.parts.filter(p => p.functionCall);
    expect(calls).toHaveLength(2);

    // Both functionResponses are grouped in the single following user turn
    const responseTurn = contents[contents.indexOf(modelTurn) + 1];
    expect(responseTurn.role).toBe('user');
    const responses = responseTurn.parts.filter(p => p.functionResponse);
    expect(responses).toHaveLength(2);
  });

  it('keeps parallel function calls arriving in separate stream chunks', () => {
    // Regression: a per-chunk index used to overwrite call 0 with call 1
    const accumulators = new Map<number, StreamingFunctionCallAccumulator>();
    let counter = 0;
    // chunk 1 carries the first call, chunk 2 the second
    processStreamingFunctionCall(accumulators, counter++, {
      name: 'get_weather',
      args: { city: 'Tokyo' },
    });
    processStreamingFunctionCall(accumulators, counter++, {
      name: 'get_weather',
      args: { city: 'Osaka' },
    });

    const calls = finalizeGeminiCalls(accumulators);
    expect(calls).toHaveLength(2);
    expect(calls.map(c => c.arguments.city)).toEqual(['Tokyo', 'Osaka']);
  });
});

// ---------------------------------------------------------------------------
// AWS Bedrock
// ---------------------------------------------------------------------------
describe('Bedrock tool conversation replay', () => {
  let mockSend: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn().mockResolvedValue({
      output: { message: { content: [{ text: 'Osaka' }] } },
      stopReason: 'end_turn',
    });
    (BedrockRuntimeClient as unknown as Mock).mockImplementation(() => ({
      send: mockSend,
    }));
  });

  it('merges parallel tool results into one user turn with strict alternation', async () => {
    const provider = new BedrockLLMProvider({});
    await provider.complete({ messages: TOOL_CONVERSATION, tools: TOOLS });

    const input = mockSend.mock.calls[0][0].input;
    const messages = input.messages as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;

    // The Converse API rejects consecutive same-role messages
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].role).not.toBe(messages[i - 1].role);
    }

    const assistant = messages.find(m => m.content.some(b => b.toolUse))!;
    expect(assistant.content.filter(b => b.toolUse)).toHaveLength(2);

    const resultTurn = messages[messages.indexOf(assistant) + 1];
    expect(resultTurn.role).toBe('user');
    const results = resultTurn.content.filter(b => b.toolResult) as Array<{
      toolResult: { toolUseId: string };
    }>;
    expect(results.map(r => r.toolResult.toolUseId)).toEqual(['call_tokyo', 'call_osaka']);
  });

  it('defaults to an on-demand-invocable inference profile id', async () => {
    const provider = new BedrockLLMProvider({});
    await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
    const input = mockSend.mock.calls[0][0].input;
    expect(input.modelId).toMatch(/^us\./);
  });
});

// ---------------------------------------------------------------------------
// Ollama (local)
// ---------------------------------------------------------------------------
describe('Ollama tool conversation replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockOllamaFetch(response: unknown) {
    (nodeFetch as unknown as Mock).mockImplementation((url: string) => {
      if (String(url).includes('/api/show')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ capabilities: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(response),
        text: () => Promise.resolve(''),
      });
    });
  }

  it('replays assistant tool_calls and honors sampling config', async () => {
    mockOllamaFetch({ message: { content: 'Osaka' } });
    const provider = new OllamaLLMProvider({});
    await provider.complete({
      messages: TOOL_CONVERSATION,
      tools: TOOLS,
      config: { temperature: 0.2, topP: 0.9, maxTokens: 128 },
    });

    const chatCall = (nodeFetch as unknown as Mock).mock.calls.find(([url]) =>
      String(url).includes('/api/chat')
    )!;
    const body = JSON.parse(chatCall[1].body as string);

    const assistant = body.messages.find(
      (m: { role: string; tool_calls?: unknown[] }) => m.role === 'assistant' && m.tool_calls
    );
    expect(assistant).toBeDefined();
    expect(assistant.tool_calls).toHaveLength(2);
    expect(assistant.tool_calls[0].function).toEqual({
      name: 'get_weather',
      arguments: { city: 'Tokyo' },
    });

    expect(body.options).toEqual({ temperature: 0.2, top_p: 0.9, num_predict: 128 });
  });

  it('collects streamed tool calls from intermediate chunks', async () => {
    const lines = [
      JSON.stringify({
        message: {
          content: '',
          tool_calls: [{ function: { name: 'get_weather', arguments: { city: 'Tokyo' } } }],
        },
        done: false,
      }),
      JSON.stringify({ message: { content: '' }, done: true, done_reason: 'stop' }),
    ];
    (nodeFetch as unknown as Mock).mockImplementation((url: string) => {
      if (String(url).includes('/api/show')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ capabilities: [] }) });
      }
      return Promise.resolve({
        ok: true,
        body: (async function* () {
          for (const line of lines) yield Buffer.from(line + '\n');
        })(),
      });
    });

    const provider = new OllamaLLMProvider({});
    const chunks = [];
    for await (const chunk of provider.stream!({ messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk);
    }

    const final = chunks[chunks.length - 1];
    expect(final.done).toBe(true);
    expect(final.stopReason).toBe('tool_use');
    expect(final.toolCalls).toHaveLength(1);
    expect(final.toolCalls![0].name).toBe('get_weather');
  });

  it('reassembles NDJSON lines split across network chunks', async () => {
    const line = JSON.stringify({ message: { content: 'Hello World' }, done: false });
    const half = Math.floor(line.length / 2);
    (nodeFetch as unknown as Mock).mockImplementation((url: string) => {
      if (String(url).includes('/api/show')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ capabilities: [] }) });
      }
      return Promise.resolve({
        ok: true,
        body: (async function* () {
          yield Buffer.from(line.slice(0, half));
          yield Buffer.from(line.slice(half) + '\n');
          yield Buffer.from(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
        })(),
      });
    });

    const provider = new OllamaLLMProvider({});
    let text = '';
    for await (const chunk of provider.stream!({ messages: [{ role: 'user', content: 'hi' }] })) {
      if (!chunk.done) text += chunk.content;
    }
    expect(text).toBe('Hello World');
  });

  it('throws with the response body on stream errors instead of yielding empty turns', async () => {
    (nodeFetch as unknown as Mock).mockImplementation((url: string) => {
      if (String(url).includes('/api/show')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ capabilities: [] }) });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve('model not found'),
      });
    });

    const provider = new OllamaLLMProvider({});
    await expect(async () => {
      for await (const _ of provider.stream!({ messages: [{ role: 'user', content: 'hi' }] })) {
        // drain
      }
    }).rejects.toThrow(/404.*model not found/);
  });
});
