import { ConversationOrchestrator } from '@metered/llmrtc-core';

export interface Session {
  /** Unique session identifier */
  id: string;
  /** The conversation orchestrator for this session */
  orchestrator: ConversationOrchestrator;
  /** When the session was created */
  createdAt: number;
  /** When the session was last active */
  lastActivityAt: number;
}

export interface SessionManagerConfig {
  /** Time-to-live for sessions in milliseconds (default: 30 minutes) */
  sessionTTLMs?: number;
  /** Cleanup interval in milliseconds (default: 5 minutes) */
  cleanupIntervalMs?: number;
}

const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * SessionManager maintains session state for reconnection support.
 * Sessions are preserved for a configurable TTL to allow clients
 * to reconnect and resume their conversation history.
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval>;
  private sessionTTLMs: number;

  constructor(config: SessionManagerConfig = {}) {
    this.sessionTTLMs = config.sessionTTLMs ?? DEFAULT_SESSION_TTL_MS;
    const cleanupIntervalMs =
      config.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;

    // Start periodic cleanup of expired sessions
    this.cleanupInterval = setInterval(
      () => this.cleanupExpiredSessions(),
      cleanupIntervalMs
    );

    console.log(
      `[session-manager] Initialized with TTL: ${this.sessionTTLMs / 1000}s, cleanup interval: ${cleanupIntervalMs / 1000}s`
    );
  }

  /**
   * Create a new session.
   */
  createSession(id: string, orchestrator: ConversationOrchestrator): Session {
    const now = Date.now();
    const session: Session = {
      id,
      orchestrator,
      createdAt: now,
      lastActivityAt: now
    };

    this.sessions.set(id, session);
    console.log(
      `[session-manager] Created session: ${id} (total: ${this.sessions.size})`
    );

    return session;
  }

  /**
   * Get an existing session by ID.
   * Updates lastActivityAt if found.
   */
  getSession(id: string): Session | undefined {
    const session = this.sessions.get(id);

    if (session) {
      // Check if session has expired
      if (Date.now() - session.lastActivityAt > this.sessionTTLMs) {
        console.log(`[session-manager] Session expired: ${id}`);
        this.sessions.delete(id);
        return undefined;
      }

      // Update activity timestamp
      session.lastActivityAt = Date.now();
      console.log(`[session-manager] Retrieved session: ${id}`);
    }

    return session;
  }

  /**
   * Update the lastActivityAt timestamp for a session.
   */
  touchSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivityAt = Date.now();
    }
  }

  /**
   * Remove a session.
   */
  removeSession(id: string): boolean {
    const removed = this.sessions.delete(id);
    if (removed) {
      console.log(
        `[session-manager] Removed session: ${id} (remaining: ${this.sessions.size})`
      );
    }
    return removed;
  }

  /**
   * Check if a session exists and is not expired.
   */
  hasSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    if (Date.now() - session.lastActivityAt > this.sessionTTLMs) {
      this.sessions.delete(id);
      return false;
    }

    return true;
  }

  /**
   * Get the number of active sessions.
   */
  get activeSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Clean up expired sessions.
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivityAt > this.sessionTTLMs) {
        this.sessions.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(
        `[session-manager] Cleaned up ${cleaned} expired session(s) (remaining: ${this.sessions.size})`
      );
    }
  }

  /**
   * Get all session IDs (for debugging/monitoring).
   */
  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Clean up and destroy the session manager.
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.sessions.clear();
    console.log('[session-manager] Destroyed');
  }
}
