/**
 * Multi-Provider LLMRTC Client Example
 *
 * Shows provider selection UI and demonstrates
 * how different providers can be used.
 */

import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { LLMRTCWebClient } from '@metered/llmrtc-web-client';

type Status = 'disconnected' | 'connecting' | 'idle' | 'listening' | 'thinking' | 'speaking';

interface Provider {
  key: string;
  name: string;
  available: boolean;
}

interface Providers {
  llm: Provider[];
  stt: Provider[];
  tts: Provider[];
}

interface CurrentProviders {
  llm: string;
  stt: string;
  tts: string;
}

function App() {
  const [status, setStatus] = useState<Status>('disconnected');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Provider state
  const [providers, setProviders] = useState<Providers | null>(null);
  const [current, setCurrent] = useState<CurrentProviders | null>(null);

  const clientRef = useRef<LLMRTCWebClient | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Fetch provider info
  useEffect(() => {
    Promise.all([
      fetch('/api/providers').then(r => r.json()),
      fetch('/api/providers/current').then(r => r.json())
    ]).then(([providerList, currentProviders]) => {
      setProviders(providerList);
      setCurrent(currentProviders);
    }).catch(err => {
      setError('Failed to fetch provider info');
    });
  }, []);

  // Connect to server
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

    client.on('speechEnd', () => setStatus('thinking'));
    client.on('transcript', (text) => setTranscript(text));
    client.on('llmChunk', (chunk) => setResponse((prev) => prev + chunk));

    client.on('ttsTrack', (stream) => {
      if (!audioRef.current) audioRef.current = new Audio();
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
    disconnected: '#6e7681',
    connecting: '#d29922',
    idle: '#3fb950',
    listening: '#58a6ff',
    thinking: '#a371f7',
    speaking: '#f85149'
  };

  const statusLabels: Record<Status, string> = {
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
    idle: 'Ready',
    listening: 'Listening...',
    thinking: 'Thinking...',
    speaking: 'Speaking...'
  };

  return (
    <div>
      <h1 style={{ marginBottom: '0.5rem', fontSize: '1.5rem' }}>
        Multi-Provider Voice Assistant
      </h1>
      <p style={{ marginBottom: '2rem', color: '#8b949e', fontSize: '0.9rem' }}>
        Demonstrating provider flexibility and configuration
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '2rem' }}>
        {/* Provider Panel */}
        <div style={{
          background: '#161b22',
          borderRadius: '0.5rem',
          padding: '1.5rem',
          border: '1px solid #30363d'
        }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '1rem', color: '#f0f6fc' }}>
            Provider Configuration
          </h2>

          {providers && current ? (
            <>
              {/* LLM Provider */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#8b949e', marginBottom: '0.25rem' }}>
                  LLM Provider
                </label>
                <div style={{
                  padding: '0.5rem 0.75rem',
                  background: '#0d1117',
                  borderRadius: '0.375rem',
                  border: '1px solid #30363d'
                }}>
                  {providers.llm.find(p => p.key === current.llm)?.name || current.llm}
                </div>
              </div>

              {/* STT Provider */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#8b949e', marginBottom: '0.25rem' }}>
                  STT Provider
                </label>
                <div style={{
                  padding: '0.5rem 0.75rem',
                  background: '#0d1117',
                  borderRadius: '0.375rem',
                  border: '1px solid #30363d'
                }}>
                  {providers.stt.find(p => p.key === current.stt)?.name || current.stt}
                </div>
              </div>

              {/* TTS Provider */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#8b949e', marginBottom: '0.25rem' }}>
                  TTS Provider
                </label>
                <div style={{
                  padding: '0.5rem 0.75rem',
                  background: '#0d1117',
                  borderRadius: '0.375rem',
                  border: '1px solid #30363d'
                }}>
                  {providers.tts.find(p => p.key === current.tts)?.name || current.tts}
                </div>
              </div>

              {/* Available Providers */}
              <div style={{
                padding: '1rem',
                background: '#0d1117',
                borderRadius: '0.375rem',
                fontSize: '0.75rem'
              }}>
                <div style={{ color: '#8b949e', marginBottom: '0.5rem' }}>Available:</div>
                <div style={{ color: '#58a6ff', marginBottom: '0.25rem' }}>
                  LLM: {providers.llm.filter(p => p.available).map(p => p.key).join(', ')}
                </div>
                <div style={{ color: '#58a6ff', marginBottom: '0.25rem' }}>
                  STT: {providers.stt.filter(p => p.available).map(p => p.key).join(', ')}
                </div>
                <div style={{ color: '#58a6ff' }}>
                  TTS: {providers.tts.filter(p => p.available).map(p => p.key).join(', ')}
                </div>
              </div>

              <p style={{
                marginTop: '1rem',
                fontSize: '0.75rem',
                color: '#8b949e',
                fontStyle: 'italic'
              }}>
                Set providers via environment variables
              </p>
            </>
          ) : (
            <div style={{ color: '#8b949e' }}>Loading providers...</div>
          )}
        </div>

        {/* Main Panel */}
        <div>
          {/* Status */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            borderRadius: '2rem',
            background: '#161b22',
            border: '1px solid #30363d',
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
            background: '#161b22',
            borderRadius: '0.5rem',
            padding: '1.25rem',
            marginBottom: '1rem',
            minHeight: '80px',
            border: '1px solid #30363d'
          }}>
            <div style={{ fontSize: '0.7rem', color: '#8b949e', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
              You said
            </div>
            <div style={{ fontSize: '1rem' }}>
              {transcript || <span style={{ color: '#484f58' }}>Waiting for speech...</span>}
            </div>
          </div>

          {/* AI Response */}
          <div style={{
            background: '#161b22',
            borderRadius: '0.5rem',
            padding: '1.25rem',
            minHeight: '150px',
            border: '1px solid #30363d'
          }}>
            <div style={{ fontSize: '0.7rem', color: '#8b949e', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
              AI Response
            </div>
            <div style={{ fontSize: '1rem', lineHeight: '1.6' }}>
              {response || <span style={{ color: '#484f58' }}>AI will respond here...</span>}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              marginTop: '1rem',
              padding: '0.75rem',
              background: 'rgba(248, 81, 73, 0.15)',
              border: '1px solid rgba(248, 81, 73, 0.4)',
              borderRadius: '0.375rem',
              color: '#f85149',
              fontSize: '0.9rem'
            }}>
              {error}
            </div>
          )}
        </div>
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
