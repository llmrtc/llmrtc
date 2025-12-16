/**
 * LLMRTC Observability Example Client
 *
 * Simple frontend for testing the observability examples.
 * Run different server examples and watch the console output.
 */

import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { LLMRTCWebClient } from '@llmrtc/llmrtc-web-client';

type Status = 'disconnected' | 'connecting' | 'idle' | 'listening' | 'thinking' | 'speaking';

function App() {
  const [status, setStatus] = useState<Status>('disconnected');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
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
      setResponse(''); // Clear previous response
    });

    client.on('speechEnd', () => {
      setStatus('thinking');
    });

    // Transcript from STT
    client.on('transcript', (text) => {
      setTranscript(text);
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
        // Autoplay may be blocked - user interaction needed
      });
    });

    client.on('ttsStart', () => {
      setStatus('speaking');
    });

    client.on('ttsComplete', () => {
      setStatus('idle');
    });

    client.on('ttsCancelled', () => {
      setStatus('listening'); // User interrupted
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
    thinking: 'Thinking...',
    speaking: 'Speaking...'
  };

  return (
    <div style={{ textAlign: 'center' }}>
      <h1 style={{ marginBottom: '0.5rem', fontSize: '1.5rem' }}>
        LLMRTC Observability Example
      </h1>
      <p style={{ marginBottom: '2rem', fontSize: '0.9rem', color: '#888' }}>
        Watch the server console for hooks and metrics output
      </p>

      {/* Status indicator */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.75rem 1.5rem',
        borderRadius: '2rem',
        background: '#16213e',
        marginBottom: '2rem'
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

      {/* Transcript (what user said) */}
      <div style={{
        background: '#16213e',
        borderRadius: '1rem',
        padding: '1.5rem',
        marginBottom: '1rem',
        minHeight: '80px'
      }}>
        <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.5rem' }}>
          You said:
        </div>
        <div style={{ fontSize: '1.1rem' }}>
          {transcript || <span style={{ color: '#555' }}>Waiting for speech...</span>}
        </div>
      </div>

      {/* AI Response */}
      <div style={{
        background: '#16213e',
        borderRadius: '1rem',
        padding: '1.5rem',
        minHeight: '120px'
      }}>
        <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.5rem' }}>
          AI response:
        </div>
        <div style={{ fontSize: '1.1rem', lineHeight: '1.6' }}>
          {response || <span style={{ color: '#555' }}>AI will respond here...</span>}
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
