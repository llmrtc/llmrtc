/**
 * Behavioral tests for LLMRTCWebClient against a scripted signaling server.
 * The WebRTC peer is faked (Node has no RTCPeerConnection); everything else
 * - WebSocket signaling, ready/reconnect flow, state machine, lifecycle -
 * is the real implementation. Node's global WebSocket serves as the browser
 * WebSocket.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebSocketServer, WebSocket as ServerWebSocket } from 'ws';
import type { AddressInfo } from 'net';

vi.mock('../src/native-peer.js', async () => {
  // vi.mock factories are hoisted above imports, so pull in the emitter here
  const { default: EventEmitter } = await import('eventemitter3');
  class FakeNativePeer extends EventEmitter {
    destroyed = false;
    private _connected = false;

    get connected() {
      return this._connected;
    }
    get signalingState() {
      return 'stable';
    }

    async createOffer() {
      this.emit('signal', { type: 'offer', sdp: 'fake-offer' });
    }

    async signal(description: { type: string }) {
      if (description.type === 'answer') {
        this._connected = true;
        this.emit('connect');
      }
    }

    addTrack() {
      return {} as RTCRtpSender;
    }
    removeTrack() {}
    send(_data: string) {}
    destroy() {
      this.destroyed = true;
      this._connected = false;
      this.removeAllListeners();
    }
  }
  return { NativePeer: FakeNativePeer };
});

import { LLMRTCWebClient } from '../src/index.js';

interface ScriptedServer {
  port: number;
  /** Message log per connection, in arrival order */
  connectionLogs: string[][];
  sockets: ServerWebSocket[];
  close: () => Promise<void>;
  knownSessions: Set<string>;
}

