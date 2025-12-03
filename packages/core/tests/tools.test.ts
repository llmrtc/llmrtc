import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ToolRegistry,
  Tool,
  ToolDefinition,
  ToolCallRequest,
  defineTool,
  validateToolArguments,
} from '../src/tools.js';
import {
  ToolExecutor,
  createToolExecutor,
} from '../src/tool-executor.js';

// =============================================================================
// Test Tools
// =============================================================================

const weatherToolDefinition: ToolDefinition = {
  name: 'get_weather',
  description: 'Get the current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'The city and country',
      },
      unit: {
        type: 'string',
        enum: ['celsius', 'fahrenheit'],
        description: 'Temperature unit',
      },
    },
    required: ['location'],
  },
};

const calculatorToolDefinition: ToolDefinition = {
  name: 'calculate',
  description: 'Perform a calculation',
  parameters: {
    type: 'object',
    properties: {
      a: { type: 'number', description: 'First operand' },
      b: { type: 'number', description: 'Second operand' },
      operation: {
        type: 'string',
        enum: ['add', 'subtract', 'multiply', 'divide'],
      },
    },
    required: ['a', 'b', 'operation'],
  },
  executionPolicy: 'sequential',
};

function createWeatherTool(): Tool<{ location: string; unit?: string }, { temperature: number; conditions: string }> {
  return {
    definition: weatherToolDefinition,
    handler: async (params) => ({
      temperature: params.unit === 'fahrenheit' ? 72 : 22,
      conditions: 'sunny',
    }),
  };
}

function createCalculatorTool(): Tool<{ a: number; b: number; operation: string }, number> {
  return {
    definition: calculatorToolDefinition,
    handler: async (params) => {
      switch (params.operation) {
        case 'add': return params.a + params.b;
        case 'subtract': return params.a - params.b;
        case 'multiply': return params.a * params.b;
        case 'divide': return params.a / params.b;
        default: throw new Error(`Unknown operation: ${params.operation}`);
      }
    },
  };
}

function createSlowTool(delayMs: number): Tool<{ input: string }, string> {
  return {
    definition: {
      name: 'slow_tool',
      description: 'A slow tool for testing',
      parameters: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
      },
    },
    handler: async (params) => {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return `processed: ${params.input}`;
    },
  };
}

function createFailingTool(): Tool<Record<string, never>, never> {
  return {
    definition: {
      name: 'failing_tool',
      description: 'A tool that always fails',
      parameters: { type: 'object', properties: {} },
    },
    handler: async () => {
      throw new Error('Tool execution failed');
    },
  };
}

// =============================================================================
// Tool Registry Tests
// =============================================================================

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register', () => {
    it('should register a tool', () => {
      const tool = createWeatherTool();
      registry.register(tool);

      expect(registry.has('get_weather')).toBe(true);
      expect(registry.size).toBe(1);
    });

    it('should throw on duplicate registration', () => {
      const tool = createWeatherTool();
      registry.register(tool);

      expect(() => registry.register(tool)).toThrow("Tool 'get_weather' is already registered");
    });

    it('should support chaining', () => {
      const weather = createWeatherTool();
      const calculator = createCalculatorTool();

      const result = registry.register(weather).register(calculator);

      expect(result).toBe(registry);
      expect(registry.size).toBe(2);
    });
  });

  describe('registerAll', () => {
    it('should register multiple tools', () => {
      const tools = [createWeatherTool(), createCalculatorTool()];
      registry.registerAll(tools);

      expect(registry.size).toBe(2);
      expect(registry.has('get_weather')).toBe(true);
      expect(registry.has('calculate')).toBe(true);
    });
  });

  describe('unregister', () => {
    it('should remove a registered tool', () => {
      registry.register(createWeatherTool());
      const removed = registry.unregister('get_weather');

      expect(removed).toBe(true);
      expect(registry.has('get_weather')).toBe(false);
    });

    it('should return false for non-existent tool', () => {
      expect(registry.unregister('nonexistent')).toBe(false);
    });
  });

  describe('get', () => {
    it('should return a registered tool', () => {
      const tool = createWeatherTool();
      registry.register(tool);

      const retrieved = registry.get('get_weather');
      expect(retrieved).toBeDefined();
      expect(retrieved?.definition.name).toBe('get_weather');
    });

    it('should return undefined for non-existent tool', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getDefinitions', () => {
    it('should return all definitions when no filter provided', () => {
      registry.register(createWeatherTool());
      registry.register(createCalculatorTool());

      const definitions = registry.getDefinitions();
      expect(definitions.length).toBe(2);
    });

    it('should filter definitions by name', () => {
      registry.register(createWeatherTool());
      registry.register(createCalculatorTool());

      const definitions = registry.getDefinitions(['get_weather']);
      expect(definitions.length).toBe(1);
      expect(definitions[0].name).toBe('get_weather');
    });

    it('should skip non-existent tools in filter', () => {
      registry.register(createWeatherTool());

      const definitions = registry.getDefinitions(['get_weather', 'nonexistent']);
      expect(definitions.length).toBe(1);
    });
  });

  describe('names', () => {
    it('should return all tool names', () => {
      registry.register(createWeatherTool());
      registry.register(createCalculatorTool());

      const names = registry.names();
      expect(names).toContain('get_weather');
      expect(names).toContain('calculate');
    });
  });

  describe('clear', () => {
    it('should remove all tools', () => {
      registry.register(createWeatherTool());
      registry.register(createCalculatorTool());
      registry.clear();

      expect(registry.size).toBe(0);
    });
  });
});

