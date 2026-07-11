import { describe, it, expect } from 'vitest';
import {
  PlaybookOrchestrator,
  ToolRegistry,
  defineTool,
  LLMProvider,
  LLMRequest,
  LLMResult,
  Playbook
} from '../src/index.js';

function makePlaybook(overrides: Partial<Playbook> = {}): Playbook {
  return {
    id: 'test',
    name: 'Test',
    stages: [
      { id: 'main', name: 'Main', systemPrompt: 'Main stage.' },
      { id: 'next', name: 'Next', systemPrompt: 'Next stage.' }
    ],
    transitions: [
      {
        id: 'llm-move',
        from: '*',
        condition: { type: 'llm_decision' },
        action: { targetStage: 'next' }
      }
    ],
    initialStage: 'main',
    ...overrides
  };
}

function makeRegistry() {
  const registry = new ToolRegistry();
  registry.register(
    defineTool(
      {
        name: 'lookup',
        description: 'Look something up',
        parameters: { type: 'object', properties: {} }
      },
      async () => ({ found: true })
    )
  );
  return registry;
}

/** LLM whose responses are scripted per call */
class ScriptedLLM implements LLMProvider {
  name = 'scripted-llm';
  script: LLMResult[] = [];
  requests: LLMRequest[] = [];
  delayMs = 0;
  active = 0;
  maxActive = 0;

  async complete(req: LLMRequest): Promise<LLMResult> {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      this.requests.push(req);
      if (this.delayMs) {
        await new Promise(r => setTimeout(r, this.delayMs));
      }
      const next = this.script.shift();
      return next ?? { fullText: 'done', stopReason: 'end_turn' };
    } finally {
      this.active--;
    }
  }
}

