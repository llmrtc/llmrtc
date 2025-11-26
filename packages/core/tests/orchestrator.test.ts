import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationOrchestrator, LLMProvider, STTProvider, TTSProvider, LLMRequest } from '../src/index.js';

class StubLLM implements LLMProvider {
  name = 'stub-llm';
  lastRequest: LLMRequest | null = null;
  async complete(req: LLMRequest) {
    this.lastRequest = req;
    return { fullText: `ECHO: ${req.messages.at(-1)?.content ?? ''}` };
  }
}

class StubSTT implements STTProvider {
  name = 'stub-stt';
  async transcribe(_audio: Buffer) {
    return { text: 'hello world', isFinal: true };
  }
}

class StubTTS implements TTSProvider {
  name = 'stub-tts';
  async speak(text: string) {
    return { audio: Buffer.from(`tts:${text}`), format: 'mp3' as const };
  }
}

describe('ConversationOrchestrator', () => {
  let llm: StubLLM;
  let stt: StubSTT;
  let tts: StubTTS;
  let orchestrator: ConversationOrchestrator;

  beforeEach(() => {
    llm = new StubLLM();
    stt = new StubSTT();
    tts = new StubTTS();
    orchestrator = new ConversationOrchestrator({
      systemPrompt: 'You are helpful',
      historyLimit: 4,
      providers: { llm, stt, tts }
    });
  });

  it('runs a full turn and returns transcript, llm, tts', async () => {
    const { transcript, llm: llmRes, tts: ttsRes } = await orchestrator.runTurn(Buffer.from('audio'));
    expect(transcript.text).toBe('hello world');
    expect(llmRes.fullText).toBe('ECHO: hello world');
    expect(ttsRes.audio.toString()).toBe('tts:ECHO: hello world');
  });

  it('maintains isolated history per orchestrator and includes system prompt once', async () => {
    await orchestrator.runTurn(Buffer.from('first'));
    await orchestrator.runTurn(Buffer.from('second'));
    const roles = llm.lastRequest?.messages.map((m) => m.role) ?? [];
    expect(roles[0]).toBe('system');
    expect(roles).toContain('assistant');
    expect(roles.at(-1)).toBe('user');
  });
});
