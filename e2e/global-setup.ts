import { FullConfig } from '@playwright/test';

// Default ports (should match playwright.config.ts)
// Note: .env.test is loaded by playwright.config.ts before this runs
const BACKEND_PORT = process.env.TEST_BACKEND_PORT ?? '8787';
const FRONTEND_PORT = process.env.TEST_FRONTEND_PORT ?? '5173';

/**
 * Playwright global setup.
 * Env vars are already loaded by playwright.config.ts from .env.test.
 * This setup performs additional checks and logging.
 */
async function globalSetup(_config: FullConfig) {
  // Log server configuration
  console.log('\n=== E2E Test Environment ===');
  console.log('Server Configuration:');
  console.log(`  - Backend: http://localhost:${BACKEND_PORT}`);
  console.log(`  - Frontend: http://localhost:${FRONTEND_PORT}`);
  console.log(`  - Signal URL: ws://localhost:${BACKEND_PORT}`);
  console.log('Provider Configuration:');
  console.log('  - OpenAI:', process.env.OPENAI_API_KEY ? 'configured' : 'NOT SET');
  console.log('  - ElevenLabs:', process.env.ELEVENLABS_API_KEY ? 'configured' : 'NOT SET');
  console.log('  - Anthropic:', process.env.ANTHROPIC_API_KEY ? 'configured' : 'NOT SET');
  console.log('  - Google:', process.env.GOOGLE_API_KEY ? 'configured' : 'NOT SET');
  console.log('  - AWS Bedrock:', process.env.AWS_ACCESS_KEY_ID ? 'configured' : 'NOT SET');
  console.log('  - OpenRouter:', process.env.OPENROUTER_API_KEY ? 'configured' : 'NOT SET');

  // Check local services if LOCAL_ONLY mode
  if (process.env.LOCAL_ONLY === 'true') {
    console.log('\nLocal Services:');
    const ollamaOk = await checkService(
      'Ollama',
      process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
      '/api/tags'
    );
    const lmstudioOk = await checkService(
      'LMStudio',
      process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234',
      '/v1/models'
    );
    const fasterWhisperOk = await checkService(
      'Faster Whisper',
      process.env.FASTER_WHISPER_URL ?? 'http://localhost:8000',
      '/health'
    );
    const piperOk = await checkService(
      'Piper TTS',
      process.env.PIPER_URL ?? 'http://localhost:5000',
      '/health'
    );

    if (!ollamaOk && !lmstudioOk) {
      console.warn('  WARNING: No local LLM service available');
    }
    if (!fasterWhisperOk) {
      console.warn('  WARNING: Faster Whisper not available');
    }
    if (!piperOk) {
      console.warn('  WARNING: Piper TTS not available');
    }
  }

  console.log('=============================\n');
}

async function checkService(
  name: string,
  baseUrl: string,
  healthPath: string
): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}${healthPath}`);
    const ok = response.ok;
    console.log(`  - ${name}:`, ok ? 'available' : 'unavailable');
    return ok;
  } catch {
    console.log(`  - ${name}: not running`);
    return false;
  }
}

export default globalSetup;
