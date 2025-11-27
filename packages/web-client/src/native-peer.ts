import EventEmitter from 'eventemitter3';

export interface NativePeerConfig {
  iceServers: RTCIceServer[];
  /** If false, wait for all ICE candidates before signaling (default: false) */
  trickle?: boolean;
}

export interface NativePeerEvents {
  signal: (description: RTCSessionDescriptionInit) => void;
  connect: () => void;
  close: () => void;
  error: (error: Error) => void;
  data: (data: string | ArrayBuffer) => void;
  track: (track: MediaStreamTrack, stream: MediaStream) => void;
  connectionStateChange: (state: RTCPeerConnectionState) => void;
  iceStateChange: (state: RTCIceConnectionState) => void;
}

/**
 * NativePeer wraps RTCPeerConnection with a simple-peer-like API.
 * This provides a clean abstraction while using native WebRTC APIs,
 * making the code portable to React Native with minimal changes.
 */
export class NativePeer extends EventEmitter<NativePeerEvents> {
  private pc: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private isInitiator: boolean;
  private trickle: boolean;
  private gatheringResolve: (() => void) | null = null;
  private gatheringTimeout: ReturnType<typeof setTimeout> | null = null;
  private _destroyed = false;
  private _signalingComplete = false; // Don't emit ICE errors until signaling is done
  private _isNegotiating = false; // Prevent concurrent negotiations

  constructor(config: NativePeerConfig, initiator: boolean = true) {
    super();
    this.isInitiator = initiator;
    this.trickle = config.trickle ?? false;

    this.pc = new RTCPeerConnection({
      iceServers: config.iceServers
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // ICE gathering state (for trickle: false mode)
    this.pc.onicegatheringstatechange = () => {
      console.log('[native-peer] ICE gathering state:', this.pc.iceGatheringState);
      if (this.pc.iceGatheringState === 'complete') {
        this.resolveGathering();
      }
    };

    // Also use icecandidate with null to detect gathering complete (more reliable in some browsers)
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[native-peer] ICE candidate gathered:', event.candidate.type, event.candidate.address);
      } else {
        console.log('[native-peer] ICE gathering complete (null candidate)');
        this.resolveGathering();
      }
    };

    // Connection state changes
    this.pc.onconnectionstatechange = () => {
      console.log('[native-peer] Connection state:', this.pc.connectionState);
      this.emit('connectionStateChange', this.pc.connectionState);

      // Only emit errors after signaling is complete
      if (this.pc.connectionState === 'failed' && this._signalingComplete) {
        this.emit('error', new Error('WebRTC connection failed'));
      } else if (this.pc.connectionState === 'closed') {
        this.emit('close');
      }
    };

    // ICE connection state (more granular)
    this.pc.oniceconnectionstatechange = () => {
      console.log('[native-peer] ICE connection state:', this.pc.iceConnectionState);
      this.emit('iceStateChange', this.pc.iceConnectionState);

      // Handle ICE states after signaling is complete
      if (this._signalingComplete) {
        if (this.pc.iceConnectionState === 'connected' || this.pc.iceConnectionState === 'completed') {
          console.log('[native-peer] ICE connection established!');
        } else if (this.pc.iceConnectionState === 'failed') {
          console.log('[native-peer] ICE connection failed after signaling, attempting restart');
          this.pc.restartIce();
        }
      }
    };

    // Incoming data channel (for non-initiator)
    this.pc.ondatachannel = (event) => {
      console.log('[native-peer] Received data channel');
      this.setupDataChannel(event.channel);
    };

    // Incoming tracks
    this.pc.ontrack = (event) => {
      console.log('[native-peer] Received track:', event.track.kind);
      const stream = event.streams[0] || new MediaStream([event.track]);
      this.emit('track', event.track, stream);
    };

    // Handle renegotiation needed (when tracks are added/removed)
    this.pc.onnegotiationneeded = async () => {
      console.log('[native-peer] Negotiation needed, signalingComplete:', this._signalingComplete, 'isNegotiating:', this._isNegotiating);
      if (this._signalingComplete && !this._destroyed && !this._isNegotiating) {
        try {
          await this.renegotiate();
        } catch (err) {
          console.error('[native-peer] Renegotiation failed:', err);
        }
      }
    };
  }

  /**
   * Renegotiate the connection (used when tracks are added/removed).
   */
  private async renegotiate(): Promise<void> {
    if (this._isNegotiating) {
      console.log('[native-peer] Already negotiating, skipping');
      return;
    }

    this._isNegotiating = true;
    console.log('[native-peer] Starting renegotiation');

    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      // Wait for ICE gathering
      if (!this.trickle) {
        await this.waitForIceGathering();
      }

      if (this.pc.localDescription) {
        console.log('[native-peer] Emitting renegotiation offer');
        this.emit('signal', this.pc.localDescription);
      }
    } finally {
      this._isNegotiating = false;
    }
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;

    channel.onopen = () => {
      console.log('[native-peer] Data channel opened');
      this.emit('connect');
    };

