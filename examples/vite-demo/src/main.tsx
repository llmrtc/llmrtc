import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { LLMRTCWebClient, FrameCaptureController, ConnectionState } from '@llmrtc/llmrtc-web-client';

const signallingDefault = import.meta.env.VITE_SIGNAL_URL || 'ws://localhost:8787';

type MediaState = 'off' | 'starting' | 'on';

function App() {
  const clientRef = useRef<LLMRTCWebClient | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [reconnectInfo, setReconnectInfo] = useState<{ attempt: number; max: number } | null>(null);
  const [signalUrl, setSignalUrl] = useState(signallingDefault);
  const [transcript, setTranscript] = useState('');
  const [llmText, setLlmText] = useState('');
  const [streaming, setStreaming] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const ttsAudioRef = useRef<HTMLAudioElement>(null);
  const [ttsStatus, setTtsStatus] = useState<'idle' | 'playing'>('idle');

  // Media sharing states
  const [audioState, setAudioState] = useState<MediaState>('off');
  const [videoState, setVideoState] = useState<MediaState>('off');
  const [screenState, setScreenState] = useState<MediaState>('off');

  // Controllers for stopping media
  const audioCtrlRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const videoCtrlRef = useRef<FrameCaptureController | null>(null);
  const screenCtrlRef = useRef<FrameCaptureController | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  const client = useMemo(() => {
    const c = new LLMRTCWebClient({
      signallingUrl: signalUrl,
      useWebRTC: true,
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    c.on('transcript', setTranscript);
    c.on('llmChunk', (chunk) => setStreaming((prev) => prev + chunk));
    c.on('llm', (text) => {
      setLlmText(text);
      setStreaming('');
    });
    c.on('tts', (buffer, format) => {
      // Fallback: base64-encoded TTS audio (used when RTCAudioSource not available)
      const blob = new Blob([buffer], { type: format === 'wav' ? 'audio/wav' : 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play().catch(() => undefined);
      }
    });
    c.on('ttsTrack', (stream: MediaStream) => {
      // WebRTC MediaStreamTrack-based TTS audio (preferred)
      console.log('[demo] Received TTS audio track from server');
      if (ttsAudioRef.current) {
        ttsAudioRef.current.srcObject = stream;
        // Auto-play will be triggered by ttsStart event
      }
    });
    c.on('ttsStart', () => {
      console.log('[demo] TTS playback starting');
      setTtsStatus('playing');
      if (ttsAudioRef.current) {
        ttsAudioRef.current.play().catch((err) => console.error('[demo] TTS play error:', err));
      }
    });
    c.on('ttsComplete', () => {
      console.log('[demo] TTS playback complete');
      setTtsStatus('idle');
    });
    c.on('ttsCancelled', () => {
      console.log('[demo] TTS playback cancelled (barge-in)');
      setTtsStatus('idle');
    });
    c.on('stateChange', (state) => {
      console.log('[demo] Connection state changed:', state);
      setConnectionState(state);
      // Clear reconnect info when connected or failed
      if (state === ConnectionState.CONNECTED || state === ConnectionState.FAILED) {
        setReconnectInfo(null);
      }
    });
    c.on('reconnecting', (attempt, max) => {
      console.log(`[demo] Reconnecting: attempt ${attempt}/${max}`);
      setReconnectInfo({ attempt, max });
    });
    c.on('error', (err) => console.error('[client error]', err.code, err.message));
    return c;
  }, [signalUrl]);

  useEffect(() => {
    clientRef.current = client;
    // Expose client on window for E2E tests
    (window as any).llmrtcClient = client;
    // Expose testing helpers for E2E tests
    (window as any).llmrtcTestHelpers = {
      forceDisconnect: () => {
        // Access internal WebSocket and close it to trigger reconnection
        // The close code 4000+ is in the private use range and triggers the onclose handler
        const ws = (client as any).ws as WebSocket | null;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close(4000, 'Test: simulating disconnect');
        }
      },
      getSessionId: () => (client as any).currentSessionId ?? null,
      getConnectionState: () => client.state,
      // Direct access to client for debugging
      getClient: () => client,
    };
    return () => {
      client.close();
      delete (window as any).llmrtcClient;
      delete (window as any).llmrtcTestHelpers;
    };
  }, [client]);

  const connect = async () => {
    try {
      await client.start();
    } catch (err) {
      console.error('Connection failed:', err);
    }
  };

  // Derived state helpers
  const isConnected = connectionState === ConnectionState.CONNECTED;
  const isConnecting = connectionState === ConnectionState.CONNECTING;
  const isReconnecting = connectionState === ConnectionState.RECONNECTING;
  const isFailed = connectionState === ConnectionState.FAILED;
  const canConnect = connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.FAILED;

  // Toggle Audio Sharing
  const toggleAudio = useCallback(async () => {
    if (audioState === 'on') {
      // Stop audio (and dependent video/screen)
      await audioCtrlRef.current?.stop();
      audioCtrlRef.current = null;
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
      setAudioState('off');

      // Also stop video and screen since they depend on audio
      if (videoState === 'on') {
        videoCtrlRef.current?.stop();
        videoCtrlRef.current = null;
        setVideoState('off');
      }
      if (screenState === 'on') {
        screenCtrlRef.current?.stop();
        screenCtrlRef.current = null;
        setScreenState('off');
      }
    } else {
      // Start audio
      setAudioState('starting');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioStreamRef.current = stream;
        // Silero VAD handles speech detection automatically
        // No need to tune thresholds - it uses ML-based detection
        const ctrl = await client.shareAudio(stream);
        audioCtrlRef.current = ctrl;
        setAudioState('on');
      } catch (err) {
        console.error('Failed to start audio:', err);
        setAudioState('off');
      }
    }
  }, [audioState, videoState, screenState, client, isConnected]);

  // Toggle Video Sharing (requires audio)
  const toggleVideo = useCallback(async () => {
    if (videoState === 'on') {
      videoCtrlRef.current?.stop();
      videoCtrlRef.current = null;
      setVideoState('off');
    } else {
      if (audioState !== 'on') {
        alert('Please enable audio first. Video can only be shared along with audio.');
        return;
      }
      setVideoState('starting');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const ctrl = client.shareVideo(stream, 1000);
        videoCtrlRef.current = ctrl;
        setVideoState('on');
      } catch (err) {
        console.error('Failed to start video:', err);
        setVideoState('off');
      }
    }
  }, [videoState, audioState, client]);

  // Toggle Screen Sharing (requires audio)
  const toggleScreen = useCallback(async () => {
    if (screenState === 'on') {
      screenCtrlRef.current?.stop();
      screenCtrlRef.current = null;
      setScreenState('off');
    } else {
      if (audioState !== 'on') {
        alert('Please enable audio first. Screen can only be shared along with audio.');
        return;
      }
      setScreenState('starting');
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const ctrl = client.shareScreen(stream, 1200);
        screenCtrlRef.current = ctrl;
        setScreenState('on');
        // Handle user stopping screen share via browser UI
        stream.getVideoTracks()[0].onended = () => {
          screenCtrlRef.current = null;
          setScreenState('off');
        };
      } catch (err) {
        console.error('Failed to start screen share:', err);
        setScreenState('off');
      }
    }
  }, [screenState, audioState, client]);

  const getButtonStyle = (state: MediaState, isDependent = false) => ({
    padding: '12px 20px',
    fontSize: 15,
    fontWeight: 500,
    border: 'none',
    borderRadius: 8,
    cursor: state === 'starting' ? 'wait' : 'pointer',
    transition: 'all 0.2s',
    backgroundColor:
      state === 'on' ? '#ef4444' : state === 'starting' ? '#fbbf24' : isDependent ? '#e5e7eb' : '#3b82f6',
    color: state === 'on' || (!isDependent && state === 'off') ? '#fff' : '#374151',
    opacity: state === 'starting' ? 0.8 : 1
  });

  const getStatusDot = (state: MediaState) => (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        marginRight: 8,
        backgroundColor: state === 'on' ? '#22c55e' : state === 'starting' ? '#fbbf24' : '#9ca3af'
      }}
    />
  );

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', padding: '24px', maxWidth: 800, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 8 }}>@llmrtc/LLMRTC</h1>
      <p style={{ color: '#666', marginTop: 0, marginBottom: 24 }}>
        Real-time voice + vision conversation with LLM
      </p>

      {/* Connection Section */}
      <div
        style={{
          padding: 16,
          background: '#f9fafb',
          borderRadius: 12,
          marginBottom: 24
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            data-testid="signal-url-input"
            value={signalUrl}
            onChange={(e) => setSignalUrl(e.target.value)}
            style={{ flex: 1, padding: '10px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14 }}
            placeholder="wss://your-signal-host"
            disabled={isConnected || isConnecting || isReconnecting}
          />
          <button
            data-testid="connect-btn"
            onClick={connect}
            disabled={!canConnect}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 500,
              border: 'none',
              borderRadius: 6,
              cursor: canConnect ? 'pointer' : 'default',
              backgroundColor: isConnected
                ? '#22c55e'
                : isConnecting || isReconnecting
                  ? '#fbbf24'
                  : isFailed
                    ? '#ef4444'
                    : '#3b82f6',
              color: '#fff'
            }}
          >
            {isConnected
              ? 'Connected'
              : isConnecting
                ? 'Connecting...'
                : isReconnecting
                  ? 'Reconnecting...'
                  : isFailed
                    ? 'Retry'
                    : 'Connect'}
          </button>
        </div>

        {/* Connection Status Indicator */}
        <div
          data-testid="connection-status"
          data-state={connectionState}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 12,
            fontSize: 13
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: isConnected
                ? '#22c55e'
                : isConnecting || isReconnecting
                  ? '#fbbf24'
                  : isFailed
                    ? '#ef4444'
                    : '#9ca3af'
            }}
          />
          <span style={{ color: '#374151' }}>
            {isConnected
              ? 'Connected'
              : isConnecting
                ? 'Connecting to server...'
                : isReconnecting
                  ? `Reconnecting${reconnectInfo ? ` (attempt ${reconnectInfo.attempt}/${reconnectInfo.max})` : '...'}`
                  : isFailed
                    ? 'Connection failed - click Retry to reconnect'
                    : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Media Controls */}
      <div
        style={{
          padding: 20,
          background: '#f9fafb',
          borderRadius: 12,
          marginBottom: 24
        }}
      >
        <h3 style={{ margin: '0 0 16px 0', fontSize: 16 }}>Media Sharing</h3>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {/* Audio Button */}
          <button
            data-testid="share-audio-btn"
            data-state={audioState}
            onClick={toggleAudio}
            disabled={!isConnected || audioState === 'starting'}
            style={{
              ...getButtonStyle(audioState),
              opacity: !isConnected ? 0.5 : 1
            }}
          >
            {getStatusDot(audioState)}
            {audioState === 'on' ? 'Stop Audio' : audioState === 'starting' ? 'Starting...' : 'Share Audio'}
          </button>

          {/* Video Button */}
          <button
            data-testid="share-video-btn"
            data-state={videoState}
            onClick={toggleVideo}
            disabled={!isConnected || videoState === 'starting' || audioState !== 'on'}
            style={{
              ...getButtonStyle(videoState, audioState !== 'on'),
              opacity: !isConnected || audioState !== 'on' ? 0.5 : 1
            }}
          >
            {getStatusDot(videoState)}
            {videoState === 'on' ? 'Stop Video' : videoState === 'starting' ? 'Starting...' : 'Share Video'}
          </button>

          {/* Screen Button */}
          <button
            data-testid="share-screen-btn"
            data-state={screenState}
            onClick={toggleScreen}
            disabled={!isConnected || screenState === 'starting' || audioState !== 'on'}
            style={{
              ...getButtonStyle(screenState, audioState !== 'on'),
              opacity: !isConnected || audioState !== 'on' ? 0.5 : 1
            }}
          >
            {getStatusDot(screenState)}
            {screenState === 'on' ? 'Stop Screen' : screenState === 'starting' ? 'Starting...' : 'Share Screen'}
          </button>
        </div>

        {/* Instructions */}
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 16, marginBottom: 0 }}>
          {audioState === 'on' ? (
            <>
              Listening... Speak naturally and pause when done. Your speech will be automatically detected and sent
              to the LLM
              {(videoState === 'on' || screenState === 'on') && ' along with captured frames'}.
            </>
          ) : (
            <>Start by sharing your audio. Video and screen sharing require audio to be active first.</>
          )}
        </p>
      </div>

      {/* Output Section */}
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 14, color: '#374151' }}>You said:</h3>
          <div
            data-testid="transcript"
            style={{
              background: '#f3f4f6',
              padding: 16,
              borderRadius: 8,
              minHeight: 50,
              fontSize: 15,
              color: transcript ? '#111827' : '#9ca3af'
            }}
          >
            {transcript || 'Your transcribed speech will appear here...'}
          </div>
        </div>

        <div>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 14, color: '#374151' }}>Assistant:</h3>
          <div
            data-testid="llm-response"
            style={{
              background: '#eff6ff',
              padding: 16,
              borderRadius: 8,
              minHeight: 50,
              fontSize: 15,
              color: streaming || llmText ? '#111827' : '#9ca3af'
            }}
          >
            {streaming || llmText || 'Assistant response will appear here...'}
          </div>
        </div>

        <div>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 14, color: '#374151' }}>
            Audio Response:
            {ttsStatus === 'playing' && (
              <span data-testid="tts-status" style={{ marginLeft: 8, color: '#22c55e', fontSize: 12 }}>● Playing via WebRTC</span>
            )}
          </h3>
          {/* WebRTC MediaStreamTrack audio (preferred) */}
          <audio ref={ttsAudioRef} autoPlay style={{ display: 'none' }} />
          {/* Fallback audio for base64-encoded TTS */}
          <audio ref={audioRef} controls style={{ width: '100%' }} />
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
