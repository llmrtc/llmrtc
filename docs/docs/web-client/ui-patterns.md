---
title: UI Patterns
---

Common UI patterns for building voice AI interfaces with the LLMRTC web client.

---

## State Indicator

Display connection and conversation state:

```typescript
type AppState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

function VoiceStateIndicator({ client }: { client: LLMRTCWebClient }) {
  const [state, setState] = useState<AppState>('idle');

  useEffect(() => {
    client.on('stateChange', (connState) => {
      if (connState !== 'connected') {
        setState('idle');
      }
    });

    client.on('speechStart', () => setState('listening'));
    client.on('speechEnd', () => setState('processing'));
    client.on('ttsStart', () => setState('speaking'));
    client.on('ttsComplete', () => setState('idle'));
    client.on('ttsCancelled', () => setState('listening'));
    client.on('error', () => setState('error'));
  }, [client]);

  return (
    <div className={`indicator ${state}`}>
      {state === 'idle' && '🎤 Ready'}
      {state === 'listening' && '👂 Listening...'}
      {state === 'processing' && '🤔 Thinking...'}
      {state === 'speaking' && '🔊 Speaking...'}
      {state === 'error' && '❌ Error'}
    </div>
  );
}
```

### CSS

```css
.indicator {
  padding: 8px 16px;
  border-radius: 20px;
  font-weight: 500;
  transition: all 0.2s;
}

.indicator.idle { background: #e0e0e0; }
.indicator.listening { background: #4caf50; color: white; }
.indicator.processing { background: #2196f3; color: white; }
.indicator.speaking { background: #ff9800; color: white; }
.indicator.error { background: #f44336; color: white; }
```

---

## Transcript Display

Show user and assistant messages:

```typescript
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

function TranscriptDisplay({ client }: { client: LLMRTCWebClient }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentAssistant, setCurrentAssistant] = useState('');

  useEffect(() => {
    client.on('transcript', (text) => {
      setMessages(prev => [...prev, {
        role: 'user',
        content: text,
        timestamp: new Date()
      }]);
    });

    client.on('llmChunk', (chunk) => {
      setCurrentAssistant(prev => prev + chunk);
    });

    client.on('ttsComplete', () => {
      if (currentAssistant) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: currentAssistant,
          timestamp: new Date()
        }]);
        setCurrentAssistant('');
      }
    });
  }, [client]);

  return (
    <div className="transcript">
      {messages.map((msg, i) => (
        <div key={i} className={`message ${msg.role}`}>
          <span className="role">{msg.role}</span>
          <p>{msg.content}</p>
        </div>
      ))}
      {currentAssistant && (
        <div className="message assistant streaming">
          <span className="role">assistant</span>
          <p>{currentAssistant}</p>
        </div>
      )}
    </div>
  );
}
```

### CSS

```css
.transcript {
  max-height: 400px;
  overflow-y: auto;
  padding: 16px;
}

.message {
  margin-bottom: 12px;
  padding: 12px;
  border-radius: 8px;
}

.message.user {
  background: #e3f2fd;
  margin-left: 40px;
}

.message.assistant {
  background: #f5f5f5;
  margin-right: 40px;
}

.message.streaming {
  border-left: 3px solid #2196f3;
}

.role {
  font-size: 12px;
  text-transform: uppercase;
  color: #666;
}
```

---

## Audio Level Meter

Visualize microphone input:

```typescript
function AudioLevelMeter({ stream }: { stream: MediaStream | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    if (!stream || !canvasRef.current) return;

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function draw() {
      if (!analyserRef.current) return;

      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      const level = average / 255;

      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = canvas.width * level;
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
      gradient.addColorStop(0, '#4caf50');
      gradient.addColorStop(0.7, '#ffeb3b');
      gradient.addColorStop(1, '#f44336');

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, barWidth, canvas.height);

      requestAnimationFrame(draw);
    }

    draw();

    return () => {
      audioContext.close();
      analyserRef.current = null;
    };
  }, [stream]);

  return <canvas ref={canvasRef} width={200} height={20} />;
}
```

---

## Push-to-Talk Button

Alternative to continuous listening:

```typescript
function PushToTalkButton({ client }: { client: LLMRTCWebClient }) {
  const [isPressed, setIsPressed] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const controllerRef = useRef<{ stop: () => void } | null>(null);

  const handlePress = async () => {
    if (!streamRef.current) {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: true
      });
    }

    controllerRef.current = await client.shareAudio(streamRef.current);
    setIsPressed(true);
  };

  const handleRelease = () => {
    controllerRef.current?.stop();
    setIsPressed(false);
  };

  return (
    <button
      className={`ptt-button ${isPressed ? 'pressed' : ''}`}
      onMouseDown={handlePress}
      onMouseUp={handleRelease}
      onMouseLeave={handleRelease}
      onTouchStart={handlePress}
      onTouchEnd={handleRelease}
    >
      {isPressed ? 'Release to send' : 'Hold to talk'}
    </button>
  );
}
```

### CSS

```css
.ptt-button {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  border: none;
  background: #2196f3;
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.ptt-button:hover {
  background: #1976d2;
}

.ptt-button.pressed {
  background: #f44336;
  transform: scale(1.1);
}
```

---

## Connection Status Banner

Show connection problems:

