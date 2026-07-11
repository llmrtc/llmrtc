import { describe, it, expect } from 'vitest';
import {
  ToolExecutor,
  ToolRegistry,
  defineTool,
  validateToolArguments,
  ToolDefinition
} from '../src/index.js';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('ToolExecutor abort and ordering', () => {
  it('does not execute a tool when the signal is already aborted', async () => {
    let executed = false;
    const registry = new ToolRegistry();
    registry.register(
      defineTool(
        { name: 'work', description: 'w', parameters: { type: 'object', properties: {} } },
        async () => {
          executed = true;
          return 'done';
        }
      )
    );
    const executor = new ToolExecutor(registry);

    const controller = new AbortController();
    controller.abort();

    const result = await executor.executeSingle(
      { callId: 'c1', name: 'work', arguments: {} },
      { abortSignal: controller.signal }
    );

    expect(executed).toBe(false);
    expect(result.success).toBe(false);
    expect(result.error).toContain('aborted');
  });

  it('returns parallel results in call order regardless of completion order', async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool(
        {
          name: 'delay',
          description: 'd',
          parameters: {
            type: 'object',
            properties: { ms: { type: 'number' }, label: { type: 'string' } }
          }
        },
        async (params: { ms: number; label: string }) => {
          await sleep(params.ms);
          return params.label;
        }
      )
    );
    const executor = new ToolExecutor(registry, { maxConcurrency: 3 });

    const results = await executor.execute(
      [
        { callId: 'slow', name: 'delay', arguments: { ms: 40, label: 'slow' } },
        { callId: 'medium', name: 'delay', arguments: { ms: 20, label: 'medium' } },
        { callId: 'fast', name: 'delay', arguments: { ms: 1, label: 'fast' } }
      ],
      {}
    );

    expect(results.map(r => r.callId)).toEqual(['slow', 'medium', 'fast']);
    expect(results.map(r => r.result)).toEqual(['slow', 'medium', 'fast']);
  });

  it('stops starting new calls on abort and never mutates returned results', async () => {
    const registry = new ToolRegistry();
    const started: string[] = [];
    const controller = new AbortController();
    registry.register(
      defineTool(
        { name: 'work', description: 'w', parameters: { type: 'object', properties: {} } },
        async (_params, ctx) => {
          started.push(ctx.callId);
          controller.abort();
          await sleep(10);
          return 'ok';
        }
      )
    );
    const executor = new ToolExecutor(registry, { maxConcurrency: 1 });

    const results = await executor.execute(
      [
        { callId: 'c1', name: 'work', arguments: {} },
        { callId: 'c2', name: 'work', arguments: {} },
        { callId: 'c3', name: 'work', arguments: {} }
      ],
      { abortSignal: controller.signal }
    );

    const snapshot = JSON.stringify(results);
    await sleep(30);
    // The returned array does not mutate after execute() resolves
    expect(JSON.stringify(results)).toBe(snapshot);
    // Only the first call was started; the rest were skipped after abort
    expect(started).toEqual(['c1']);
    expect(results.length).toBeLessThan(3);
  });
});

describe('validateToolArguments depth', () => {
  const definition: ToolDefinition = {
    name: 'book_flight',
    description: 'Book a flight',
    parameters: {
      type: 'object',
      properties: {
        passengers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1 },
              age: { type: 'integer', minimum: 0, maximum: 120 }
            },
            required: ['name']
          }
        },
        cabin: { type: 'string', enum: ['economy', 'business'] },
        code: { type: 'string', pattern: '^[A-Z]{3}$' }
      },
      required: ['passengers']
    }
  };

  it('accepts valid nested arguments', () => {
    const result = validateToolArguments(definition, {
      passengers: [{ name: 'Ada', age: 36 }],
      cabin: 'economy',
      code: 'YYZ'
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects nested violations that were previously invisible', () => {
    const result = validateToolArguments(definition, {
      passengers: [{ age: 200 }],
      cabin: 'first',
      code: 'toolong'
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join('; ')).toContain('passengers[0].name');
    expect(result.errors.join('; ')).toContain('passengers[0].age');
    expect(result.errors.join('; ')).toContain('cabin');
    expect(result.errors.join('; ')).toContain('code');
  });

  it('still validates top-level types and required fields', () => {
    const result = validateToolArguments(definition, { passengers: 'not-an-array' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('passengers');
  });
});