    channel.onclose = () => {
      console.log('[native-peer] Data channel closed');
      if (!this._destroyed) {
        this.emit('close');
      }
    };

    channel.onerror = (event) => {
      console.error('[native-peer] Data channel error:', event);
      this.emit('error', new Error('Data channel error'));
    };

    channel.onmessage = (event) => {
      this.emit('data', event.data);
    };
  }

  private resolveGathering(): void {
    if (this.gatheringTimeout) {
      clearTimeout(this.gatheringTimeout);
      this.gatheringTimeout = null;
    }
    if (this.gatheringResolve) {
      this.gatheringResolve();
      this.gatheringResolve = null;
    }
  }

  private waitForIceGathering(): Promise<void> {
    if (this.pc.iceGatheringState === 'complete') {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.gatheringResolve = resolve;

      // Shorter timeout - ICE gathering should complete quickly on localhost
      this.gatheringTimeout = setTimeout(() => {
        if (this.gatheringResolve) {
          console.warn('[native-peer] ICE gathering timeout, proceeding anyway');
          this.gatheringResolve();
          this.gatheringResolve = null;
        }
        this.gatheringTimeout = null;
      }, 3000); // 3 seconds should be enough for localhost
    });
  }

  /**
   * Create and emit an SDP offer (initiator side).
   * For trickle: false, waits for ICE gathering to complete.
   */
  async createOffer(): Promise<void> {
    if (!this.isInitiator) {
      throw new Error('Only initiator can create offer');
    }

    // Create data channel first (initiator creates it)
    this.dataChannel = this.pc.createDataChannel('data', {
      ordered: true
    });
    this.setupDataChannel(this.dataChannel);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // Wait for ICE gathering to complete (trickle: false)
    if (!this.trickle) {
      await this.waitForIceGathering();
    }

    // Emit the complete offer with ICE candidates baked in
    if (this.pc.localDescription) {
      console.log('[native-peer] Emitting offer signal');
      this.emit('signal', this.pc.localDescription);
    }
  }

  /**
   * Handle incoming signal (offer or answer).
   */
  async signal(description: RTCSessionDescriptionInit): Promise<void> {
    console.log('[native-peer] Received signal:', description.type);

    if (description.type === 'offer') {
      await this.handleOffer(description);
    } else if (description.type === 'answer') {
      await this.handleAnswer(description);
    }
  }

  private async handleOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    // Wait for ICE gathering (trickle: false)
    if (!this.trickle) {
      await this.waitForIceGathering();
    }

    if (this.pc.localDescription) {
      console.log('[native-peer] Emitting answer signal');
      this.emit('signal', this.pc.localDescription);
    }
  }

  private async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(answer);
    this._signalingComplete = true;
    console.log('[native-peer] Answer set, signaling complete, connection should establish');

    // If ICE is already failed, try to restart it
    if (this.pc.iceConnectionState === 'failed') {
      console.log('[native-peer] ICE was in failed state, attempting restart');
      this.pc.restartIce();
    }
  }

  /**
   * Add a media track to the connection.
   */
  addTrack(track: MediaStreamTrack, stream: MediaStream): RTCRtpSender {
    console.log('[native-peer] Adding track:', track.kind);
    return this.pc.addTrack(track, stream);
  }

  /**
   * Remove a media track from the connection.
   */
  removeTrack(sender: RTCRtpSender): void {
    this.pc.removeTrack(sender);
  }

  /**
   * Send data over the data channel.
   */
  send(data: string | ArrayBuffer): void {
    if (this.dataChannel?.readyState !== 'open') {
      throw new Error('Data channel not open');
    }
    this.dataChannel.send(data as string);
  }

  /**
   * Check if the connection is established and data channel is open.
   */
  get connected(): boolean {
    return (
      this.pc.connectionState === 'connected' &&
      this.dataChannel?.readyState === 'open'
    );
  }

  /**
   * Check if the peer has been destroyed.
   */
  get destroyed(): boolean {
    return this._destroyed;
  }

  /**
   * Get the underlying RTCPeerConnection for advanced use.
   */
  get peerConnection(): RTCPeerConnection {
    return this.pc;
  }

  /**
   * Get the signaling state.
   */
  get signalingState(): RTCSignalingState {
    return this.pc.signalingState;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    if (this._destroyed) return;

    this._destroyed = true;
    console.log('[native-peer] Destroying peer');

    this.gatheringResolve = null;
    if (this.gatheringTimeout) {
      clearTimeout(this.gatheringTimeout);
      this.gatheringTimeout = null;
    }

    if (this.dataChannel) {
      this.dataChannel.onopen = null;
      this.dataChannel.onclose = null;
      this.dataChannel.onerror = null;
      this.dataChannel.onmessage = null;
      this.dataChannel.close();
      this.dataChannel = null;
    }

    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.onicegatheringstatechange = null;
    this.pc.ondatachannel = null;
    this.pc.ontrack = null;
    this.pc.onicecandidate = null;
    this.pc.close();

    this.removeAllListeners();
  }
}
