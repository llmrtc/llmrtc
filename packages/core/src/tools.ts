/**
 * Tool Types and Registry for LLM Tool Calling
 *
 * Provides provider-agnostic tool definitions that can be adapted
 * to any LLM provider's tool calling format.
 */

// =============================================================================
// JSON Schema Types for Tool Parameters
// =============================================================================

/**
 * JSON Schema property definition for tool parameters
 */
export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';
  description?: string;
  enum?: (string | number | boolean | null)[];
  default?: unknown;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
}

/**
 * JSON Schema definition for tool parameters
 * Follows JSON Schema draft-07 subset supported by most LLM providers
 */
export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

// =============================================================================
// Tool Definition Types
// =============================================================================

/**
 * Provider-agnostic tool definition
 * Can be converted to any LLM provider's format
 */
export interface ToolDefinition {
  /** Unique name for the tool (used in function calls) */
  name: string;
  /** Human-readable description for the LLM */
  description: string;
  /** JSON Schema describing the parameters */
  parameters: ToolParameterSchema;
  /** Execution policy when multiple calls to this tool occur (default: 'parallel') */
  executionPolicy?: 'sequential' | 'parallel';
}

/**
 * Context provided to tool handlers during execution
 */
export interface ToolExecutionContext {
  /** Unique identifier for this tool call */
  callId: string;
  /** Current session ID */
  sessionId?: string;
  /** Current turn ID */
  turnId?: string;
  /** Signal to check if execution should be aborted */
  abortSignal?: AbortSignal;
  /** Additional metadata from the orchestrator */
  metadata?: Record<string, unknown>;
}

/**
 * Function signature for tool handlers
 * @template TParams - Type of the parsed parameters
 * @template TResult - Type of the result
 */
export type ToolHandler<TParams = Record<string, unknown>, TResult = unknown> = (
  params: TParams,
  context: ToolExecutionContext
) => Promise<TResult>;

/**
 * Complete tool with definition and handler
 * @template TParams - Type of the parsed parameters
 * @template TResult - Type of the result
 */
export interface Tool<TParams = Record<string, unknown>, TResult = unknown> {
  definition: ToolDefinition;
  handler: ToolHandler<TParams, TResult>;
}

// =============================================================================
// Tool Call Types (Request/Response)
// =============================================================================

/**
 * A tool call request from the LLM
 * Normalized from provider-specific formats
 */
export interface ToolCallRequest {
  /** Provider-specific call ID for correlating results */
  callId: string;
  /** Name of the tool to invoke */
  name: string;
  /** Parsed arguments from the LLM */
  arguments: Record<string, unknown>;
}

/**
 * Result of a tool execution
 */
export interface ToolCallResult {
  /** Name of the tool that was called */
  toolName: string;
  /** Call ID for correlation with request */
  callId: string;
  /** Result data (will be serialized to JSON for LLM) */
  result: unknown;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Whether execution succeeded */
  success: boolean;
  /** Error message if execution failed */
  error?: string;
}

/**
 * Tool choice options for LLM requests
 * - 'auto': LLM decides whether to use tools
 * - 'none': Disable tool use
 * - 'required': LLM must use at least one tool
 * - { name: string }: Force use of a specific tool
 */
export type ToolChoice = 'auto' | 'none' | 'required' | { name: string };

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * Registry for managing tool definitions and handlers
 * Provides lookup by name and bulk operations
 */
export class ToolRegistry {
  private tools = new Map<string, Tool<unknown, unknown>>();

  /**
   * Register a tool with its handler
   * @throws Error if a tool with the same name is already registered
   */
  register<TParams = Record<string, unknown>, TResult = unknown>(
    tool: Tool<TParams, TResult>
  ): this {
    const name = tool.definition.name;
    if (this.tools.has(name)) {
      throw new Error(`Tool '${name}' is already registered`);
    }
    this.tools.set(name, tool as Tool<unknown, unknown>);
    return this;
  }

  /**
   * Register multiple tools at once
   * @throws Error if any tool name conflicts
   */
  registerAll(tools: Tool<unknown, unknown>[]): this {
    for (const tool of tools) {
      this.register(tool);
    }
    return this;
  }

