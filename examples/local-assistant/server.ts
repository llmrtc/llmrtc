/**
 * Local Assistant - Ollama + Local Tools Example
 *
 * Demonstrates VoicePlaybookOrchestrator with:
 * - 100% local processing (Ollama, Faster-Whisper, Piper)
 * - Sandboxed file/command tools
 * - Privacy-focused design
 */

import { config } from 'dotenv';
config();

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

import {
  LLMRTCServer,
  OllamaLLMProvider,
  FasterWhisperProvider,
  PiperTTSProvider
} from '@metered/llmrtc-backend';

import {
  ToolRegistry,
  defineTool,
  Playbook,
  Stage
} from '@metered/llmrtc-core';

const execAsync = promisify(exec);

// =============================================================================
// Security Configuration
// =============================================================================

// Allowed directories for file operations (expand ~ to home dir)
const ALLOWED_DIRECTORIES = (process.env.ALLOWED_DIRECTORIES || '~/Documents,~/Downloads')
  .split(',')
  .map(dir => dir.trim().replace('~', os.homedir()));

// Whitelisted safe commands
const SAFE_COMMANDS = ['ls', 'cat', 'wc', 'date', 'echo', 'pwd', 'head', 'tail', 'which', 'hostname'];

/**
 * Check if a path is within allowed directories
 */
function isPathAllowed(targetPath: string): boolean {
  const resolved = path.resolve(targetPath.replace('~', os.homedir()));
  return ALLOWED_DIRECTORIES.some(dir => resolved.startsWith(path.resolve(dir)));
}

/**
 * Normalize and validate a path
 */
function normalizePath(inputPath: string): string {
  return path.resolve(inputPath.replace('~', os.homedir()));
}

// =============================================================================
// Local File Tools
// =============================================================================

const readFileTool = defineTool(
  {
    name: 'read_file',
    description: 'Read the contents of a file. Restricted to allowed directories for security.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to read (e.g., ~/Documents/notes.txt)'
        },
        maxLines: {
          type: 'integer',
          description: 'Maximum lines to read (default: 100)',
          minimum: 1,
          maximum: 1000
        }
      },
      required: ['path']
    }
  },
  async (params: { path: string; maxLines?: number }) => {
    console.log(`[tool] read_file: ${params.path}`);

    const filePath = normalizePath(params.path);

    if (!isPathAllowed(filePath)) {
      return {
        success: false,
        error: `Access denied. File must be in: ${ALLOWED_DIRECTORIES.join(', ')}`
      };
    }

    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        return { success: false, error: 'Path is not a file' };
      }

      let content = await fs.readFile(filePath, 'utf-8');

      // Limit lines if specified
      const maxLines = params.maxLines || 100;
      const lines = content.split('\n');
      if (lines.length > maxLines) {
        content = lines.slice(0, maxLines).join('\n') + `\n... (truncated, ${lines.length - maxLines} more lines)`;
      }

      return {
        success: true,
        path: filePath,
        size: stats.size,
        lines: Math.min(lines.length, maxLines),
        content
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to read file'
      };
    }
  }
);

const listDirectoryTool = defineTool(
  {
    name: 'list_directory',
    description: 'List files and folders in a directory. Restricted to allowed directories.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list (e.g., ~/Documents)'
        }
      },
      required: ['path']
    }
  },
  async (params: { path: string }) => {
    console.log(`[tool] list_directory: ${params.path}`);

    const dirPath = normalizePath(params.path);

    if (!isPathAllowed(dirPath)) {
      return {
        success: false,
        error: `Access denied. Directory must be in: ${ALLOWED_DIRECTORIES.join(', ')}`
      };
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      const items = await Promise.all(
        entries.slice(0, 50).map(async (entry) => {
          const fullPath = path.join(dirPath, entry.name);
          try {
            const stats = await fs.stat(fullPath);
            return {
              name: entry.name,
              type: entry.isDirectory() ? 'directory' : 'file',
              size: entry.isFile() ? stats.size : undefined,
              modified: stats.mtime.toISOString().split('T')[0]
            };
          } catch {
            return {
              name: entry.name,
              type: entry.isDirectory() ? 'directory' : 'file'
            };
          }
        })
      );

      return {
        success: true,
        path: dirPath,
        count: entries.length,
        items,
        truncated: entries.length > 50
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to list directory'
      };
    }
  }
);

