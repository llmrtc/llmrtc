# E2E Test Suite for @metered/llmrtc

Comprehensive end-to-end testing for the LLMRTC real-time voice and vision conversation system.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running Tests](#running-tests)
- [Test Suite Structure](#test-suite-structure)
- [Fake Media Strategy](#fake-media-strategy)
- [Environment Variables](#environment-variables)
- [Writing New Tests](#writing-new-tests)
- [Provider Tests](#provider-tests)
- [Local Provider Testing](#local-provider-testing)
- [Troubleshooting](#troubleshooting)
- [CI/CD Integration](#cicd-integration)

---

## Overview

This E2E test suite validates the complete @metered/llmrtc system including:

- **WebRTC Connection** - WebSocket signaling and peer connection establishment
- **Audio Flow** - Microphone → VAD → STT → LLM → TTS → Speaker
- **Video/Vision** - Camera capture and vision-based conversations
- **Provider Integration** - Testing with real cloud and local AI providers
- **Reconnection** - Connection recovery and session persistence

The tests use **Playwright** with **Chrome fake media flags** to inject pre-recorded audio/video as camera and microphone input, enabling fully automated testing without real hardware.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        E2E Test Runner                          │
│                        (Playwright)                             │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Browser Tests  │  │  Backend Tests  │  │ Provider Tests  │
│  (Fake Media)   │  │  (Real Server)  │  │  (Cloud/Local)  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Pre-recorded    │  │ Test Backend    │  │ OpenAI, Ollama  │
│ Audio/Video     │  │ Instance        │  │ ElevenLabs, etc │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| **Node.js** | ≥ 20.x | Runtime environment |
| **npm** | ≥ 10.x | Package manager |
| **ffmpeg** | Any recent | Creating test media files |

### Optional (for local provider testing)

| Software | Default URL | Purpose |
|----------|-------------|---------|
| **Ollama** | http://localhost:11434 | Local LLM |
| **LMStudio** | http://localhost:1234 | Local LLM (OpenAI-compatible) |
| **Faster Whisper** | http://localhost:8000 | Local STT |
| **Piper TTS** | http://localhost:5000 | Local TTS |

### API Keys (for cloud provider testing)

| Provider | Environment Variable | Get Key At |
|----------|---------------------|------------|
| **OpenAI** | `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
| **ElevenLabs** | `ELEVENLABS_API_KEY` | https://elevenlabs.io/ |
| **Anthropic** | `ANTHROPIC_API_KEY` | https://console.anthropic.com/ |
| **Google** | `GOOGLE_API_KEY` | https://aistudio.google.com/app/apikey |
| **OpenRouter** | `OPENROUTER_API_KEY` | https://openrouter.ai/keys |

---

## Setup

### 1. Install Dependencies

```bash
# From the project root
npm install

# Install Playwright browsers (Chromium only)
npx playwright install chromium
```

### 2. Create Environment File

```bash
# Copy the example environment file
cp .env.test.example .env.test

# Edit and fill in your API keys
nano .env.test   # or use your preferred editor
```

### 3. Verify Test Fixtures

Test media files should already exist in `e2e/fixtures/`:

```bash
ls -la e2e/fixtures/
# Should show:
# - test-audio.wav  (~1.7 MB, 9 seconds of speech)
# - test-video.y4m  (~8.6 MB, 5 seconds of video)
# - test-image.jpg  (test image for vision)
```

If missing, recreate them:

```bash
# Generate test audio (macOS)
say -v Samantha -r 150 -o speech.aiff "Hello, I am testing the voice assistant. Please tell me a short joke."
ffmpeg -i speech.aiff -ar 48000 -ac 2 -sample_fmt s16 e2e/fixtures/test-audio.wav
rm speech.aiff

# Generate test video
ffmpeg -f lavfi -i testsrc=duration=5:size=320x240:rate=15 -pix_fmt yuv420p e2e/fixtures/test-video.y4m

# Generate test image
ffmpeg -f lavfi -i "color=c=blue:s=320x240:d=1" -frames:v 1 e2e/fixtures/test-image.jpg
```

### 4. Build the Project

```bash
npm run build
```

---

## Running Tests

### Start the Backend First

In a separate terminal:

```bash
npm run dev:backend
```

### Run All E2E Tests

```bash
npm run test:e2e
```

### Run with Playwright UI

Interactive mode with step-by-step debugging:

```bash
npm run test:e2e:ui
```

### Run with Debugger

Opens browser with DevTools:

```bash
npm run test:e2e:debug
```

### Run Provider Tests Only

```bash
npm run test:e2e:providers
```

### Run with Local Providers Only

For testing with Ollama, LMStudio, etc.:

```bash
npm run test:e2e:local
```

### Run Specific Test File

```bash
npx playwright test e2e/tests/connection.spec.ts --config=e2e/playwright.config.ts
```

### Run Tests Matching Pattern

```bash
npx playwright test --grep "should connect" --config=e2e/playwright.config.ts
```

---

## Test Suite Structure

```
e2e/
├── playwright.config.ts      # Playwright configuration
├── global-setup.ts           # Pre-test environment setup
├── fixtures/                 # Test media files
│   ├── test-audio.wav        # Fake microphone input (48kHz stereo WAV)
│   ├── test-video.y4m        # Fake camera input (YUV420p Y4M)
│   ├── test-image.jpg        # Test image for vision
│   ├── expected-responses/   # Expected outputs for validation
│   └── README.md             # Fixture creation instructions
├── utils/                    # Test utilities
│   ├── index.ts              # Barrel export
│   ├── test-backend.ts       # Backend process management
│   ├── service-checks.ts     # Local service health checks
│   └── wait-helpers.ts       # Event waiting utilities
└── tests/                    # Test files
    ├── connection.spec.ts    # WebRTC connection tests
    ├── audio-flow.spec.ts    # Full conversation flow tests
    └── providers/            # Provider-specific tests
        ├── openai.spec.ts    # OpenAI (LLM, Whisper, TTS)
        ├── elevenlabs.spec.ts # ElevenLabs TTS
        ├── ollama.spec.ts    # Ollama local LLM
        └── lmstudio.spec.ts  # LMStudio local LLM
```

### Test Categories

#### Connection Tests (`connection.spec.ts`)

Tests WebRTC connection establishment:

- Initial disconnected state
- Successful connection to backend
- Connection state management
- Media button enablement
- Connection timeout handling
- Auto-granted media permissions

#### Audio Flow Tests (`audio-flow.spec.ts`)

Tests the complete voice conversation pipeline:

- Audio sharing with fake microphone
- Transcript generation (STT)
- LLM response generation
- TTS audio playback
- Media control toggling
- Event verification

#### Provider Tests (`tests/providers/`)

Integration tests for specific AI providers:

- **OpenAI** - Whisper transcription, GPT completion
- **ElevenLabs** - TTS audio generation
- **Ollama** - Local LLM streaming
- **LMStudio** - OpenAI-compatible local LLM

---

## Fake Media Strategy

### How It Works

Playwright launches Chromium with special flags that:

1. **Auto-grant permissions** - No permission prompts for microphone/camera
2. **Use fake devices** - Virtual camera and microphone instead of hardware
3. **Inject pre-recorded files** - Play WAV/Y4M files as live media streams

### Chrome Flags Used

```typescript
// In playwright.config.ts
launchOptions: {
  args: [
    '--use-fake-ui-for-media-stream',      // Auto-grant permissions
    '--use-fake-device-for-media-stream',  // Use fake devices
    '--use-file-for-fake-audio-capture=./e2e/fixtures/test-audio.wav',
    '--use-file-for-fake-video-capture=./e2e/fixtures/test-video.y4m'
  ]
}
```

### Media File Requirements

| File | Format | Specifications |
|------|--------|----------------|
| `test-audio.wav` | WAV | 48kHz, stereo, 16-bit PCM |
| `test-video.y4m` | Y4M | YUV420p pixel format |

### Limitations

- **Chromium only** - Firefox and WebKit don't support fake media injection
- **No screen capture** - `--use-fake-ui-for-media-stream` doesn't work for `getDisplayMedia()`
- **Audio loops** - By default audio repeats; use `%noloop` suffix to prevent

---

## Environment Variables

### `.env.test` Configuration

```bash
# =============================================================================
# Cloud Provider API Keys
# Tests will be skipped if the corresponding key is not set
# =============================================================================

OPENAI_API_KEY=sk-...              # OpenAI LLM, Whisper STT
ELEVENLABS_API_KEY=xi-...          # ElevenLabs TTS
ANTHROPIC_API_KEY=sk-ant-...       # Anthropic Claude
GOOGLE_API_KEY=AIza...             # Google Gemini
OPENROUTER_API_KEY=sk-or-...       # OpenRouter gateway

# AWS Bedrock (uses IAM credentials)
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1

# =============================================================================
# Local Services
# =============================================================================

OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2

LMSTUDIO_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=local-model

FASTER_WHISPER_URL=http://localhost:8000
PIPER_URL=http://localhost:5000

# =============================================================================
# Test Configuration
# =============================================================================

TEST_BACKEND_PORT=8788
TEST_BACKEND_HOST=127.0.0.1
TEST_FRONTEND_URL=http://localhost:5173

# Set to 'true' to only test with local providers
LOCAL_ONLY=false
```

---

## Writing New Tests

### Basic Test Structure

```typescript
import { test, expect } from '@playwright/test';

test.describe('My Feature', () => {
  // Setup before each test
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).llmrtcClient !== undefined);

    // Connect to backend
    await page.click('[data-testid="connect-btn"]');
    await expect(page.locator('[data-testid="connect-btn"]')).toHaveText('Connected', {
      timeout: 15000,
    });
  });

  test('should do something', async ({ page }) => {
    // Your test logic here
    await page.click('[data-testid="share-audio-btn"]');

    // Wait for expected outcome
    await expect(page.locator('[data-testid="transcript"]')).not.toBeEmpty({
      timeout: 30000,
    });
  });
});
```

### Using Wait Helpers

```typescript
import { waitForTranscript, waitForLLMResponse } from '../utils/wait-helpers.js';

test('should receive full response', async ({ page }) => {
  await page.click('[data-testid="share-audio-btn"]');

  // Wait for transcript
  const transcript = await waitForTranscript(page, 60000);
  expect(transcript.length).toBeGreaterThan(0);

  // Wait for LLM response
  const response = await waitForLLMResponse(page, 90000);
  expect(response.length).toBeGreaterThan(10);
});
```

### Tracking Client Events

```typescript
test('should fire events in order', async ({ page }) => {
  // Set up event tracking
  await page.evaluate(() => {
    (window as any).__events = [];
    const client = (window as any).llmrtcClient;
    ['transcript', 'llmChunk', 'llm', 'ttsStart'].forEach(event => {
      client.on(event, () => (window as any).__events.push(event));
    });
  });

  // Trigger the flow
  await page.click('[data-testid="share-audio-btn"]');

  // Wait for completion
  await page.waitForTimeout(30000);

  // Verify events
  const events = await page.evaluate(() => (window as any).__events);
  expect(events).toContain('transcript');
  expect(events).toContain('llm');
});
```

### Skipping Tests Conditionally

```typescript
test.describe('OpenAI Tests', () => {
  // Skip entire suite if API key not set
  test.skip(!process.env.OPENAI_API_KEY, 'OPENAI_API_KEY not set');

  test('uses OpenAI', async ({ page }) => {
    // This test only runs if OPENAI_API_KEY is set
  });
});

test('individual skip', async ({ page }) => {
  test.skip(!process.env.ELEVENLABS_API_KEY, 'Requires ElevenLabs');
  // ...
});
```

### Available Test IDs

The demo app exposes these `data-testid` attributes:

| Test ID | Element | Purpose |
|---------|---------|---------|
| `signal-url-input` | Input | WebSocket URL input |
| `connect-btn` | Button | Connect/disconnect button |
| `connection-status` | Div | Connection status indicator |
| `share-audio-btn` | Button | Audio sharing toggle |
| `share-video-btn` | Button | Video sharing toggle |
| `share-screen-btn` | Button | Screen sharing toggle |
| `transcript` | Div | STT transcript display |
| `llm-response` | Div | LLM response display |
| `tts-status` | Span | TTS playback indicator |

---

## Provider Tests

### Test Structure

Each provider test file follows this pattern:

```typescript
test.describe('Provider Name', () => {
  // Skip if required API key not set
  test.skip(!process.env.PROVIDER_API_KEY, 'PROVIDER_API_KEY not set');

  test.beforeEach(async ({ page }) => {
    // Standard setup...
  });

  test('basic functionality', async ({ page }) => {
    // Test provider-specific behavior
  });

  test('streaming works', async ({ page }) => {
    // Test streaming responses
  });
});
```

### Running Provider Tests

```bash
# Run all provider tests
npm run test:e2e:providers

# Run specific provider
npx playwright test e2e/tests/providers/openai.spec.ts --config=e2e/playwright.config.ts
```

---

## Local Provider Testing

### Setting Up Ollama

```bash
# Install Ollama (macOS)
brew install ollama

# Start Ollama server
ollama serve

# Pull a model
ollama pull llama3.2

# Verify it's running
curl http://localhost:11434/api/tags
```

### Setting Up LMStudio

1. Download from https://lmstudio.ai/
2. Launch the application
3. Download a model (e.g., Llama 3.2)
4. Start the local server (default port 1234)
5. Verify: `curl http://localhost:1234/v1/models`

### Running Local-Only Tests

```bash
# Set LOCAL_ONLY mode and run
LOCAL_ONLY=true npm run test:e2e

# Or use the convenience script
npm run test:e2e:local
```

### Service Health Checks

The test suite automatically checks if local services are available:

```typescript
import { checkOllama, checkLMStudio } from '../utils/service-checks.js';

const ollamaStatus = await checkOllama();
console.log('Ollama available:', ollamaStatus.available);
console.log('Available models:', ollamaStatus.models);
```

---

## Troubleshooting

### Tests Fail to Start

**Symptom:** Tests hang at startup

**Solutions:**
1. Ensure backend is running: `npm run dev:backend`
2. Check if port 5173 is available (frontend dev server)
3. Verify Chromium is installed: `npx playwright install chromium`

### No Transcript Received

**Symptom:** Audio is shared but no transcript appears

**Solutions:**
1. Check test audio file exists and is valid:
   ```bash
   ffprobe e2e/fixtures/test-audio.wav
   ```
2. Ensure audio has clear speech (VAD needs to detect it)
3. Verify STT provider is configured (OPENAI_API_KEY or LOCAL_ONLY)
4. Check backend logs for STT errors

### Connection Fails

**Symptom:** "Connected" never appears

**Solutions:**
1. Backend must be running on the correct port
2. Check WebSocket URL in the app (default: ws://localhost:8787)
3. Look for CORS or network errors in browser console

### Fake Media Not Working

**Symptom:** "Permission denied" or no audio/video

**Solutions:**
1. Only Chromium is supported (not Firefox/WebKit)
2. Verify fixture files exist at the correct paths
3. Check file permissions
4. Ensure Chrome flags are correct in playwright.config.ts

### Tests Time Out

**Symptom:** Tests exceed timeout waiting for responses

**Solutions:**
1. Increase timeout in test: `{ timeout: 120000 }`
2. Local LLMs may be slower - use longer timeouts
3. Check network connectivity to cloud providers
4. Verify API keys are valid and have credits

### Debug Mode

Run tests with full debugging:

```bash
# With browser visible and DevTools open
npm run test:e2e:debug

# With Playwright inspector
PWDEBUG=1 npm run test:e2e

# With verbose logging
DEBUG=pw:api npm run test:e2e
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
# .github/workflows/e2e.yml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright
        run: npx playwright install --with-deps chromium

      - name: Build project
        run: npm run build

      - name: Start backend
        run: npm run dev:backend &
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ELEVENLABS_API_KEY: ${{ secrets.ELEVENLABS_API_KEY }}

      - name: Wait for backend
        run: npx wait-on http://localhost:8787/health

      - name: Run E2E tests
        run: npm run test:e2e
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ELEVENLABS_API_KEY: ${{ secrets.ELEVENLABS_API_KEY }}

      - name: Upload test report
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

### Required Secrets

Add these secrets to your GitHub repository:

- `OPENAI_API_KEY` - For STT and LLM tests
- `ELEVENLABS_API_KEY` - For TTS tests
- Additional provider keys as needed

### Test Artifacts

On failure, Playwright generates:

- **HTML Report** - `playwright-report/index.html`
- **Screenshots** - Captured on test failure
- **Videos** - Recorded on first retry
- **Traces** - Detailed execution traces

---

## Quick Reference

### Commands

| Command | Description |
|---------|-------------|
| `npm run test:e2e` | Run all E2E tests |
| `npm run test:e2e:ui` | Run with Playwright UI |
| `npm run test:e2e:debug` | Run with debugger |
| `npm run test:e2e:providers` | Run provider tests only |
| `npm run test:e2e:local` | Run with local providers |

### Key Files

| File | Purpose |
|------|---------|
| `e2e/playwright.config.ts` | Test configuration |
| `e2e/global-setup.ts` | Pre-test setup |
| `.env.test` | Environment variables |
| `.env.test.example` | Environment template |

### Test Timeouts

| Operation | Recommended Timeout |
|-----------|---------------------|
| Connection | 15 seconds |
| Audio sharing | 10 seconds |
| Transcript (cloud) | 60 seconds |
| Transcript (local) | 120 seconds |
| LLM response | 90 seconds |
| TTS playback | 120 seconds |

---

## Contributing

When adding new tests:

1. Follow the existing test structure
2. Use descriptive test names
3. Add appropriate timeouts
4. Skip tests when required dependencies are missing
5. Log useful debug information with `console.log('[test]', ...)`
6. Update this README if adding new features

---

## License

MIT - See project root LICENSE file.
