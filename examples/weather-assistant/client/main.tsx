/**
 * Weather Assistant Client
 *
 * React client demonstrating:
 * - Voice interaction with WebRTC
 * - Tool call events displayed in real-time
 * - Streaming LLM and TTS responses
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

    // Speech detection (VAD)
    client.on('speechStart', () => {
      setStatus('listening');
      setResponse('');
      setToolCalls([]); // Clear previous tool calls
    });

    client.on('speechEnd', () => {
      setStatus('thinking');
    });

    // Transcript from STT
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

    // LLM response (streaming)
    client.on('llmChunk', (chunk) => {
      setResponse((prev) => prev + chunk);
    });

    // TTS audio via WebRTC track
    client.on('ttsTrack', (stream) => {
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      audioRef.current.srcObject = stream;
      audioRef.current.play().catch(() => {
        // Autoplay may be blocked
      });
    });

    client.on('ttsStart', () => {
      setStatus('speaking');
    });

    client.on('ttsComplete', () => {
      setStatus('idle');
    });

    client.on('ttsCancelled', () => {
      setStatus('listening');
    });

    // Error handling
    client.on('error', (err) => {
      setError(err.message);
      setTimeout(() => setError(null), 5000);
    });

    // Connect and share audio
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
    idle: 'Ready - Speak to begin',
    listening: 'Listening...',
    thinking: 'Processing...',
    speaking: 'Speaking...'
  };

  const toolIcons: Record<string, string> = {
    get_weather: '\u2600\uFE0F',
    get_forecast: '\uD83D\uDCC5',
    get_alerts: '\u26A0\uFE0F'
  };

  return (
    <div style={{ textAlign: 'center' }}>
      <h1 style={{ marginBottom: '0.5rem', fontSize: '1.5rem' }}>
        Weather Assistant
      </h1>
      <p style={{ color: '#888', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Voice-enabled weather with tool calling
      </p>

      {/* Status indicator */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.75rem 1.5rem',
        borderRadius: '2rem',
        background: 'rgba(22, 33, 62, 0.8)',
        marginBottom: '1.5rem'
      }}>
        <div style={{
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          background: statusColors[status],
          animation: status !== 'disconnected' && status !== 'idle' ? 'pulse 1.5s infinite' : 'none'
        }} />
        <span>{statusLabels[status]}</span>
      </div>

      {/* Transcript */}
      <div style={{
        background: 'rgba(22, 33, 62, 0.6)',
        borderRadius: '1rem',
        padding: '1.25rem',
        marginBottom: '1rem',
        minHeight: '70px'
      }}>
        <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.5rem' }}>
          You said:
        </div>
        <div style={{ fontSize: '1.1rem' }}>
          {transcript || <span style={{ color: '#555' }}>Ask about the weather...</span>}
        </div>
      </div>

      {/* Tool Calls */}
      {toolCalls.length > 0 && (
        <div style={{
          background: 'rgba(22, 33, 62, 0.6)',
          borderRadius: '1rem',
          padding: '1.25rem',
          marginBottom: '1rem',
          textAlign: 'left'
        }}>
          <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.75rem' }}>
            Tool Calls:
          </div>
          {toolCalls.map((tc) => (
            <div key={tc.callId} style={{
              background: 'rgba(0, 0, 0, 0.2)',
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
                <span style={{ fontWeight: 'bold' }}>{tc.name}</span>
                <span style={{
                  fontSize: '0.7rem',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '1rem',
                  background: tc.status === 'running' ? '#f39c12' :
                              tc.status === 'complete' ? '#27ae60' : '#e74c3c'
                }}>
                  {tc.status === 'running' ? 'Running...' :
                   tc.status === 'complete' ? `Done (${tc.durationMs}ms)` : 'Error'}
                </span>
              </div>

              {tc.arguments && (
                <div style={{ fontSize: '0.8rem', color: '#aaa', marginBottom: '0.25rem' }}>
                  Args: {JSON.stringify(tc.arguments)}
                </div>
              )}

              {tc.status === 'complete' && tc.result && (
                <div style={{
                  fontSize: '0.8rem',
                  color: '#8bc34a',
                  background: 'rgba(139, 195, 74, 0.1)',
                  padding: '0.5rem',
                  borderRadius: '0.25rem',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}>
                  {JSON.stringify(tc.result, null, 2)}
                </div>
              )}

              {tc.error && (
                <div style={{ fontSize: '0.8rem', color: '#e74c3c' }}>
                  Error: {tc.error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* AI Response */}
      <div style={{
        background: 'rgba(22, 33, 62, 0.6)',
        borderRadius: '1rem',
        padding: '1.25rem',
        minHeight: '100px',
        textAlign: 'left'
      }}>
        <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.5rem' }}>
          Assistant:
        </div>
        <div style={{ fontSize: '1.1rem', lineHeight: '1.6' }}>
          {response || <span style={{ color: '#555' }}>Response will appear here...</span>}
        </div>
      </div>

      {/* Error message */}
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
        color: '#666'
      }}>
        Try: "What's the weather in Tokyo?" or "Any alerts in Miami?"
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