const searchFilesTool = defineTool(
  {
    name: 'search_files',
    description: 'Search for text patterns in files within allowed directories.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Text pattern to search for'
        },
        path: {
          type: 'string',
          description: 'Directory to search in (default: ~/Documents)'
        },
        maxResults: {
          type: 'integer',
          description: 'Maximum results to return (default: 10)',
          minimum: 1,
          maximum: 50
        }
      },
      required: ['pattern']
    }
  },
  async (params: { pattern: string; path?: string; maxResults?: number }) => {
    console.log(`[tool] search_files: "${params.pattern}" in ${params.path || '~/Documents'}`);

    const searchPath = normalizePath(params.path || '~/Documents');

    if (!isPathAllowed(searchPath)) {
      return {
        success: false,
        error: `Access denied. Search path must be in: ${ALLOWED_DIRECTORIES.join(', ')}`
      };
    }

    const maxResults = params.maxResults || 10;
    const results: Array<{ file: string; line: number; content: string }> = [];

    async function searchDir(dir: string): Promise<void> {
      if (results.length >= maxResults) return;

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (results.length >= maxResults) break;

          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            await searchDir(fullPath);
          } else if (entry.isFile() && !entry.name.startsWith('.')) {
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              const lines = content.split('\n');

              for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                if (lines[i].toLowerCase().includes(params.pattern.toLowerCase())) {
                  results.push({
                    file: path.relative(searchPath, fullPath),
                    line: i + 1,
                    content: lines[i].trim().slice(0, 100)
                  });
                }
              }
            } catch {
              // Skip files that can't be read
            }
          }
        }
      } catch {
        // Skip directories that can't be accessed
      }
    }

    await searchDir(searchPath);

    return {
      success: true,
      pattern: params.pattern,
      searchPath,
      resultCount: results.length,
      results
    };
  }
);

const runCommandTool = defineTool(
  {
    name: 'run_command',
    description: 'Run a safe, whitelisted shell command. Only basic read-only commands are allowed.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: `Command to run. Allowed: ${SAFE_COMMANDS.join(', ')}`
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command arguments'
        }
      },
      required: ['command']
    }
  },
  async (params: { command: string; args?: string[] }) => {
    console.log(`[tool] run_command: ${params.command} ${(params.args || []).join(' ')}`);

    const cmd = params.command.toLowerCase();

    if (!SAFE_COMMANDS.includes(cmd)) {
      return {
        success: false,
        error: `Command not allowed. Safe commands: ${SAFE_COMMANDS.join(', ')}`
      };
    }

    // Check if any args try to access restricted paths
    const args = params.args || [];
    for (const arg of args) {
      if (arg.includes('/') && !isPathAllowed(arg)) {
        return {
          success: false,
          error: `Path argument not in allowed directories: ${arg}`
        };
      }
    }

    try {
      const fullCommand = [cmd, ...args].join(' ');
      const { stdout, stderr } = await execAsync(fullCommand, {
        timeout: 5000,
        maxBuffer: 1024 * 100
      });

      return {
        success: true,
        command: fullCommand,
        stdout: stdout.trim().slice(0, 2000),
        stderr: stderr.trim().slice(0, 500),
        exitCode: 0
      };
    } catch (err: unknown) {
      const execErr = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        success: false,
        command: [cmd, ...args].join(' '),
        stdout: execErr.stdout || '',
        stderr: execErr.stderr || '',
        exitCode: execErr.code || 1,
        error: execErr.message || 'Command failed'
      };
    }
  }
);

// =============================================================================
// Playbook Definition
// =============================================================================

const assistantStage: Stage = {
  id: 'assistant',
  name: 'Local Assistant',
  description: 'Help with local file operations and commands',
  systemPrompt: `You are a helpful local AI assistant running entirely on the user's machine.
You value privacy and only work with local files.

You have access to these tools:
- read_file: Read file contents from allowed directories
- list_directory: List files and folders
- search_files: Search for text in files
- run_command: Run safe shell commands (ls, date, etc.)

Allowed directories: ${ALLOWED_DIRECTORIES.join(', ')}
Safe commands: ${SAFE_COMMANDS.join(', ')}

When the user asks about files or directories:
1. Use the appropriate tool to get the information
2. Provide clear, concise responses
3. Respect privacy - never try to access system or sensitive directories

Keep responses brief and helpful.`,
  tools: [
    readFileTool.definition,
    listDirectoryTool.definition,
    searchFilesTool.definition,
    runCommandTool.definition
  ],
  toolChoice: 'auto',
  twoPhaseExecution: true
};

