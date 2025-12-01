/**
 * Support Bot Client
 *
 * React client demonstrating:
 * - Multi-stage playbook visualization
 * - Stage transition events
 * - Tool call events
 * - Streaming responses
 */

import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { LLMRTCWebClient } from '@metered/llmrtc-web-client';

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

interface StageTransition {
  from: string;
  to: string;
  reason: string;
  timestamp: number;
}

const STAGES = ['greeting', 'authentication', 'issue_triage', 'resolution', 'farewell'];

const STAGE_INFO: Record<string, { label: string; icon: string; color: string }> = {
  greeting: { label: 'Greeting', icon: '\uD83D\uDC4B', color: '#3498db' },
  authentication: { label: 'Auth', icon: '\uD83D\uDD10', color: '#e74c3c' },
  issue_triage: { label: 'Triage', icon: '\uD83D\uDCCB', color: '#f39c12' },
  resolution: { label: 'Resolution', icon: '\u2699\uFE0F', color: '#9b59b6' },
  farewell: { label: 'Farewell', icon: '\uD83D\uDC4D', color: '#27ae60' }
};

function App() {
  const [status, setStatus] = useState<Status>('disconnected');
  const [currentStage, setCurrentStage] = useState('greeting');
  const [stageHistory, setStageHistory] = useState<StageTransition[]>([]);
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

    // Stage changes
    client.on('stageChange', ({ from, to, reason }) => {
      console.log(`[stage] ${from} -> ${to} (${reason})`);
      setCurrentStage(to);
      setStageHistory(prev => [...prev, {
        from,
        to,
        reason,
        timestamp: Date.now()
      }]);
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
    lookup_customer: '\uD83D\uDC64',
    check_order_status: '\uD83D\uDCE6',
    create_ticket: '\uD83C\uDFAB',
    apply_credit: '\uD83D\uDCB0'
  };

  return (
    <div>
      <h1 style={{ textAlign: 'center', marginBottom: '0.5rem', fontSize: '1.5rem' }}>
        Support Bot
      </h1>
      <p style={{ textAlign: 'center', color: '#888', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Multi-stage customer support with voice
      </p>

      {/* Stage Progress */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '1.5rem',
        padding: '0.75rem',
        background: 'rgba(22, 33, 62, 0.6)',
        borderRadius: '1rem'
      }}>
        {STAGES.map((stage, idx) => {
          const info = STAGE_INFO[stage];
          const isActive = stage === currentStage;
          const isPast = STAGES.indexOf(currentStage) > idx;

          return (
            <div key={stage} style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              flex: 1,
              opacity: isPast ? 0.5 : 1
            }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.2rem',
                background: isActive ? info.color : 'rgba(255,255,255,0.1)',
                border: isActive ? 'none' : '2px solid rgba(255,255,255,0.2)',
                transition: 'all 0.3s'
              }}>
                {info.icon}
              </div>
              <span style={{
                marginTop: '0.5rem',
                fontSize: '0.7rem',
                color: isActive ? info.color : '#888',
                fontWeight: isActive ? 'bold' : 'normal'
              }}>
                {info.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Status indicator */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        marginBottom: '1rem'
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.5rem 1rem',
          borderRadius: '2rem',
          background: 'rgba(22, 33, 62, 0.8)',
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
      </div>

      {/* Main content grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {/* Left column: Conversation */}
        <div>
          {/* Transcript */}
          <div style={{
            background: 'rgba(22, 33, 62, 0.6)',
            borderRadius: '1rem',
            padding: '1rem',
            marginBottom: '1rem',
            minHeight: '60px'
          }}>
            <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: '0.5rem' }}>
              You said:
            </div>
            <div style={{ fontSize: '1rem' }}>
              {transcript || <span style={{ color: '#555' }}>Say "Hello"...</span>}
            </div>
          </div>

          {/* Response */}
          <div style={{
            background: 'rgba(22, 33, 62, 0.6)',
            borderRadius: '1rem',
            padding: '1rem',
            minHeight: '150px'
          }}>
            <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: '0.5rem' }}>
              Agent:
            </div>
            <div style={{ fontSize: '1rem', lineHeight: '1.5' }}>
              {response || <span style={{ color: '#555' }}>Response appears here...</span>}
            </div>
          </div>
        </div>

        {/* Right column: Events */}
        <div>
          {/* Tool Calls */}
          <div style={{
            background: 'rgba(22, 33, 62, 0.6)',
            borderRadius: '1rem',
            padding: '1rem',
            marginBottom: '1rem',
            minHeight: '100px',
            maxHeight: '200px',
            overflowY: 'auto'
          }}>
            <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: '0.5rem' }}>
              Tool Calls:
            </div>
            {toolCalls.length === 0 ? (
              <span style={{ color: '#555', fontSize: '0.9rem' }}>No tools called yet...</span>
            ) : (
              toolCalls.map((tc) => (
                <div key={tc.callId} style={{
                  background: 'rgba(0, 0, 0, 0.2)',
                  borderRadius: '0.5rem',
                  padding: '0.5rem',
                  marginBottom: '0.5rem',
                  borderLeft: `3px solid ${
                    tc.status === 'running' ? '#f39c12' :
                    tc.status === 'complete' ? '#27ae60' : '#e74c3c'
                  }`,
                  fontSize: '0.85rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>{toolIcons[tc.name] || '\uD83D\uDEE0\uFE0F'}</span>
                    <span style={{ fontWeight: 'bold' }}>{tc.name}</span>
                    <span style={{
                      fontSize: '0.65rem',
                      padding: '0.1rem 0.4rem',
                      borderRadius: '1rem',
                      background: tc.status === 'running' ? '#f39c12' :
                                  tc.status === 'complete' ? '#27ae60' : '#e74c3c'
                    }}>
                      {tc.status === 'running' ? '...' : tc.durationMs ? `${tc.durationMs}ms` : 'done'}
                    </span>
                  </div>
                  {tc.status === 'complete' && tc.result && (
                    <div style={{
                      marginTop: '0.25rem',
                      fontSize: '0.75rem',
                      color: '#8bc34a',
                      fontFamily: 'monospace'
                    }}>
                      {typeof tc.result === 'object' && tc.result !== null && 'success' in tc.result
                        ? (tc.result as { success: boolean }).success ? '\u2713 Success' : '\u2717 Failed'
                        : JSON.stringify(tc.result).slice(0, 50)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Stage History */}
          <div style={{
            background: 'rgba(22, 33, 62, 0.6)',
            borderRadius: '1rem',
            padding: '1rem',
            maxHeight: '150px',
            overflowY: 'auto'
          }}>
            <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: '0.5rem' }}>
              Stage Transitions:
            </div>
            {stageHistory.length === 0 ? (
              <span style={{ color: '#555', fontSize: '0.9rem' }}>Started in greeting stage...</span>
            ) : (
              stageHistory.map((t, idx) => (
                <div key={idx} style={{
                  fontSize: '0.8rem',
                  padding: '0.25rem 0',
                  borderBottom: idx < stageHistory.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none'
                }}>
                  <span style={{ color: STAGE_INFO[t.from]?.color }}>{STAGE_INFO[t.from]?.label}</span>
                  <span style={{ color: '#666' }}> \u2192 </span>
                  <span style={{ color: STAGE_INFO[t.to]?.color }}>{STAGE_INFO[t.to]?.label}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          marginTop: '1rem',
          padding: '0.75rem',
          background: '#c0392b',
          borderRadius: '0.5rem',
          fontSize: '0.9rem',
          textAlign: 'center'
        }}>
          {error}
        </div>
      )}

      {/* Tips */}
      <div style={{
        marginTop: '1.5rem',
        fontSize: '0.8rem',
        color: '#666',
        textAlign: 'center'
      }}>
        Test: john@example.com | Order: ORD-12345
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
