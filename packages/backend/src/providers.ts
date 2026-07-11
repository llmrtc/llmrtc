/**
 * Provider factory functions for CLI usage
 * These functions create providers based on environment variables
 */

import type {
  ConversationProviders,
  LLMProvider,
  STTProvider,
  TTSProvider,
  VisionProvider
} from '@llmrtc/llmrtc-core';

import {
  OpenAILLMProvider,
  OpenAIWhisperProvider,
  OpenAIRealtimeSTTProvider,
  OpenAITTSProvider
} from '@llmrtc/llmrtc-provider-openai';
import { ElevenLabsTTSProvider, ElevenLabsScribeProvider } from '@llmrtc/llmrtc-provider-elevenlabs';
import {
  OllamaVisionProvider,
  OllamaLLMProvider,
  FasterWhisperProvider,
  PiperTTSProvider
} from '@llmrtc/llmrtc-provider-local';
import { AnthropicLLMProvider } from '@llmrtc/llmrtc-provider-anthropic';
import { GeminiLLMProvider } from '@llmrtc/llmrtc-provider-google';
import { BedrockLLMProvider } from '@llmrtc/llmrtc-provider-bedrock';
import { OpenRouterLLMProvider } from '@llmrtc/llmrtc-provider-openrouter';
import { ZaiLLMProvider } from '@llmrtc/llmrtc-provider-zai';
import { LMStudioLLMProvider } from '@llmrtc/llmrtc-provider-lmstudio';

/**
 * Create all providers from environment variables
 */
export function createProvidersFromEnv(): ConversationProviders {
  return {
    llm: createLLMProvider(),
    stt: createSTTProvider(),
    tts: createTTSProvider(),
    vision: createVisionProvider()
  };
}

/**
 * LLM Provider selection priority:
 * 1. LLM_PROVIDER env var (explicit selection)
 * 2. LOCAL_ONLY=true → ollama
 * 3. Auto-detect based on available API keys
 */
function createLLMProvider(): LLMProvider {
  const explicit = process.env.LLM_PROVIDER?.trim().toLowerCase();

  if (explicit) {
    switch (explicit) {
      case 'anthropic':
        return new AnthropicLLMProvider({
          apiKey: process.env.ANTHROPIC_API_KEY ?? '',
          model: process.env.ANTHROPIC_MODEL,
          promptCaching: process.env.ANTHROPIC_PROMPT_CACHING === 'true'
        });
      case 'google':
      case 'gemini':
        return new GeminiLLMProvider({
          apiKey: process.env.GOOGLE_API_KEY ?? '',
          model: process.env.GOOGLE_MODEL
        });
      case 'bedrock':
        return new BedrockLLMProvider({
          region: process.env.AWS_REGION ?? 'us-east-1',
          credentials: process.env.AWS_ACCESS_KEY_ID
            ? {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? ''
              }
            : undefined,
          model: process.env.BEDROCK_MODEL
        });
      case 'openrouter':
        return new OpenRouterLLMProvider({
          apiKey: process.env.OPENROUTER_API_KEY ?? '',
          model: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4.5'
        });
      case 'zai':
      case 'glm':
        return new ZaiLLMProvider({
          apiKey: process.env.ZAI_API_KEY ?? '',
          model: process.env.ZAI_MODEL
        });
      case 'lmstudio':
        return new LMStudioLLMProvider({
          baseUrl: process.env.LMSTUDIO_BASE_URL,
          model: process.env.LMSTUDIO_MODEL
        });
      case 'ollama':
        return new OllamaLLMProvider({
          baseUrl: process.env.OLLAMA_BASE_URL,
          model: process.env.OLLAMA_MODEL
        });
      case 'openai':
      default:
        if (explicit !== 'openai') {
          console.warn(
            `[llmrtc] Unrecognized LLM_PROVIDER "${explicit}" - falling back to OpenAI. ` +
              `Valid values: openai, anthropic, google, gemini, bedrock, openrouter, zai, glm, lmstudio, ollama.`
          );
        }
        return new OpenAILLMProvider({
          apiKey: process.env.OPENAI_API_KEY ?? '',
          baseURL: process.env.OPENAI_BASE_URL,
          model: process.env.OPENAI_MODEL
        });
    }
  }

  // LOCAL_ONLY mode
  if (process.env.LOCAL_ONLY === 'true') {
    return new OllamaLLMProvider({
      baseUrl: process.env.OLLAMA_BASE_URL,
      model: process.env.OLLAMA_MODEL
    });
  }

  // Auto-detect based on available API keys
  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicLLMProvider({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL,
      promptCaching: process.env.ANTHROPIC_PROMPT_CACHING === 'true'
    });
  }
  if (process.env.GOOGLE_API_KEY) {
    return new GeminiLLMProvider({
      apiKey: process.env.GOOGLE_API_KEY,
      model: process.env.GOOGLE_MODEL
    });
  }
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return new BedrockLLMProvider({
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      },
      model: process.env.BEDROCK_MODEL
    });
  }
  if (process.env.OPENROUTER_API_KEY) {
    return new OpenRouterLLMProvider({
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4.5'
    });
  }

  // Default to OpenAI
  return new OpenAILLMProvider({
    apiKey: process.env.OPENAI_API_KEY ?? '',
    baseURL: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL
  });
}

