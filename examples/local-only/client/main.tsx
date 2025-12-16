/**
 * Local-Only LLMRTC Client Example
 *
 * Same client as minimal example - works with any backend!
 * The magic is in the server configuration.
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

    client.on('stateChange', (state) => {
      if (state === 'connected') setStatus('idle');
      else if (state === 'connecting') setStatus('connecting');
      else if (state === 'disconnected' || state === 'failed') setStatus('disconnected');
    });

    client.on('speechStart', () => {
      setStatus('listening');
      setResponse('');
    });

    client.on('speechEnd', () => {
      setStatus('thinking');
    });

    client.on('transcript', (text) => {
      setTranscript(text);
    });

    client.on('llmChunk', (chunk) => {
      setResponse((prev) => prev + chunk);
    });

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

    client.on('error', (err) => {
      setError(err.message);
      setTimeout(() => setError(null), 5000);
    });

    client.start().then(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await client.shareAudio(stream);
      setStatus('idle');
    }).catch((err) => {
      setError(err.message);
      setStatus('disconnected');
    });

    return () => client.close();
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
        Local-Only Voice Assistant
      </h1>
      <p style={{ marginBottom: '2rem', color: '#888', fontSize: '0.9rem' }}>
        Running 100% locally - Ollama + Faster-Whisper + Piper
      </p>

      {/* Status indicator */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.75rem 1.5rem',
        borderRadius: '2rem',
        background: 'rgba(255,255,255,0.1)',
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

      {/* Transcript */}
      <div style={{
        background: 'rgba(255,255,255,0.05)',
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
        background: 'rgba(255,255,255,0.05)',
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

      {/* Privacy badge */}
      <div style={{
        marginTop: '2rem',
        padding: '0.5rem 1rem',
        background: 'rgba(39, 174, 96, 0.2)',
        borderRadius: '0.5rem',
        fontSize: '0.8rem',
        color: '#27ae60',
        display: 'inline-block'
      }}>
        100% Local - Your data never leaves your machine
      </div>

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