const localPlaybook: Playbook = {
  id: 'local-assistant',
  name: 'Local File Assistant',
  description: 'Privacy-focused assistant with local file tools',
  version: '1.0.0',
  stages: [assistantStage],
  transitions: [],
  initialStage: 'assistant',
  globalSystemPrompt: `You are a privacy-focused local assistant.
All processing happens on the user's machine.
Be helpful but respect file system boundaries.`,
  defaultLLMConfig: {
    temperature: 0.7,
    maxTokens: 400
  }
};

// =============================================================================
// Service Health Check
// =============================================================================

async function checkService(name: string, url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

// =============================================================================
// Server Setup
// =============================================================================

async function main() {
  console.log('\n  Local Assistant');
  console.log('  ===============');
  console.log('  100% local AI with file tools\n');

  // Check prerequisites
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const whisperUrl = process.env.FASTER_WHISPER_URL || 'http://localhost:8000';
  const piperUrl = process.env.PIPER_URL || 'http://localhost:5000';

  console.log('  Checking local services...');

  const ollamaOk = await checkService('Ollama', ollamaUrl);
  const whisperOk = await checkService('Faster-Whisper', `${whisperUrl}/health`);
  const piperOk = await checkService('Piper', piperUrl);

  console.log(`    Ollama (${ollamaUrl}): ${ollamaOk ? '\u2713 OK' : '\u2717 NOT RUNNING'}`);
  console.log(`    Faster-Whisper (${whisperUrl}): ${whisperOk ? '\u2713 OK' : '\u2717 NOT RUNNING'}`);
  console.log(`    Piper (${piperUrl}): ${piperOk ? '\u2713 OK' : '\u2717 NOT RUNNING'}`);

  if (!ollamaOk || !whisperOk || !piperOk) {
    console.log('\n  Some services are not running!');
    console.log('  Run: npm run docker:up (for Whisper & Piper)');
    console.log('  And: ollama serve && ollama pull llama3.2 (for Ollama)\n');
    process.exit(1);
  }

  console.log('\n  All services running!');
  console.log(`  Allowed directories: ${ALLOWED_DIRECTORIES.join(', ')}\n`);

  // Create tool registry
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(readFileTool);
  toolRegistry.register(listDirectoryTool);
  toolRegistry.register(searchFilesTool);
  toolRegistry.register(runCommandTool);

  console.log('  Registered tools:', toolRegistry.names().join(', '));

  const server = new LLMRTCServer({
    providers: {
      llm: new OllamaLLMProvider({
        baseUrl: ollamaUrl,
        model: process.env.OLLAMA_MODEL || 'llama3.2'
      }),
      stt: new FasterWhisperProvider({
        baseUrl: whisperUrl
      }),
      tts: new PiperTTSProvider({
        baseUrl: piperUrl
      })
    },
    port: 8787,
    streamingTTS: true,

    // Enable playbook mode with tools
    playbook: localPlaybook,
    toolRegistry
  });

  server.on('listening', ({ host, port }) => {
    console.log(`\n  Server running at http://${host}:${port}`);
    console.log(`  Open http://localhost:5173 to use the client`);
    console.log('\n  Providers:');
    console.log(`    LLM: Ollama (${process.env.OLLAMA_MODEL || 'llama3.2'})`);
    console.log('    STT: Faster-Whisper');
    console.log('    TTS: Piper');
    console.log(`\n  Try saying:`);
    console.log(`    "List my documents folder"`);
    console.log(`    "What files are in downloads?"`);
    console.log(`    "Search for TODO in documents"\n`);
  });

  server.on('connection', ({ id }) => {
    console.log(`[server] Client connected: ${id}`);
  });

  server.on('disconnect', ({ id }) => {
    console.log(`[server] Client disconnected: ${id}`);
  });

  server.on('error', (err) => {
    console.error(`[server] Error:`, err.message);
  });

  await server.start();
}

main().catch(console.error);
