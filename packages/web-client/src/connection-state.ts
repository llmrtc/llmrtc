import EventEmitter from 'eventemitter3';

/**
 * Connection states for the WebRTC client.
 */
export enum ConnectionState {
  /** Initial state, not connected */
  DISCONNECTED = 'disconnected',
  /** WebSocket connected, WebRTC negotiating */
  CONNECTING = 'connecting',
  /** Fully operational */
  CONNECTED = 'connected',
  /** Lost connection, attempting to reconnect */
  RECONNECTING = 'reconnecting',
  /** Max retries exceeded, connection failed */
  FAILED = 'failed',
  /** Explicitly closed by user */
  CLOSED = 'closed'
}

export interface ReconnectionConfig {
  /** Whether reconnection is enabled (default: true) */
  enabled: boolean;
  /** Maximum number of retry attempts (default: 5) */
  maxRetries: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay in ms (default: 30000) */
  maxDelayMs: number;
  /** Jitter factor 0-1 to randomize delays (default: 0.3) */
  jitterFactor: number;
}

export interface StateChangeEvent {
  from: ConnectionState;
  to: ConnectionState;
}

export interface ConnectionStateMachineEvents {
  stateChange: (event: StateChangeEvent) => void;
}

const DEFAULT_CONFIG: ReconnectionConfig = {
  enabled: true,
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.3
};

/**
 * ConnectionStateMachine manages connection state transitions
 * and provides exponential backoff for reconnection attempts.
 */
export class ConnectionStateMachine extends EventEmitter<ConnectionStateMachineEvents> {
  private _state: ConnectionState = ConnectionState.DISCONNECTED;
  private _retryCount: number = 0;
  private config: ReconnectionConfig;

  constructor(config: Partial<ReconnectionConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get the current connection state.
   */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Get the current retry count.
   */
  get retryCount(): number {
    return this._retryCount;
  }

  /**
   * Get the max retries from config.
   */
  get maxRetries(): number {
    return this.config.maxRetries;
  }

  /**
   * Check if reconnection is enabled.
   */
  get reconnectionEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Transition to a new state.
   * Validates the transition and emits stateChange event.
   */
  transition(newState: ConnectionState): void {
    const oldState = this._state;

    // Validate transition
    if (!this.isValidTransition(oldState, newState)) {
      console.warn(
        `[connection-state] Invalid transition: ${oldState} -> ${newState}`
      );
      return;
    }

    this._state = newState;

    // Reset retry count on successful connection
    if (newState === ConnectionState.CONNECTED) {
      this._retryCount = 0;
    }

    console.log(`[connection-state] ${oldState} -> ${newState}`);
    this.emit('stateChange', { from: oldState, to: newState });
  }

  /**
   * Check if a state transition is valid.
   */
  private isValidTransition(from: ConnectionState, to: ConnectionState): boolean {
    // Always allow transition to CLOSED
    if (to === ConnectionState.CLOSED) {
      return true;
    }

    // Define valid transitions
    const validTransitions: Record<ConnectionState, ConnectionState[]> = {
      [ConnectionState.DISCONNECTED]: [ConnectionState.CONNECTING],
      [ConnectionState.CONNECTING]: [
        ConnectionState.CONNECTED,
        ConnectionState.RECONNECTING,
        ConnectionState.FAILED
      ],
      [ConnectionState.CONNECTED]: [ConnectionState.RECONNECTING],
      [ConnectionState.RECONNECTING]: [
        ConnectionState.CONNECTING,
        ConnectionState.FAILED
      ],
      [ConnectionState.FAILED]: [ConnectionState.CONNECTING], // Allow retry from failed
      [ConnectionState.CLOSED]: [] // No transitions from closed
    };

    return validTransitions[from]?.includes(to) ?? false;
  }

  /**
   * Calculate the next retry delay using exponential backoff with jitter.
   * Returns null if max retries exceeded.
   */
  getNextRetryDelay(): number | null {
    if (this._retryCount >= this.config.maxRetries) {
      return null; // Max retries exceeded
    }

    // Exponential backoff: baseDelay * 2^retryCount
    const exponentialDelay = Math.min(
      this.config.baseDelayMs * Math.pow(2, this._retryCount),
      this.config.maxDelayMs
    );

    // Add jitter to prevent thundering herd
    const jitter = exponentialDelay * this.config.jitterFactor * Math.random();

    this._retryCount++;

    return Math.round(exponentialDelay + jitter);
  }

  /**
   * Check if more retry attempts are available.
   */
  canRetry(): boolean {
    return this.config.enabled && this._retryCount < this.config.maxRetries;
  }

  /**
   * Reset the state machine to initial state.
   */
  reset(): void {
    this._state = ConnectionState.DISCONNECTED;
    this._retryCount = 0;
  }

  /**
   * Update the configuration.
   */
  updateConfig(config: Partial<ReconnectionConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