/** A minimal protocol-conformant signaling server for driving the client. */
function startScriptedServer(): Promise<ScriptedServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    const connectionLogs: string[][] = [];
    const sockets: ServerWebSocket[] = [];
    const knownSessions = new Set<string>();
    let connCounter = 0;

    wss.on('connection', (ws) => {
      const log: string[] = [];
      connectionLogs.push(log);
      sockets.push(ws);
      const sessionId = `session-${connCounter++}`;
      knownSessions.add(sessionId);

      ws.send(
        JSON.stringify({ type: 'ready', id: sessionId, protocolVersion: 1, iceServers: [] })
      );

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        log.push(msg.type);

        switch (msg.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
            break;
          case 'reconnect': {
            const success = knownSessions.has(msg.sessionId);
            ws.send(
              JSON.stringify({
                type: 'reconnect-ack',
                success,
                sessionId: success ? msg.sessionId : sessionId,
                historyRecovered: success
              })
            );
            break;
          }
          case 'offer':
            ws.send(JSON.stringify({ type: 'signal', signal: { type: 'answer', sdp: 'fake' } }));
            break;
        }
      });
    });

    wss.on('listening', () => {
      resolve({
        port: (wss.address() as AddressInfo).port,
        connectionLogs,
        sockets,
        knownSessions,
        close: () =>
          new Promise<void>((res) => {
            sockets.forEach((s) => s.terminate());
            wss.close(() => res());
          })
      });
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('LLMRTCWebClient behavior', () => {
  let server: ScriptedServer | null = null;
  let client: LLMRTCWebClient | null = null;

  afterEach(async () => {
    client?.close();
    client = null;
    await server?.close();
    server = null;
  });

  it('connects and reaches the connected state', async () => {
    server = await startScriptedServer();
    client = new LLMRTCWebClient({ signallingUrl: `ws://127.0.0.1:${server.port}` });

    await client.start();

    expect(client.state).toBe('connected');
    expect(client.currentSessionId).toBe('session-0');
    expect(server.connectionLogs[0]).toContain('offer');
  });

  it('sends reconnect before the offer when resuming a session', async () => {
    server = await startScriptedServer();
    client = new LLMRTCWebClient({
      signallingUrl: `ws://127.0.0.1:${server.port}`,
      reconnection: { enabled: true, baseDelayMs: 30, jitterFactor: 0, maxRetries: 3 }
    });

    const recovered: boolean[] = [];
    client.on('reconnected', (historyRecovered) => recovered.push(historyRecovered));

    await client.start();
    const originalSession = client.currentSessionId;

    // Sever the connection server-side to trigger reconnection
    server.sockets[0].terminate();
    // Wait for the full cycle: a second connection is made and completes
    await vi.waitFor(() => {
      expect(server!.connectionLogs.length).toBe(2);
      expect(client!.state).toBe('connected');
    }, { timeout: 5000 });

    // The second connection resumed the session before negotiating
    const log = server.connectionLogs[1];
    expect(log.indexOf('reconnect')).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('offer')).toBeGreaterThan(log.indexOf('reconnect'));

    // History recovery outcome surfaced, and the session id was preserved
    expect(recovered).toEqual([true]);
    expect(client.currentSessionId).toBe(originalSession);
  });

  it('does not resurrect the connection when closed mid-reconnect', async () => {
    server = await startScriptedServer();
    client = new LLMRTCWebClient({
      signallingUrl: `ws://127.0.0.1:${server.port}`,
      reconnection: { enabled: true, baseDelayMs: 30, jitterFactor: 0, maxRetries: 5 }
    });

    await client.start();
    const statesAfterClose: string[] = [];

    // Sever the connection, then hang up while the client is backing off
    server.sockets[0].terminate();
    await sleep(5);
    client.close();
    client.on('stateChange', (s) => statesAfterClose.push(s));

    const connectionsAtClose = server.connectionLogs.length;
    await sleep(300);

    // No new connection was opened and the state never left closed
    expect(server.connectionLogs.length).toBe(connectionsAtClose);
    expect(client.state).toBe('closed');
    expect(statesAfterClose).toEqual([]);
  });

  it('can be started again after close()', async () => {
    server = await startScriptedServer();
    client = new LLMRTCWebClient({ signallingUrl: `ws://127.0.0.1:${server.port}` });

    await client.start();
    client.close();
    expect(client.state).toBe('closed');

    await client.start();
    expect(client.state).toBe('connected');
  });

  it('can be started again after reaching the failed state', async () => {
    server = await startScriptedServer();
    const deadPort = server.port;
    await server.close();

    client = new LLMRTCWebClient({
      signallingUrl: `ws://127.0.0.1:${deadPort}`,
      reconnection: { enabled: false }
    });

    await expect(client.start()).rejects.toThrow();
    expect(client.state).toBe('failed');

    // Bring a server up on a fresh port and restart the same client instance
    server = await startScriptedServer();
    (client as unknown as { config: { signallingUrl: string } }).config.signallingUrl =
      `ws://127.0.0.1:${server.port}`;
    await client.start();
    expect(client.state).toBe('connected');
  });

  it('sendAudio requires an open signaling channel', async () => {
    server = await startScriptedServer();
    client = new LLMRTCWebClient({ signallingUrl: `ws://127.0.0.1:${server.port}` });

    expect(() => client!.sendAudio(new ArrayBuffer(4))).toThrow(/not open/);

    await client.start();
    client.sendAudio(new ArrayBuffer(4));
    await vi.waitFor(() => {
      expect(server!.connectionLogs[0]).toContain('audio');
    });
  });
});

describe('ConnectionStateMachine', () => {
  it('allows restarting from closed', async () => {
    const { ConnectionStateMachine, ConnectionState } = await import(
      '../src/connection-state.js'
    );
    const sm = new ConnectionStateMachine();
    sm.transition(ConnectionState.CONNECTING);
    sm.transition(ConnectionState.CONNECTED);
    sm.transition(ConnectionState.CLOSED);
    sm.transition(ConnectionState.CONNECTING);
    expect(sm.state).toBe(ConnectionState.CONNECTING);
  });

  it('resetRetries restores the retry budget without changing state', async () => {
    const { ConnectionStateMachine, ConnectionState } = await import(
      '../src/connection-state.js'
    );
    const sm = new ConnectionStateMachine({ maxRetries: 1 });
    sm.transition(ConnectionState.CONNECTING);
    expect(sm.getNextRetryDelay()).not.toBeNull();
    expect(sm.getNextRetryDelay()).toBeNull();
    sm.resetRetries();
    expect(sm.getNextRetryDelay()).not.toBeNull();
    expect(sm.state).toBe(ConnectionState.CONNECTING);
  });
});
