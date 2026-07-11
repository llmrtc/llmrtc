/**
 * Minimal structural types for the parts of @roamhq/wrtc this package uses.
 *
 * The wrtc module is loaded dynamically (it is a native module that may fail
 * to load on unsupported platforms), and its bundled type definitions model
 * RTCPeerConnection as a distinct class rather than the DOM interface this
 * codebase is written against. These structural types describe just the
 * surface we rely on.
 */

export interface AudioData {
  samples: Int16Array;
  sampleRate: number;
  bitsPerSample: number;
  channelCount: number;
  numberOfFrames: number;
}

/** wrtc's nonstandard RTCAudioSource: feeds PCM into an outgoing track. */
export interface WrtcAudioSource {
  createTrack(): MediaStreamTrack;
  onData(data: AudioData): void;
}

/** wrtc's nonstandard RTCAudioSink: receives PCM from an incoming track. */
export interface WrtcAudioSink {
  ondata: ((data: AudioData) => void) | null;
  stop(): void;
}

export interface WrtcModule {
  RTCPeerConnection: new (configuration?: RTCConfiguration) => RTCPeerConnection;
  MediaStream: new (tracks?: MediaStreamTrack[]) => MediaStream;
  nonstandard?: {
    RTCAudioSource: new () => WrtcAudioSource;
    RTCAudioSink: new (track: MediaStreamTrack) => WrtcAudioSink;
    MediaStream?: new (tracks?: MediaStreamTrack[]) => MediaStream;
  };
}
