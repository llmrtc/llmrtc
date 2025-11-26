import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { LLMRTCWebClient, FrameCaptureController } from '@metered/llmrtc-web-client';

const signallingDefault = import.meta.env.VITE_SIGNAL_URL || 'ws://localhost:8787';

type MediaState = 'off' | 'starting' | 'on';

function App() {
  const clientRef = useRef<LLMRTCWebClient | null>(null);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [signalUrl, setSignalUrl] = useState(signallingDefault);
  const [transcript, setTranscript] = useState('');
  const [llmText, setLlmText] = useState('');
  const [streaming, setStreaming] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);

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
      const blob = new Blob([buffer], { type: format === 'wav' ? 'audio/wav' : 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play().catch(() => undefined);
      }
    });
    c.on('error', (msg) => console.error('[client error]', msg));
    return c;
  }, [signalUrl]);

  useEffect(() => {
    clientRef.current = client;
    return () => client.close();
  }, [client]);

  const connect = async () => {
    setStatus('connecting');
    try {
      await client.start();
      setStatus('connected');
    } catch (err) {
      console.error('Connection failed:', err);
      setStatus('disconnected');
    }
  };

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
        const ctrl = await client.shareAudio(stream, {
          vadThreshold: 0.02,
          vadSilenceMs: 700,
          chunkMs: 400
        });
        audioCtrlRef.current = ctrl;
        setAudioState('on');
      } catch (err) {
        console.error('Failed to start audio:', err);
        setAudioState('off');
      }
    }
  }, [audioState, videoState, screenState, client]);

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
      <h1 style={{ marginBottom: 8 }}>@metered/LLMRTC</h1>
      <p style={{ color: '#666', marginTop: 0, marginBottom: 24 }}>
        Real-time voice + vision conversation with LLM
      </p>

      {/* Connection Section */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          padding: 16,
          background: '#f9fafb',
          borderRadius: 12,
          marginBottom: 24
        }}
      >
        <input
          value={signalUrl}
          onChange={(e) => setSignalUrl(e.target.value)}
          style={{ flex: 1, padding: '10px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14 }}
          placeholder="wss://your-signal-host"
          disabled={status === 'connected'}
        />
        <button
          onClick={connect}
          disabled={status !== 'disconnected'}
          style={{
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 500,
            border: 'none',
            borderRadius: 6,
            cursor: status === 'disconnected' ? 'pointer' : 'default',
            backgroundColor: status === 'connected' ? '#22c55e' : status === 'connecting' ? '#fbbf24' : '#3b82f6',
            color: '#fff'
          }}
        >
          {status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting...' : 'Connect'}
        </button>
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
            onClick={toggleAudio}
            disabled={status !== 'connected' || audioState === 'starting'}
            style={{
              ...getButtonStyle(audioState),
              opacity: status !== 'connected' ? 0.5 : 1
            }}
          >
            {getStatusDot(audioState)}
            {audioState === 'on' ? 'Stop Audio' : audioState === 'starting' ? 'Starting...' : 'Share Audio'}
          </button>

          {/* Video Button */}
          <button
            onClick={toggleVideo}
            disabled={status !== 'connected' || videoState === 'starting' || audioState !== 'on'}
            style={{
              ...getButtonStyle(videoState, audioState !== 'on'),
              opacity: status !== 'connected' || audioState !== 'on' ? 0.5 : 1
            }}
          >
            {getStatusDot(videoState)}
            {videoState === 'on' ? 'Stop Video' : videoState === 'starting' ? 'Starting...' : 'Share Video'}
          </button>

          {/* Screen Button */}
          <button
            onClick={toggleScreen}
            disabled={status !== 'connected' || screenState === 'starting' || audioState !== 'on'}
            style={{
              ...getButtonStyle(screenState, audioState !== 'on'),
              opacity: status !== 'connected' || audioState !== 'on' ? 0.5 : 1
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
          <h3 style={{ margin: '0 0 8px 0', fontSize: 14, color: '#374151' }}>Audio Response:</h3>
          <audio ref={audioRef} controls style={{ width: '100%' }} />
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
