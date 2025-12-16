/**
 * Local Assistant Client
 *
 * React client for the local-only voice assistant with file tools.
 * Privacy-focused design with tool call visualization.
 */

import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { LLMRTCWebClient } from '@llmrtc/llmrtc-web-client';

type Status = 'disconnected' | 'connecting' | 'idle' | 'listening' | 'thinking' | 'speaking';

interface ToolCall {
  callId: string;
  name: string;
  arguments?: Record<string, unknown>;
  status: 'running' | 'complete' | 'error';
  result?: unknown;
  error?: string;
  durationMs?: number;
}

function App() {
  const [status, setStatus] = useState<Status>('disconnected');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<LLMRTCWebClient | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const client = new LLMRTCWebClient({
      signallingUrl: 'ws://localhost:8787'
    });
    clientRef.current = client;

    // Connection state
    client.on('stateChange', (state) => {
      if (state === 'connected') setStatus('idle');
      else if (state === 'connecting') setStatus('connecting');
      else if (state === 'disconnected' || state === 'failed') setStatus('disconnected');
    });

    // Speech detection
    client.on('speechStart', () => {
      setStatus('listening');
      setResponse('');
      setToolCalls([]);
    });

    client.on('speechEnd', () => {
      setStatus('thinking');
    });

    // Transcript
    client.on('transcript', (text) => {
      setTranscript(text);
    });

    // Tool call events
    client.on('toolCallStart', ({ name, callId, arguments: args }) => {
      console.log(`[tool] Start: ${name}`, args);
      setToolCalls(prev => [...prev, {
        callId,
        name,
        arguments: args,
        status: 'running'
      }]);
    });

    client.on('toolCallEnd', ({ callId, result, error, durationMs }) => {
      console.log(`[tool] End: ${callId}`, { result, error, durationMs });
      setToolCalls(prev => prev.map(tc =>
        tc.callId === callId
          ? { ...tc, status: error ? 'error' : 'complete', result, error, durationMs }
          : tc
      ));
    });

    // LLM response
    client.on('llmChunk', (chunk) => {
      setResponse((prev) => prev + chunk);
    });

    // TTS
    client.on('ttsTrack', (stream) => {
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      audioRef.current.srcObject = stream;
      audioRef.current.play().catch(() => {});
    });

    client.on('ttsStart', () => setStatus('speaking'));
    client.on('ttsComplete', () => setStatus('idle'));
    client.on('ttsCancelled', () => setStatus('listening'));

    // Error
    client.on('error', (err) => {
      setError(err.message);
      setTimeout(() => setError(null), 5000);
    });

    // Connect
    client.start().then(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await client.shareAudio(stream);
      setStatus('idle');
    }).catch((err) => {
      setError(err.message);
      setStatus('disconnected');
    });

    return () => {
      client.close();
    };
  }, []);

  const statusColors: Record<Status, string> = {
    disconnected: '#666',
    connecting: '#f39c12',
    idle: '#27ae60',
    listening: '#3498db',
    thinking: '#9b59b6',
    speaking: '#e74c3c'
  };

  const statusLabels: Record<Status, string> = {
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
    idle: 'Ready',
    listening: 'Listening...',
    thinking: 'Processing...',
    speaking: 'Speaking...'
  };

  const toolIcons: Record<string, string> = {
    read_file: '\uD83D\uDCC4',
    list_directory: '\uD83D\uDCC1',
    search_files: '\uD83D\uDD0D',
    run_command: '\uD83D\uDCBB'
  };

  return (
    <div style={{ textAlign: 'center' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ marginBottom: '0.25rem', fontSize: '1.5rem' }}>
          Local Assistant
        </h1>
        <p style={{ color: '#888', fontSize: '0.85rem' }}>
          100% local AI with file tools
        </p>
        <div style={{
          display: 'inline-flex',
          gap: '0.5rem',
          marginTop: '0.5rem',
          fontSize: '0.7rem',
          color: '#666'
        }}>
          <span style={{ background: '#1a1a1a', padding: '0.2rem 0.5rem', borderRadius: '0.25rem' }}>
            \uD83E\uDD99 Ollama
          </span>
          <span style={{ background: '#1a1a1a', padding: '0.2rem 0.5rem', borderRadius: '0.25rem' }}>
            \uD83C\uDFA4 Whisper
          </span>
          <span style={{ background: '#1a1a1a', padding: '0.2rem 0.5rem', borderRadius: '0.25rem' }}>
            \uD83D\uDD0A Piper
          </span>
        </div>
      </div>

      {/* Status */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 1rem',
        borderRadius: '2rem',
        background: '#1a1a1a',
        marginBottom: '1.5rem'
      }}>
        <div style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: statusColors[status],
          animation: status !== 'disconnected' && status !== 'idle' ? 'pulse 1.5s infinite' : 'none'
        }} />
        <span style={{ fontSize: '0.9rem' }}>{statusLabels[status]}</span>
      </div>

      {/* Transcript */}
      <div style={{
        background: '#1a1a1a',
        borderRadius: '1rem',
        padding: '1.25rem',
        marginBottom: '1rem',
        minHeight: '70px'
      }}>
        <div style={{ fontSize: '0.7rem', color: '#666', marginBottom: '0.5rem' }}>
          You said:
        </div>
        <div style={{ fontSize: '1rem' }}>
          {transcript || <span style={{ color: '#444' }}>Ask about your files...</span>}
        </div>
      </div>

      {/* Tool Calls */}
      {toolCalls.length > 0 && (
        <div style={{
          background: '#1a1a1a',
          borderRadius: '1rem',
          padding: '1.25rem',
          marginBottom: '1rem',
          textAlign: 'left'
        }}>
          <div style={{ fontSize: '0.7rem', color: '#666', marginBottom: '0.75rem' }}>
            Tool Calls:
          </div>
          {toolCalls.map((tc) => (
            <div key={tc.callId} style={{
              background: '#0f0f0f',
              borderRadius: '0.5rem',
              padding: '0.75rem',
              marginBottom: '0.5rem',
              borderLeft: `3px solid ${
                tc.status === 'running' ? '#f39c12' :
                tc.status === 'complete' ? '#27ae60' : '#e74c3c'
              }`
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span>{toolIcons[tc.name] || '\uD83D\uDEE0\uFE0F'}</span>
                <span style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>{tc.name}</span>
                <span style={{
                  fontSize: '0.65rem',
                  padding: '0.1rem 0.4rem',
                  borderRadius: '1rem',
                  background: tc.status === 'running' ? '#f39c12' :
                              tc.status === 'complete' ? '#27ae60' : '#e74c3c',
                  marginLeft: 'auto'
                }}>
                  {tc.status === 'running' ? 'Running...' :
                   tc.status === 'complete' ? `${tc.durationMs}ms` : 'Error'}
                </span>
              </div>

              {tc.arguments && (
                <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.25rem', fontFamily: 'monospace' }}>
                  {Object.entries(tc.arguments).map(([k, v]) => (
                    <span key={k} style={{ marginRight: '0.75rem' }}>
                      {k}: <span style={{ color: '#6bb3f0' }}>{JSON.stringify(v)}</span>
                    </span>
                  ))}
                </div>
              )}

              {tc.status === 'complete' && tc.result && (
                <div style={{
                  fontSize: '0.75rem',
                  color: '#8bc34a',
                  background: 'rgba(139, 195, 74, 0.1)',
                  padding: '0.5rem',
                  borderRadius: '0.25rem',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '150px',
                  overflowY: 'auto'
                }}>
                  {typeof tc.result === 'object' && tc.result !== null
                    ? JSON.stringify(tc.result, null, 2)
                    : String(tc.result)}
                </div>
              )}

              {tc.error && (
                <div style={{ fontSize: '0.75rem', color: '#e74c3c', fontFamily: 'monospace' }}>
                  Error: {tc.error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Response */}
      <div style={{
        background: '#1a1a1a',
        borderRadius: '1rem',
        padding: '1.25rem',
        minHeight: '100px',
        textAlign: 'left'
      }}>
        <div style={{ fontSize: '0.7rem', color: '#666', marginBottom: '0.5rem' }}>
          Assistant:
        </div>
        <div style={{ fontSize: '1rem', lineHeight: '1.6' }}>
          {response || <span style={{ color: '#444' }}>Response will appear here...</span>}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          marginTop: '1rem',
          padding: '0.75rem',
          background: '#c0392b',
          borderRadius: '0.5rem',
          fontSize: '0.9rem'
        }}>
          {error}
        </div>
      )}

      {/* Tips */}
      <div style={{
        marginTop: '1.5rem',
        fontSize: '0.8rem',
        color: '#555'
      }}>
        Try: "List my documents" or "What's in downloads?"
      </div>

      {/* Privacy badge */}
      <div style={{
        marginTop: '1rem',
        fontSize: '0.7rem',
        color: '#27ae60',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.25rem'
      }}>
        <span>\uD83D\uDD12</span> All processing happens locally on your machine
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
