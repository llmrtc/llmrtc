import { EventEmitter } from 'events';

export interface NativePeerServerConfig {
  /** The @roamhq/wrtc module */
  wrtcLib: any;
  /** ICE servers configuration */
  iceServers?: RTCIceServer[];
}

export interface AudioData {
  samples: Int16Array;
  sampleRate: number;
  bitsPerSample: number;
  channelCount: number;
  numberOfFrames: number;
}

/**
 * NativePeerServer wraps RTCPeerConnection for server-side WebRTC.
 * Uses @roamhq/wrtc for Node.js WebRTC support including
 * RTCAudioSink and RTCAudioSource for audio processing.
 */
export class NativePeerServer extends EventEmitter {
  private pc: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private audioSink: any = null;
  private audioSource: any = null;
  private ttsTrack: MediaStreamTrack | null = null;
  private wrtc: any;
  private gatheringResolve: (() => void) | null = null;
  private gatheringTimeout: ReturnType<typeof setTimeout> | null = null;
  private _destroyed = false;

  constructor(private config: NativePeerServerConfig) {
    super();

    this.wrtc = config.wrtcLib;
    const { RTCPeerConnection } = this.wrtc;

    this.pc = new RTCPeerConnection({
      iceServers: config.iceServers ?? []
    });

    this.setupEventHandlers();
    this.setupTTSAudioSource();
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

  private setupEventHandlers(): void {
    // ICE gathering state
    this.pc.onicegatheringstatechange = () => {
      console.log(
        '[native-peer-server] ICE gathering state:',
        this.pc.iceGatheringState
      );
      if (this.pc.iceGatheringState === 'complete') {
        this.resolveGathering();
      }
    };

    // Connection state changes
    this.pc.onconnectionstatechange = () => {
      console.log(
        '[native-peer-server] Connection state:',
        this.pc.connectionState
      );
      this.emit('connectionStateChange', this.pc.connectionState);

      if (
        this.pc.connectionState === 'failed' ||
        this.pc.connectionState === 'disconnected'
      ) {
        this.emit('disconnected');
      }

      if (this.pc.connectionState === 'closed') {
        this.emit('close');
      }
    };

    // ICE connection state
    this.pc.oniceconnectionstatechange = () => {
      console.log(
        '[native-peer-server] ICE connection state:',
        this.pc.iceConnectionState
      );
      this.emit('iceStateChange', this.pc.iceConnectionState);
    };

    // Incoming data channel
    this.pc.ondatachannel = (event: RTCDataChannelEvent) => {
      console.log('[native-peer-server] Received data channel');
      this.setupDataChannel(event.channel);
    };

    // Incoming tracks
    this.pc.ontrack = (event: RTCTrackEvent) => {
      const track = event.track;
      console.log('[native-peer-server] Received track:', track.kind);

      if (track.kind === 'audio') {
        this.setupAudioSink(track);
      }

      const stream = event.streams[0] || new this.wrtc.MediaStream([track]);
      this.emit('track', track, stream);
    };
  }

  private setupTTSAudioSource(): void {
    console.log('[native-peer-server] wrtc.nonstandard:', this.wrtc.nonstandard ? 'exists' : 'undefined');
    const nonstandard = this.wrtc.nonstandard;
    const RTCAudioSource = nonstandard?.RTCAudioSource;
    const MediaStream = nonstandard?.MediaStream || this.wrtc.MediaStream;

    console.log('[native-peer-server] RTCAudioSource:', RTCAudioSource ? 'exists' : 'undefined');
    console.log('[native-peer-server] MediaStream:', MediaStream ? 'exists' : 'undefined');

    if (RTCAudioSource && MediaStream) {
      this.audioSource = new RTCAudioSource();
      const track = this.audioSource.createTrack();
      this.ttsTrack = track;

      // Add TTS track to peer connection for sending audio to client
      const stream = new MediaStream([track]);
      this.pc.addTrack(track, stream);

      console.log('[native-peer-server] TTS audio source created and track added');
    } else {
      console.warn('[native-peer-server] RTCAudioSource not available');
    }
  }

  private setupAudioSink(track: MediaStreamTrack): void {
    const { RTCAudioSink } = this.wrtc.nonstandard || {};

    if (RTCAudioSink) {
      this.audioSink = new RTCAudioSink(track);

      this.audioSink.ondata = (data: AudioData) => {
        this.emit('audioData', data);
      };

      console.log('[native-peer-server] Audio sink set up');
    } else {
      console.warn('[native-peer-server] RTCAudioSink not available');
    }
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;

    channel.onopen = () => {
      console.log('[native-peer-server] Data channel opened');
      this.emit('connect');
    };

    channel.onclose = () => {
      console.log('[native-peer-server] Data channel closed');
      if (!this._destroyed) {
        this.emit('close');
      }
    };

    channel.onerror = (event) => {
      console.error('[native-peer-server] Data channel error:', event);
      this.emit('error', new Error('Data channel error'));
    };

    channel.onmessage = (event) => {
      this.emit('data', event.data);
    };
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
          console.warn(
            '[native-peer-server] ICE gathering timeout, proceeding anyway'
          );
          this.gatheringResolve();
          this.gatheringResolve = null;
        }
        this.gatheringTimeout = null;
      }, 3000);
    });
  }

  /**
   * Handle incoming offer and return answer.
   * Waits for ICE gathering to complete (trickle: false).
   */
  async handleOffer(
    offer: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescriptionInit> {
    console.log('[native-peer-server] Handling offer');

    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    // Wait for ICE gathering to complete
    await this.waitForIceGathering();

    console.log('[native-peer-server] Answer created with ICE candidates');
    return this.pc.localDescription!;
  }

  /**
   * Send data over the data channel.
   */
  send(data: string): void {
    if (this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(data);
    }
  }

  /**
   * Check if connected.
   */
  get connected(): boolean {
    return (
      this.pc.connectionState === 'connected' &&
      this.dataChannel?.readyState === 'open'
    );
  }

  /**
   * Check if destroyed.
   */
  get destroyed(): boolean {
    return this._destroyed;
  }

  /**
   * Get the TTS audio source for feeding audio.
   */
  get ttsAudioSource(): any {
    return this.audioSource;
  }

  /**
   * Check if TTS audio source is available.
   */
  get hasTTSAudioSource(): boolean {
    return this.audioSource !== null;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    if (this._destroyed) return;

    this._destroyed = true;
    console.log('[native-peer-server] Destroying peer');

    this.gatheringResolve = null;
    if (this.gatheringTimeout) {
      clearTimeout(this.gatheringTimeout);
      this.gatheringTimeout = null;
    }

    // Stop audio sink
    if (this.audioSink) {
      try {
        this.audioSink.stop();
      } catch (err) {
        console.error('[native-peer-server] Error stopping audio sink:', err);
      }
      this.audioSink = null;
    }

    // Clean up data channel
    if (this.dataChannel) {
      this.dataChannel.onopen = null;
      this.dataChannel.onclose = null;
      this.dataChannel.onerror = null;
      this.dataChannel.onmessage = null;
      try {
        this.dataChannel.close();
      } catch (err) {
        // Ignore close errors
      }
      this.dataChannel = null;
    }

    // Clean up peer connection
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.onicegatheringstatechange = null;
    this.pc.ondatachannel = null;
    this.pc.ontrack = null;
    this.pc.onicecandidate = null;

    try {
      this.pc.close();
    } catch (err) {
      // Ignore close errors
    }

    this.removeAllListeners();
  }
}