/**
 * STT Provider selection priority:
 * 1. STT_PROVIDER env var (explicit selection)
 * 2. LOCAL_ONLY=true → faster-whisper
 * 3. Default to OpenAI Whisper
 */
function createSTTProvider(): STTProvider {
  const explicit = process.env.STT_PROVIDER?.trim().toLowerCase();

  if (explicit === 'faster-whisper' || explicit === 'fasterwhisper') {
    return new FasterWhisperProvider({
      baseUrl: process.env.FASTER_WHISPER_URL
    });
  }

  // ElevenLabs Scribe: batch + realtime streaming STT
  if (explicit === 'elevenlabs' || explicit === 'scribe' || explicit === 'elevenlabs-scribe') {
    return new ElevenLabsScribeProvider({
      apiKey: process.env.ELEVENLABS_API_KEY ?? '',
      modelId: process.env.ELEVENLABS_STT_MODEL || undefined
    });
  }

  // OpenAI Realtime API: streaming transcription
  if (explicit === 'openai-realtime' || explicit === 'realtime') {
    return new OpenAIRealtimeSTTProvider({
      apiKey: process.env.OPENAI_API_KEY ?? '',
      model: process.env.OPENAI_STT_MODEL || undefined
    });
  }

  if (process.env.LOCAL_ONLY === 'true') {
    return new FasterWhisperProvider({
      baseUrl: process.env.FASTER_WHISPER_URL
    });
  }

  return new OpenAIWhisperProvider({
    apiKey: process.env.OPENAI_API_KEY ?? '',
    baseURL: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_STT_MODEL || undefined
  });
}

/**
 * TTS Provider selection priority:
 * 1. TTS_PROVIDER env var (explicit selection)
 * 2. LOCAL_ONLY=true → piper
 * 3. Auto-detect based on available API keys
 */
function createTTSProvider(): TTSProvider {
  const explicit = process.env.TTS_PROVIDER?.toLowerCase();

  if (explicit) {
    switch (explicit) {
      case 'openai':
        return new OpenAITTSProvider({
          apiKey: process.env.OPENAI_API_KEY ?? '',
          baseURL: process.env.OPENAI_BASE_URL,
          model: process.env.OPENAI_TTS_MODEL || undefined,
          voice: process.env.OPENAI_TTS_VOICE || 'nova',
          instructions: process.env.OPENAI_TTS_INSTRUCTIONS || undefined
        });
      case 'piper':
        return new PiperTTSProvider({
          baseUrl: process.env.PIPER_URL
        });
      case 'elevenlabs':
      default:
        return new ElevenLabsTTSProvider({
          apiKey: process.env.ELEVENLABS_API_KEY ?? ''
        });
    }
  }

  if (process.env.LOCAL_ONLY === 'true') {
    return new PiperTTSProvider({
      baseUrl: process.env.PIPER_URL
    });
  }

  // Auto-detect: prefer ElevenLabs if key is set, otherwise OpenAI
  if (process.env.ELEVENLABS_API_KEY) {
    return new ElevenLabsTTSProvider({
      apiKey: process.env.ELEVENLABS_API_KEY
    });
  }

  // Fall back to OpenAI TTS if no ElevenLabs key
  return new OpenAITTSProvider({
    apiKey: process.env.OPENAI_API_KEY ?? '',
    baseURL: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_TTS_MODEL || undefined,
    voice: process.env.OPENAI_TTS_VOICE || 'nova',
    instructions: process.env.OPENAI_TTS_INSTRUCTIONS || undefined
  });
}

/**
 * Vision Provider - only created in LOCAL_ONLY mode
 */
function createVisionProvider(): VisionProvider | undefined {
  if (process.env.LOCAL_ONLY === 'true') {
    // Default stays 'llava' here for compatibility with existing
    // LOCAL_ONLY deployments; the OllamaVisionProvider class itself
    // defaults to qwen3-vl for new code.
    return new OllamaVisionProvider({
      baseUrl: process.env.OLLAMA_BASE_URL,
      model: process.env.OLLAMA_VISION_MODEL ?? 'llava'
    });
  }
  return undefined;
}
