#!/usr/bin/env node
/**
 * CLI entry point for the LLMRTC backend
 * Usage: npx llmrtc-backend
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

// Configuration from environment
const port = process.env.PORT ? Number(process.env.PORT) : 8787;
const host = process.env.HOST ?? '127.0.0.1';
const streamingTTS = process.env.STREAMING_TTS !== 'false';
const systemPrompt = process.env.SYSTEM_PROMPT ?? 'You are a helpful realtime voice assistant.';

// Create and start server
const server = new LLMRTCServer({
  providers: createProvidersFromEnv(),
  port,
  host,
  streamingTTS,
  systemPrompt
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