describe('PlaybookOrchestrator behavior', () => {
  describe('turn serialization', () => {
    it('never runs two turns concurrently, even with queued callers', async () => {
      const llm = new ScriptedLLM();
      llm.delayMs = 20;
      const orchestrator = new PlaybookOrchestrator(llm, makePlaybook(), makeRegistry());

      await Promise.all([
        orchestrator.executeTurn('one'),
        orchestrator.executeTurn('two'),
        orchestrator.executeTurn('three')
      ]);

      expect(llm.maxActive).toBe(1);

      // History holds all three exchanges in order
      const history = orchestrator.getHistory();
      const userMessages = history.filter(m => m.role === 'user').map(m => m.content);
      expect(userMessages).toEqual(['one', 'two', 'three']);
    });
  });

  describe('transition tool bundled with other calls', () => {
    it('synthesizes results for calls after playbook_transition', async () => {
      const llm = new ScriptedLLM();
      llm.script = [
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [
            {
              callId: 'call-1',
              name: 'playbook_transition',
              arguments: { targetStage: 'next', reason: 'moving on' }
            },
            { callId: 'call-2', name: 'lookup', arguments: {} }
          ]
        },
        { fullText: 'Final answer', stopReason: 'end_turn' }
      ];
      const orchestrator = new PlaybookOrchestrator(llm, makePlaybook(), makeRegistry());

      const result = await orchestrator.executeTurn('go');

      expect(result.transitioned).toBe(true);

      // Every tool call in the assistant message has a matching tool result
      const history = orchestrator.getHistory();
      const assistantWithCalls = history.find(m => m.role === 'assistant' && m.toolCalls?.length);
      expect(assistantWithCalls).toBeDefined();
      const resultIds = history.filter(m => m.role === 'tool').map(m => m.toolCallId);
      for (const call of assistantWithCalls!.toolCalls!) {
        expect(resultIds).toContain(call.callId);
      }

      // The skipped call is reported as not executed
      const skipped = history.find(m => m.role === 'tool' && m.toolCallId === 'call-2');
      expect(skipped!.content).toContain('skipped');
    });
  });

  describe('clearHistory transitions', () => {
    it('clears conversation history and preserves context', async () => {
      const playbook = makePlaybook({
        transitions: [
          {
            id: 'clear-move',
            from: '*',
            condition: { type: 'llm_decision' },
            action: { targetStage: 'next', clearHistory: true }
          }
        ]
      });
      const llm = new ScriptedLLM();
      llm.script = [
        { fullText: 'first answer', stopReason: 'end_turn' },
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [
            {
              callId: 'c1',
              name: 'playbook_transition',
              arguments: { targetStage: 'next', reason: 'reset' }
            }
          ]
        },
        { fullText: 'fresh start', stopReason: 'end_turn' }
      ];
      const orchestrator = new PlaybookOrchestrator(llm, playbook, makeRegistry());
      orchestrator.getEngine().updateContext({ carried: 'yes' });

      await orchestrator.executeTurn('hello');
      expect(orchestrator.getHistory().length).toBeGreaterThan(0);

      const result = await orchestrator.executeTurn('now reset');
      expect(result.transitioned).toBe(true);

      // Pre-transition messages are gone; context survives
      const history = orchestrator.getHistory();
      expect(history.some(m => m.content === 'hello')).toBe(false);
      expect(orchestrator.getEngine().getState().conversationContext.carried).toBe('yes');
    });
  });

  describe('repeated responses', () => {
    it('keeps assistant turns even when the content repeats', async () => {
      const llm = new ScriptedLLM();
      llm.script = [
        { fullText: 'Anything else?', stopReason: 'end_turn' },
        { fullText: 'Anything else?', stopReason: 'end_turn' }
      ];
      const orchestrator = new PlaybookOrchestrator(llm, makePlaybook(), makeRegistry());

      await orchestrator.executeTurn('first');
      await orchestrator.executeTurn('second');

      const assistantMessages = orchestrator
        .getHistory()
        .filter(m => m.role === 'assistant');
      expect(assistantMessages).toHaveLength(2);
    });
  });

  describe('retry classification', () => {
    it('does not retry errors with a 4xx status code', async () => {
      let attempts = 0;
      const llm: LLMProvider = {
        name: 'failing-llm',
        async complete() {
          attempts++;
          const err = new Error('Unprocessable Entity') as Error & { status: number };
          err.status = 422;
          throw err;
        }
      };
      const orchestrator = new PlaybookOrchestrator(llm, makePlaybook(), makeRegistry(), {
        llmRetries: 3
      });

      await expect(orchestrator.executeTurn('hi')).rejects.toThrow('Unprocessable');
      expect(attempts).toBe(1);
    });

    it('retries errors with a 5xx status code', async () => {
      let attempts = 0;
      const llm: LLMProvider = {
        name: 'flaky-llm',
        async complete() {
          attempts++;
          if (attempts < 2) {
            const err = new Error('Server exploded') as Error & { status: number };
            err.status = 500;
            throw err;
          }
          return { fullText: 'recovered', stopReason: 'end_turn' as const };
        }
      };
      const orchestrator = new PlaybookOrchestrator(llm, makePlaybook(), makeRegistry(), {
        llmRetries: 2
      });

      const result = await orchestrator.executeTurn('hi');
      expect(result.response).toBe('recovered');
      expect(attempts).toBe(2);
    }, 10000);
  });

  describe('phase 2 requests', () => {
    it('sends tools with toolChoice none for the final response', async () => {
      const llm = new ScriptedLLM();
      llm.script = [
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [{ callId: 'c1', name: 'lookup', arguments: {} }]
        },
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [
            {
              callId: 'c2',
              name: 'playbook_transition',
              arguments: { targetStage: 'next', reason: 'done' }
            }
          ]
        },
        { fullText: 'Final', stopReason: 'end_turn' }
      ];
      const playbook = makePlaybook();
      playbook.stages[0].tools = [
        {
          name: 'lookup',
          description: 'Look something up',
          parameters: { type: 'object', properties: {} }
        }
      ];
      const orchestrator = new PlaybookOrchestrator(llm, playbook, makeRegistry());

      await orchestrator.executeTurn('go');

      // The last request is phase 2: it must carry tools but forbid their use
      const phase2 = llm.requests[llm.requests.length - 1];
      expect(phase2.tools?.length).toBeGreaterThan(0);
      expect(phase2.toolChoice).toBe('none');
    });
  });

  describe('playbook hooks', () => {
    it('fires stage, transition, and turn hooks', async () => {
      const events: string[] = [];
      const llm = new ScriptedLLM();
      llm.script = [
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [
            {
              callId: 'c1',
              name: 'playbook_transition',
              arguments: { targetStage: 'next', reason: 'move' }
            }
          ]
        },
        { fullText: 'Moved', stopReason: 'end_turn' }
      ];
      const orchestrator = new PlaybookOrchestrator(llm, makePlaybook(), makeRegistry(), {
        hooks: {
          onStageEnter(_ctx, stage) {
            events.push(`enter:${stage.id}`);
          },
          onStageExit(_ctx, stage) {
            events.push(`exit:${stage.id}`);
          },
          onTransition(_ctx, _transition, from, to) {
            events.push(`transition:${from.id}->${to.id}`);
          },
          onPlaybookTurnEnd(_ctx, response, toolCallCount) {
            events.push(`turn-end:${toolCallCount}:${response}`);
          }
        }
      });

      await orchestrator.executeTurn('go');

      expect(events).toContain('exit:main');
      expect(events).toContain('enter:next');
      expect(events).toContain('transition:main->next');
      expect(events.some(e => e.startsWith('turn-end:1:'))).toBe(true);
    });
  });
});
