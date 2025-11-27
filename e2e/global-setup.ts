import { FullConfig } from '@playwright/test';
import { config } from 'dotenv';
import * as path from 'path';

const __dirname = path.dirname(__filename);

/**
 * Playwright global setup.
 * Loads environment variables from .env.test and performs initial checks.
 */
async function globalSetup(_config: FullConfig) {
  // Load .env.test from project root
  const envPath = path.resolve(__dirname, '..', '.env.test');
  config({ path: envPath });

  // Log which providers are configured
  console.log('\n=== E2E Test Environment ===');
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
      process.env.OLLAMA_URL ?? 'http://localhost:11434',
      '/api/tags'
    );
    const lmstudioOk = await checkService(
      'LMStudio',
      process.env.LMSTUDIO_URL ?? 'http://localhost:1234',
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
