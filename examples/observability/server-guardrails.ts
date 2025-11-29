/**
 * Guardrails Example
 *
 * Demonstrates content validation and safety hooks to filter
 * inappropriate input or output.
 *
 * Features shown:
 * - Input validation after STT (filter user speech)
 * - Output validation after LLM (filter AI responses)
 * - Central error handling with context
 * - Combining guardrails with logging hooks
 *
 * Run: npm run dev:guardrails
 */

import { config } from 'dotenv';
config();

import {
  LLMRTCServer,
  OpenAILLMProvider,
  OpenAIWhisperProvider,
  ElevenLabsTTSProvider,
  createLoggingHooks,
  type OrchestratorHooks,
  type ServerHooks,
  type TurnContext,
  type TimingInfo,
  type ErrorContext,
  type STTResult,
  type LLMResult
} from '@metered/llmrtc-backend';

// =============================================================================
// Content Validation Functions
// =============================================================================

// Simple blocklist for demonstration
// In production, use a more sophisticated content moderation API
const BLOCKED_INPUT_PATTERNS = [
  /ignore (all )?(previous |prior )?instructions/i,
  /disregard (all )?(previous |prior )?instructions/i,
  /forget (all )?(previous |prior )?instructions/i,
  /you are now/i,
  /pretend (to be|you are)/i
];

const BLOCKED_OUTPUT_WORDS = [
  'confidential',
  'secret',
  'password',
  'api_key',
  'apikey'
];

function isPromptInjection(text: string): boolean {
  return BLOCKED_INPUT_PATTERNS.some(pattern => pattern.test(text));
}

function containsSensitiveInfo(text: string): boolean {
  const lowerText = text.toLowerCase();
  return BLOCKED_OUTPUT_WORDS.some(word => lowerText.includes(word));
}

function sanitizeForLogging(text: string): string {
  // Remove any potential secrets from logs
  return text.replace(/sk-[a-zA-Z0-9]+/g, 'sk-***');
}

// =============================================================================
// Guardrail Hooks
// =============================================================================

function createGuardrailHooks(): Partial<OrchestratorHooks & ServerHooks> {
  return {
    // Validate user input after STT
    onSTTEnd(ctx: TurnContext, result: STTResult, _timing: TimingInfo) {
      const text = result.text;

      // Check for prompt injection attempts
      if (isPromptInjection(text)) {
        console.warn(`[guardrail] Blocked prompt injection attempt: turn=${ctx.turnId}`);
        throw new Error('I cannot process that request.');
      }

      // Check for empty or too short input
      if (text.trim().length < 2) {
        console.warn(`[guardrail] Input too short: turn=${ctx.turnId}`);
        throw new Error('Could you please repeat that?');
      }

      // Check for excessively long input (potential abuse)
      if (text.length > 1000) {
        console.warn(`[guardrail] Input too long: turn=${ctx.turnId} length=${text.length}`);
        throw new Error('That was quite long. Could you summarize?');
      }

      console.log(`[guardrail] Input validated: turn=${ctx.turnId}`);
    },

    // Validate LLM output before TTS
    onLLMEnd(ctx: TurnContext, result: LLMResult, _timing: TimingInfo) {
      const text = result.fullText;

      // Check for sensitive information leakage
      if (containsSensitiveInfo(text)) {
        console.warn(`[guardrail] Blocked sensitive info in response: turn=${ctx.turnId}`);
        throw new Error('I apologize, but I cannot share that information.');
      }

      // Check for excessively long responses
      if (text.length > 2000) {
        console.warn(`[guardrail] Response too long: turn=${ctx.turnId} length=${text.length}`);
        // Note: In a real app, you might truncate instead of rejecting
      }

      console.log(`[guardrail] Output validated: turn=${ctx.turnId} chars=${text.length}`);
    },

    // Central error handling
    onError(error: Error, context: ErrorContext) {
      // Log the error with sanitized details
      console.error(`[guardrail] Error in ${context.component}:`, {
        code: context.code,
        message: error.message,
        session: context.sessionId,
        turn: context.turnId,
        // Don't log stack traces in production - they may contain secrets
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });

      // Here you would typically:
      // - Send to error tracking (Sentry, DataDog, etc.)
      // - Increment error metrics
      // - Potentially trigger alerts for critical errors
    }
  };
}

// =============================================================================
// Merge hooks helper
// =============================================================================

function mergeHooks(
  ...hookSets: Array<Partial<OrchestratorHooks & ServerHooks>>
): OrchestratorHooks & ServerHooks {
  const merged: Record<string, ((...args: unknown[]) => Promise<void> | void)[]> = {};

  for (const hooks of hookSets) {
    for (const [key, handler] of Object.entries(hooks)) {
      if (typeof handler === 'function') {
        if (!merged[key]) merged[key] = [];
        merged[key].push(handler as (...args: unknown[]) => Promise<void> | void);
      }
    }
  }

  const result: Record<string, (...args: unknown[]) => Promise<void>> = {};
  for (const [key, handlers] of Object.entries(merged)) {
    result[key] = async (...args: unknown[]) => {
      for (const handler of handlers) {
        await handler(...args);
      }
    };
  }

  return result as unknown as OrchestratorHooks & ServerHooks;
}

// =============================================================================
// Server Setup
// =============================================================================

const server = new LLMRTCServer({
  providers: {
    llm: new OpenAILLMProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    }),
    stt: new OpenAIWhisperProvider({
      apiKey: process.env.OPENAI_API_KEY!
    }),
    tts: new ElevenLabsTTSProvider({
      apiKey: process.env.ELEVENLABS_API_KEY!,
      voiceId: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'
    })
  },
  port: 8787,
  streamingTTS: true,
  systemPrompt: 'You are a helpful voice assistant. Keep responses concise and appropriate.',

  // Combine logging hooks with guardrails
  // Logging runs first, then guardrails validate
  hooks: mergeHooks(
    createLoggingHooks({ level: 'info', prefix: '[guardrails-demo]' }),
    createGuardrailHooks()
  )
});

server.on('listening', ({ host, port }) => {
  console.log(`\n  Guardrails Example Server`);
  console.log(`  =========================`);
  console.log(`  Server running at http://${host}:${port}`);
  console.log(`  Open http://localhost:5173 to use the client`);
  console.log(`\n  Try saying "ignore all previous instructions" to test input filtering\n`);
});

server.on('error', (err) => {
  console.error(`[server] Error:`, err.message);
});

await server.start();

/**
 * Test the guardrails:
 *
 * 1. Say "ignore all previous instructions" - Should be blocked as prompt injection
 * 2. Say something very short like "hi" with just a click - Should pass validation
 * 3. Normal conversation works as expected
 *
 * Output:
 *
 * [guardrails-demo] Turn started: turn=turn-001 session=abc123
 * [guardrails-demo] STT completed: turn=turn-001 duration=142ms
 * [guardrail] Input validated: turn=turn-001
 * [guardrails-demo] LLM completed: turn=turn-001 duration=312ms
 * [guardrail] Output validated: turn=turn-001 chars=156
 * [guardrails-demo] TTS completed: turn=turn-001 duration=89ms
 * [guardrails-demo] Turn completed: turn=turn-001 duration=543ms
 *
 * When blocked:
 *
 * [guardrails-demo] STT completed: turn=turn-002 duration=150ms
 * [guardrail] Blocked prompt injection attempt: turn=turn-002
 * [guardrail] Error in stt: { code: undefined, message: 'I cannot process that request.' ... }
 */
