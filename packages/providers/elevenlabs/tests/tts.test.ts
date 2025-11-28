import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { ElevenLabsTTSProvider } from '../src/index.js';
import {
  createMockFetchResponse,
  createTestAudioBuffer,
  createMockStream
} from '../../test-utils.js';

// Mock node-fetch
vi.mock('node-fetch', () => ({
  default: vi.fn()
}));

import fetch from 'node-fetch';

describe('ElevenLabsTTSProvider', () => {
  let provider: ElevenLabsTTSProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    provider = new ElevenLabsTTSProvider({
      apiKey: 'test-api-key',
      voiceId: 'test-voice-id',
      modelId: 'eleven_flash_v2_5'
    });
  });

  describe('constructor', () => {
    it('should use default voice ID (21m00Tcm4TlvDq8ikWAM) when not specified', async () => {
      const defaultProvider = new ElevenLabsTTSProvider({
        apiKey: 'test-key'
      });
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await defaultProvider.speak('Test');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/21m00Tcm4TlvDq8ikWAM'),
        expect.any(Object)
      );
    });

    it('should use custom voice ID when specified', async () => {
      const customProvider = new ElevenLabsTTSProvider({
        apiKey: 'test-key',
        voiceId: 'custom-voice-123'
      });
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await customProvider.speak('Test');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/custom-voice-123'),
        expect.any(Object)
      );
    });

    it('should use default model (eleven_multilingual_v2) when not specified', async () => {
      const defaultProvider = new ElevenLabsTTSProvider({
        apiKey: 'test-key'
      });
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await defaultProvider.speak('Test');

      const call = (fetch as unknown as Mock).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.model_id).toBe('eleven_multilingual_v2');
    });

    it('should use custom model when specified', async () => {
      const customProvider = new ElevenLabsTTSProvider({
        apiKey: 'test-key',
        modelId: 'eleven_flash_v2_5'
      });
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await customProvider.speak('Test');

      const call = (fetch as unknown as Mock).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.model_id).toBe('eleven_flash_v2_5');
    });

    it('should use default format (mp3) when not specified', async () => {
      const defaultProvider = new ElevenLabsTTSProvider({
        apiKey: 'test-key'
      });
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      const result = await defaultProvider.speak('Test');

      expect(result.format).toBe('mp3');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('output_format=mp3_44100_128'),
        expect.any(Object)
      );
    });
  });

  describe('edge cases', () => {
    it('should handle empty text input', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('');

      const call = (fetch as unknown as Mock).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.text).toBe('');
    });

    it('should handle single character input', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('a');

      const call = (fetch as unknown as Mock).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.text).toBe('a');
    });

    it('should handle unicode and emoji text', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      const unicodeText = '你好世界 🌍 مرحبا';
      await provider.speak(unicodeText);

      const call = (fetch as unknown as Mock).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.text).toBe(unicodeText);
    });
  });

  describe('speak()', () => {
    it('should return audio buffer', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue(
        createMockFetchResponse({ buffer: audioBuffer, ok: true })
      );

      // Override with proper buffer response
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      const result = await provider.speak('Hello, world!');

      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.audio.length).toBeGreaterThan(0);
    });

    it('should return format', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      const result = await provider.speak('Test');

      expect(result.format).toBeDefined();
    });

    it('should call correct endpoint', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('Test');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.elevenlabs.io/v1/text-to-speech/test-voice-id'),
        expect.any(Object)
      );
    });

    it('should include output_format as query parameter', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('Test');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('output_format='),
        expect.any(Object)
      );
    });

    it('should pass API key in header', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('Test');

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'xi-api-key': 'test-api-key'
          })
        })
      );
    });

    it('should pass text in body', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('Hello, world!');

      const call = (fetch as unknown as Mock).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.text).toBe('Hello, world!');
    });

    it('should pass model_id in body', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('Test');

      const call = (fetch as unknown as Mock).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.model_id).toBe('eleven_flash_v2_5');
    });

    it('should include voice_settings in body', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('Test');

      const call = (fetch as unknown as Mock).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.voice_settings).toBeDefined();
      expect(body.voice_settings.stability).toBeDefined();
      expect(body.voice_settings.similarity_boost).toBeDefined();
    });

    it('should override voice with config', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('Test', { voice: 'custom-voice-id' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/custom-voice-id'),
        expect.any(Object)
      );
    });

    it('should map mp3 format correctly', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('Test', { format: 'mp3' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('output_format=mp3_44100_128'),
        expect.any(Object)
      );
    });

    it('should map ogg format correctly', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('Test', { format: 'ogg' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('output_format=ogg_44100'),
        expect.any(Object)
      );
    });

    it('should map pcm format to 24kHz', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('Test', { format: 'pcm' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('output_format=pcm_24000'),
        expect.any(Object)
      );
    });

    it('should map wav format to pcm_24000', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('Test', { format: 'wav' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('output_format=pcm_24000'),
        expect.any(Object)
      );
    });

    it('should throw on API error', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized')
      });

      await expect(provider.speak('Test')).rejects.toThrow('401');
    });

    it('should include error text in thrown error', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Invalid voice ID')
      });

      await expect(provider.speak('Test')).rejects.toThrow('Invalid voice ID');
    });

    it('should handle rate limit errors (429)', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limit exceeded')
      });

      await expect(provider.speak('Test')).rejects.toThrow('429');
    });

    it('should handle server errors (500)', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error')
      });

      await expect(provider.speak('Test')).rejects.toThrow('500');
    });
  });

  describe('speakStream()', () => {
    it('should yield audio chunks', async () => {
      const chunk1 = Buffer.from('chunk1');
      const chunk2 = Buffer.from('chunk2');
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        body: createMockStream([chunk1, chunk2])
      });

      const chunks: Buffer[] = [];
      for await (const chunk of provider.speakStream('Test')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
    });

    it('should call stream endpoint', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        body: createMockStream([audioBuffer])
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.speakStream('Test')) {
        // consume stream
      }

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/stream'),
        expect.any(Object)
      );
    });

    it('should include output_format in stream endpoint', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        body: createMockStream([audioBuffer])
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.speakStream('Test', { format: 'pcm' })) {
        // consume stream
      }

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('output_format=pcm_24000'),
        expect.any(Object)
      );
    });

    it('should override voice in streaming', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        body: createMockStream([audioBuffer])
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.speakStream('Test', { voice: 'other-voice' })) {
        // consume stream
      }

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/other-voice/stream'),
        expect.any(Object)
      );
    });

    it('should throw on stream API error', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized')
      });

      await expect(async () => {
        for await (const _ of provider.speakStream('Test')) {
          // consume stream
        }
      }).rejects.toThrow('401');
    });

    it('should throw when no response body', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        body: null
      });

      await expect(async () => {
        for await (const _ of provider.speakStream('Test')) {
          // consume stream
        }
      }).rejects.toThrow('No response body');
    });

    it('should convert chunks to Buffer', async () => {
      const chunk = Buffer.from('test-audio-data');
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        body: createMockStream([chunk])
      });

      for await (const receivedChunk of provider.speakStream('Test')) {
        expect(Buffer.isBuffer(receivedChunk)).toBe(true);
      }
    });
  });
});
