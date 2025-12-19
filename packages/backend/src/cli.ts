#!/usr/bin/env node
/**
 * CLI entry point for the LLMRTC backend
 * Usage: npx llmrtc-backend [--port PORT] [--host HOST]
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get the directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from monorepo root (packages/backend/src -> ../../..)
// Also try dist folder path (packages/backend/dist -> ../../..)
function loadEnv(): void {
  // Try from src directory (development)
  let envPath = resolve(__dirname, '..', '..', '..', '.env');
  let result = config({ path: envPath });

  if (result.error) {
    // Try from dist directory (production build)
    envPath = resolve(__dirname, '..', '..', '..', '.env');
    result = config({ path: envPath });
  }

  if (result.error) {
    console.warn(`[cli] Could not load .env from ${envPath}:`, result.error.message);
    // Try cwd as fallback
    const cwdEnvPath = resolve(process.cwd(), '.env');
    console.log(`[cli] Trying fallback .env at ${cwdEnvPath}`);
    config({ path: cwdEnvPath });
  } else {
    console.log(`[cli] Loaded .env from ${envPath}`);
  }
}

loadEnv();

// Import after env loading
import { LLMRTCServer } from './server.js';
import { createProvidersFromEnv } from './providers.js';

// Parse CLI arguments
function parseArgs(): { port?: number; host?: string } {
  const args = process.argv.slice(2);
  const result: { port?: number; host?: string } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' || arg === '-p') {
      const value = args[++i];
      if (value) {
        const parsed = Number(value);
        if (!isNaN(parsed)) result.port = parsed;
      }
    } else if (arg.startsWith('--port=')) {
      const parsed = Number(arg.slice(7));
      if (!isNaN(parsed)) result.port = parsed;
    } else if (arg === '--host' || arg === '-h') {
      const value = args[++i];
      if (value && !value.startsWith('-')) result.host = value;
    } else if (arg.startsWith('--host=')) {
      result.host = arg.slice(7);
    } else if (arg === '--help') {
      console.log(`
Usage: llmrtc-backend [options]

Options:
  --port, -p <port>  Server port (default: 8787, env: PORT)
  --host <host>      Server host (default: 127.0.0.1, env: HOST)
  --help             Show this help message

Environment variables:
  PORT               Server port
  HOST               Server host
  OPENAI_API_KEY     OpenAI API key for LLM/STT/TTS
  ANTHROPIC_API_KEY  Anthropic API key
  ELEVENLABS_API_KEY ElevenLabs API key for TTS
  SYSTEM_PROMPT      System prompt for AI assistant
  STREAMING_TTS      Enable streaming TTS (default: true)
`);
      process.exit(0);
    }
  }

  return result;
}

const cliArgs = parseArgs();

// Configuration from CLI args, then environment, then defaults
const port = cliArgs.port ?? (process.env.PORT ? Number(process.env.PORT) : 8787);
const host = cliArgs.host ?? process.env.HOST ?? '127.0.0.1';
const streamingTTS = process.env.STREAMING_TTS !== 'false';
const systemPrompt = process.env.SYSTEM_PROMPT ?? 'You are a helpful realtime voice assistant.';

// ICE/TURN configuration from environment
// Priority: ICE_SERVERS (custom) > METERED_* (Metered TURN) > default STUN
const metered = process.env.METERED_APP_NAME && process.env.METERED_API_KEY
  ? {
      appName: process.env.METERED_APP_NAME,
      apiKey: process.env.METERED_API_KEY,
      region: process.env.METERED_REGION
    }
  : undefined;

// Custom ICE servers override (JSON array string)
let iceServers: RTCIceServer[] | undefined;
if (process.env.ICE_SERVERS) {
  try {
    iceServers = JSON.parse(process.env.ICE_SERVERS);
    console.log(`[cli] Loaded ${iceServers?.length ?? 0} custom ICE servers from ICE_SERVERS env`);
  } catch (err) {
    console.warn('[cli] Failed to parse ICE_SERVERS env var:', err);
  }
}

if (metered) {
  console.log(`[cli] Metered TURN configured: ${metered.appName}.metered.live${metered.region ? ` (region: ${metered.region})` : ''}`);
}

// Create and start server
const server = new LLMRTCServer({
  providers: createProvidersFromEnv(),
  port,
  host,
  streamingTTS,
  systemPrompt,
  metered,
  iceServers
});

server.start().catch((err) => {
  console.error('[cli] Failed to start server:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[cli] Received SIGTERM, shutting down...');
  await server.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[cli] Received SIGINT, shutting down...');
  await server.stop();
  process.exit(0);
});