// =============================================================================
// defineTool Helper Tests
// =============================================================================

describe('defineTool', () => {
  it('should create a tool with definition and handler', () => {
    const tool = defineTool<{ name: string }, string>(
      {
        name: 'greet',
        description: 'Greet someone',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      },
      async (params) => `Hello, ${params.name}!`
    );

    expect(tool.definition.name).toBe('greet');
    expect(tool.handler).toBeDefined();
  });
});

// =============================================================================
// validateToolArguments Tests
// =============================================================================

describe('validateToolArguments', () => {
  it('should validate correct arguments', () => {
    const result = validateToolArguments(weatherToolDefinition, {
      location: 'Tokyo, Japan',
      unit: 'celsius',
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect missing required parameters', () => {
    const result = validateToolArguments(weatherToolDefinition, {
      unit: 'celsius',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required parameter: location');
  });

  it('should validate enum values', () => {
    const result = validateToolArguments(weatherToolDefinition, {
      location: 'Tokyo, Japan',
      unit: 'kelvin',
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('must be one of');
  });

  it('should validate parameter types', () => {
    const result = validateToolArguments(calculatorToolDefinition, {
      a: 'not a number',
      b: 5,
      operation: 'add',
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('must be of type number');
  });

  it('should reject unknown parameters with additionalProperties: false', () => {
    const strictDefinition: ToolDefinition = {
      ...weatherToolDefinition,
      parameters: {
        ...weatherToolDefinition.parameters,
        additionalProperties: false,
      },
    };

    const result = validateToolArguments(strictDefinition, {
      location: 'Tokyo',
      unknownParam: 'value',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Unknown parameter: unknownParam');
  });
});

// =============================================================================
// Tool Executor Tests
// =============================================================================

describe('ToolExecutor', () => {
  let registry: ToolRegistry;
  let executor: ToolExecutor;

  beforeEach(() => {
    registry = new ToolRegistry();
    registry.register(createWeatherTool());
    registry.register(createCalculatorTool());
    executor = new ToolExecutor(registry);
  });

  describe('executeSingle', () => {
    it('should execute a tool successfully', async () => {
      const call: ToolCallRequest = {
        callId: 'call-1',
        name: 'get_weather',
        arguments: { location: 'Tokyo, Japan' },
      };

      const result = await executor.executeSingle(call, {});

      expect(result.success).toBe(true);
      expect(result.toolName).toBe('get_weather');
      expect(result.callId).toBe('call-1');
      expect(result.result).toEqual({ temperature: 22, conditions: 'sunny' });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should return error for non-existent tool', async () => {
      const call: ToolCallRequest = {
        callId: 'call-1',
        name: 'nonexistent',
        arguments: {},
      };

      const result = await executor.executeSingle(call, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle tool execution errors', async () => {
      registry.register(createFailingTool());

      const call: ToolCallRequest = {
        callId: 'call-1',
        name: 'failing_tool',
        arguments: {},
      };

      const result = await executor.executeSingle(call, {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tool execution failed');
    });
  });

  describe('execute batch', () => {
    it('should execute multiple tools', async () => {
      const calls: ToolCallRequest[] = [
        { callId: 'call-1', name: 'get_weather', arguments: { location: 'Tokyo' } },
        { callId: 'call-2', name: 'calculate', arguments: { a: 5, b: 3, operation: 'add' } },
      ];

      const results = await executor.execute(calls, {});

      expect(results.length).toBe(2);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should return empty array for empty calls', async () => {
      const results = await executor.execute([], {});
      expect(results).toHaveLength(0);
    });

    it('should respect tool execution policy', async () => {
      // calculator has executionPolicy: 'sequential'
      // weather has default policy (parallel)
      const executionOrder: string[] = [];

      const trackingRegistry = new ToolRegistry();
      trackingRegistry.register({
        ...createWeatherTool(),
        handler: async (params) => {
          executionOrder.push('weather-start');
          await new Promise(resolve => setTimeout(resolve, 10));
          executionOrder.push('weather-end');
          return { temperature: 22, conditions: 'sunny' };
        },
      });
      trackingRegistry.register({
        ...createCalculatorTool(),
        handler: async (params) => {
          executionOrder.push('calculator-start');
          await new Promise(resolve => setTimeout(resolve, 5));
          executionOrder.push('calculator-end');
          return params.a + params.b;
        },
      });

      const trackingExecutor = new ToolExecutor(trackingRegistry);
      const calls: ToolCallRequest[] = [
        { callId: 'call-1', name: 'calculate', arguments: { a: 1, b: 2, operation: 'add' } },
        { callId: 'call-2', name: 'get_weather', arguments: { location: 'Tokyo' } },
      ];

      await trackingExecutor.execute(calls, {});

      // Sequential tool (calculator) runs first, then parallel (weather)
      expect(executionOrder[0]).toBe('calculator-start');
      expect(executionOrder[1]).toBe('calculator-end');
    });
  });

  describe('callbacks', () => {
    it('should call onToolStart and onToolEnd', async () => {
      const startCalls: string[] = [];
      const endCalls: string[] = [];

      const callbackExecutor = new ToolExecutor(registry, {
        onToolStart: (name) => startCalls.push(name),
        onToolEnd: (result) => endCalls.push(result.toolName),
      });

      await callbackExecutor.executeSingle(
        { callId: 'call-1', name: 'get_weather', arguments: { location: 'Tokyo' } },
        {}
      );

      expect(startCalls).toContain('get_weather');
      expect(endCalls).toContain('get_weather');
    });

    it('should call onToolError on failure', async () => {
      registry.register(createFailingTool());
      const errors: string[] = [];

      const callbackExecutor = new ToolExecutor(registry, {
        onToolError: (name) => errors.push(name),
      });

      await callbackExecutor.executeSingle(
        { callId: 'call-1', name: 'failing_tool', arguments: {} },
        {}
      );

      expect(errors).toContain('failing_tool');
    });
  });

  describe('timeout', () => {
    it('should timeout slow tools', async () => {
      registry.register(createSlowTool(500));

      const timeoutExecutor = new ToolExecutor(registry, { timeout: 100 });

      const result = await timeoutExecutor.executeSingle(
        { callId: 'call-1', name: 'slow_tool', arguments: { input: 'test' } },
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });
  });

  describe('abort signal', () => {
    it('should respect abort signal', async () => {
      registry.register(createSlowTool(200));

      const controller = new AbortController();

      // Abort after a short delay
      setTimeout(() => controller.abort(), 50);

      const result = await executor.executeSingle(
        { callId: 'call-1', name: 'slow_tool', arguments: { input: 'test' } },
        { abortSignal: controller.signal }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('aborted');
    });
  });
});

// =============================================================================
// createToolExecutor Helper Tests
// =============================================================================

describe('createToolExecutor', () => {
  it('should create executor with tools', async () => {
    const executor = createToolExecutor([createWeatherTool()]);

    const result = await executor.executeSingle(
      { callId: 'call-1', name: 'get_weather', arguments: { location: 'Tokyo' } },
      {}
    );

    expect(result.success).toBe(true);
  });
});

// =============================================================================
// Tool Argument Validation (Opt-in) Tests
// =============================================================================

describe('ToolExecutor with validateArguments', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registry.register(createWeatherTool());
    registry.register(createCalculatorTool());
  });

  it('should not validate arguments by default', async () => {
    const executor = new ToolExecutor(registry);

    // Missing required 'location' - should still execute (validation off)
    const result = await executor.executeSingle(
      { callId: 'call-1', name: 'get_weather', arguments: { unit: 'celsius' } },
      {}
    );

    // Tool executes but may produce unexpected results
    expect(result.success).toBe(true);
  });

  it('should reject missing required parameters when validation enabled', async () => {
    const executor = new ToolExecutor(registry, { validateArguments: true });

    const result = await executor.executeSingle(
      { callId: 'call-1', name: 'get_weather', arguments: { unit: 'celsius' } },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments');
    expect(result.error).toContain('Missing required parameter: location');
  });

  it('should reject invalid enum values when validation enabled', async () => {
    const executor = new ToolExecutor(registry, { validateArguments: true });

    const result = await executor.executeSingle(
      { callId: 'call-1', name: 'get_weather', arguments: { location: 'Tokyo', unit: 'kelvin' } },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments');
    expect(result.error).toContain('must be one of');
  });

  it('should reject invalid types when validation enabled', async () => {
    const executor = new ToolExecutor(registry, { validateArguments: true });

    const result = await executor.executeSingle(
      { callId: 'call-1', name: 'calculate', arguments: { a: 'not-a-number', b: 5, operation: 'add' } },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments');
    expect(result.error).toContain('must be of type number');
  });

  it('should allow valid arguments when validation enabled', async () => {
    const executor = new ToolExecutor(registry, { validateArguments: true });

    const result = await executor.executeSingle(
      { callId: 'call-1', name: 'get_weather', arguments: { location: 'Tokyo, Japan', unit: 'celsius' } },
      {}
    );

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ temperature: 22, conditions: 'sunny' });
  });

  it('should call onToolError callback for validation failures', async () => {
    const errors: Array<{ name: string; error: Error }> = [];

    const executor = new ToolExecutor(registry, {
      validateArguments: true,
      onToolError: (name, callId, error) => errors.push({ name, error }),
    });

    await executor.executeSingle(
      { callId: 'call-1', name: 'get_weather', arguments: {} },
      {}
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].name).toBe('get_weather');
    expect(errors[0].error.message).toContain('Invalid arguments');
  });
});