  /**
   * Unregister a tool by name
   * @returns true if the tool was found and removed
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Get a tool by name
   * @returns The tool or undefined if not found
   */
  get<TParams = Record<string, unknown>, TResult = unknown>(
    name: string
  ): Tool<TParams, TResult> | undefined {
    return this.tools.get(name) as Tool<TParams, TResult> | undefined;
  }

  /**
   * Check if a tool is registered
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all registered tool names
   */
  names(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get tool definitions for a subset of tools
   * Useful for providing stage-specific tool lists
   * @param names - Optional filter; if omitted, returns all definitions
   */
  getDefinitions(names?: string[]): ToolDefinition[] {
    if (names) {
      return names
        .map(name => this.tools.get(name)?.definition)
        .filter((def): def is ToolDefinition => def !== undefined);
    }
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /**
   * Get all registered tools
   */
  getAll(): Tool<unknown, unknown>[] {
    return Array.from(this.tools.values());
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Number of registered tools
   */
  get size(): number {
    return this.tools.size;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a tool definition with a handler
 * Type-safe helper for defining tools
 */
export function defineTool<TParams = Record<string, unknown>, TResult = unknown>(
  definition: ToolDefinition,
  handler: ToolHandler<TParams, TResult>
): Tool<TParams, TResult> {
  return { definition, handler };
}

/**
 * Validate that arguments match a tool's parameter schema.
 * Covers the JSONSchemaProperty subset this package can express: type,
 * required, enum, nested properties, array items, numeric ranges, string
 * length, and pattern.
 */
export function validateToolArguments(
  definition: ToolDefinition,
  args: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  validateObjectValue(
    args,
    definition.parameters.properties,
    definition.parameters.required ?? [],
    definition.parameters.additionalProperties,
    '',
    errors
  );
  return { valid: errors.length === 0, errors };
}

function describePath(path: string, name: string): string {
  return path ? `${path}.${name}` : name;
}

function validateObjectValue(
  value: Record<string, unknown>,
  properties: Record<string, JSONSchemaProperty>,
  required: string[],
  additionalProperties: boolean | undefined,
  path: string,
  errors: string[]
): void {
  for (const name of required) {
    if (!(name in value)) {
      errors.push(`Missing required parameter: ${describePath(path, name)}`);
    }
  }

  for (const [name, propValue] of Object.entries(value)) {
    const schema = properties[name];
    if (!schema) {
      if (additionalProperties === false) {
        errors.push(`Unknown parameter: ${describePath(path, name)}`);
      }
      continue;
    }
    validateValue(propValue, schema, describePath(path, name), errors);
  }
}

function validateValue(
  value: unknown,
  schema: JSONSchemaProperty,
  path: string,
  errors: string[]
): void {
  if (value === null) {
    if (schema.type !== 'null') {
      errors.push(`Parameter '${path}' cannot be null`);
    }
    return;
  }

  const valueType = Array.isArray(value) ? 'array' : typeof value;

  if (schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      errors.push(`Parameter '${path}' must be an integer`);
      return;
    }
  } else if (schema.type === 'null') {
    errors.push(`Parameter '${path}' must be null`);
    return;
  } else if (valueType !== schema.type) {
    errors.push(`Parameter '${path}' must be of type ${schema.type}, got ${valueType}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(value as string | number | boolean | null)) {
    errors.push(`Parameter '${path}' must be one of: ${schema.enum.join(', ')}`);
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`Parameter '${path}' must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`Parameter '${path}' must be <= ${schema.maximum}`);
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`Parameter '${path}' must have length >= ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`Parameter '${path}' must have length <= ${schema.maxLength}`);
    }
    if (schema.pattern !== undefined) {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          errors.push(`Parameter '${path}' must match pattern ${schema.pattern}`);
        }
      } catch {
        // Invalid pattern in the schema itself - don't fail the arguments
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      validateValue(item, schema.items!, `${path}[${index}]`, errors);
    });
  }

  if (valueType === 'object' && schema.properties) {
    validateObjectValue(
      value as Record<string, unknown>,
      schema.properties,
      schema.required ?? [],
      undefined,
      path,
      errors
    );
  }
}