```typescript
function ConnectionBanner({ client }: { client: LLMRTCWebClient }) {
  const [status, setStatus] = useState<{
    state: ConnectionState;
    attempt?: number;
    maxAttempts?: number;
  }>({ state: 'disconnected' });

  useEffect(() => {
    client.on('stateChange', (state) => {
      setStatus({ state });
    });

    client.on('reconnecting', (attempt, maxAttempts) => {
      setStatus({ state: 'reconnecting', attempt, maxAttempts });
    });
  }, [client]);

  if (status.state === 'connected') return null;

  return (
    <div className={`connection-banner ${status.state}`}>
      {status.state === 'connecting' && 'Connecting...'}
      {status.state === 'reconnecting' && (
        `Reconnecting (${status.attempt}/${status.maxAttempts})...`
      )}
      {status.state === 'failed' && (
        <>
          Connection failed.
          <button onClick={() => client.start()}>Retry</button>
        </>
      )}
      {status.state === 'disconnected' && 'Disconnected'}
    </div>
  );
}
```

### CSS

```css
.connection-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  padding: 12px;
  text-align: center;
  color: white;
  z-index: 1000;
}

.connection-banner.connecting,
.connection-banner.reconnecting {
  background: #ff9800;
}

.connection-banner.failed,
.connection-banner.disconnected {
  background: #f44336;
}

.connection-banner button {
  margin-left: 12px;
  padding: 4px 12px;
  background: white;
  color: #f44336;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
```

---

## Tool Call Indicator

Show when tools are executing:

```typescript
function ToolCallIndicator({ client }: { client: LLMRTCWebClient }) {
  const [activeTool, setActiveTool] = useState<string | null>(null);

  useEffect(() => {
    client.on('toolCallStart', ({ name }) => {
      setActiveTool(name);
    });

    client.on('toolCallEnd', () => {
      setActiveTool(null);
    });
  }, [client]);

  if (!activeTool) return null;

  return (
    <div className="tool-indicator">
      <span className="spinner" />
      Running: {activeTool}
    </div>
  );
}
```

### CSS

```css
.tool-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #e3f2fd;
  border-radius: 4px;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #2196f3;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

---

## Stage Progress (Playbooks)

Show current playbook stage:

```typescript
const STAGES = ['greeting', 'auth', 'triage', 'resolution', 'farewell'];

function StageProgress({ client }: { client: LLMRTCWebClient }) {
  const [currentStage, setCurrentStage] = useState('greeting');

  useEffect(() => {
    client.on('stageChange', ({ to }) => {
      setCurrentStage(to);
    });
  }, [client]);

  const currentIndex = STAGES.indexOf(currentStage);

  return (
    <div className="stage-progress">
      {STAGES.map((stage, i) => (
        <div
          key={stage}
          className={`stage ${i < currentIndex ? 'completed' : ''} ${i === currentIndex ? 'current' : ''}`}
        >
          <div className="dot" />
          <span>{stage}</span>
        </div>
      ))}
    </div>
  );
}
```

### CSS

```css
.stage-progress {
  display: flex;
  gap: 24px;
}

.stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  opacity: 0.5;
}

.stage.completed,
.stage.current {
  opacity: 1;
}

.stage .dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #e0e0e0;
}

.stage.completed .dot {
  background: #4caf50;
}

.stage.current .dot {
  background: #2196f3;
  box-shadow: 0 0 0 4px rgba(33, 150, 243, 0.3);
}
```

---

## Mute Toggle

Control microphone muting:

```typescript
function MuteToggle({ stream }: { stream: MediaStream | null }) {
  const [isMuted, setIsMuted] = useState(false);

  const toggle = () => {
    if (!stream) return;

    const track = stream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    setIsMuted(!track.enabled);
  };

  return (
    <button
      className={`mute-button ${isMuted ? 'muted' : ''}`}
      onClick={toggle}
      disabled={!stream}
    >
      {isMuted ? '🔇 Unmute' : '🎤 Mute'}
    </button>
  );
}
```

---

## Keyboard Shortcuts

Add keyboard controls:

```typescript
function useVoiceKeyboardShortcuts(client: LLMRTCWebClient) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space to toggle (when not typing)
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        // Toggle mic
      }

      // Escape to stop
      if (e.code === 'Escape') {
        client.close();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [client]);
}
```

---

## Accessibility

Important accessibility considerations:

```typescript
function AccessibleVoiceUI({ client }: { client: LLMRTCWebClient }) {
  const [status, setStatus] = useState('');

  useEffect(() => {
    client.on('speechStart', () => setStatus('Listening to your speech'));
    client.on('speechEnd', () => setStatus('Processing your request'));
    client.on('ttsStart', () => setStatus('Assistant is responding'));
    client.on('ttsComplete', () => setStatus('Ready for your next message'));
  }, [client]);

  return (
    <>
      {/* Screen reader announcements */}
      <div role="status" aria-live="polite" className="sr-only">
        {status}
      </div>

      {/* Visible controls with proper labels */}
      <button aria-label="Start voice conversation">
        Start
      </button>
    </>
  );
}
```

### CSS

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

---

## Related Documentation

- [Overview](overview) - Client architecture
- [Events](events) - Event reference
- [Audio](audio) - Audio handling
- [Video & Vision](video-and-vision) - Video capture
