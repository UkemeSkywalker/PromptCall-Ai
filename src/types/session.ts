/**
 * Session data models and interfaces for PromptCall AI MVP
 * Defines TypeScript interfaces for call sessions and conversation management
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Audio file metadata for conversation entries
 */
export interface AudioFileInfo {
  /** Original Twilio recording URL */
  originalUrl: string;
  /** S3 key for the stored audio file */
  s3Key: string;
  /** S3 URL for the stored audio file */
  s3Url: string;
  /** File size in bytes */
  fileSize?: number;
  /** Audio duration in seconds */
  duration?: number;
  /** Upload timestamp */
  uploadedAt: number;
}

/**
 * Represents a single conversation entry in a call session
 */
export interface ConversationEntry {
  /** Unique identifier for this conversation entry */
  id: string;
  /** Timestamp when this entry was created */
  timestamp: number;
  /** Type of conversation entry */
  type: 'user' | 'ai' | 'system';
  /** The text content of the conversation */
  text: string;
  /** Optional URL to audio file (for user speech or AI responses) */
  audioUrl?: string;
  /** Audio file metadata for S3 stored files */
  audioFileInfo?: AudioFileInfo;
  /** Confidence score for speech-to-text (0-1, only for user entries) */
  confidence?: number;
  /** Processing duration in milliseconds */
  processingDuration?: number;
}

/**
 * Represents the current state of a call session
 */
export type SessionStatus = 'active' | 'completed' | 'failed' | 'timeout' | 'dropped';

/**
 * Main call session interface
 */
export interface CallSession {
  /** Unique session identifier */
  sessionId: string;
  /** Twilio Call SID for tracking */
  callSid: string;
  /** Caller's phone number */
  phoneNumber: string;
  /** Session start timestamp */
  startTime: number;
  /** Session end timestamp (null if still active) */
  endTime?: number;
  /** Current session status */
  status: SessionStatus;
  /** Array of conversation entries */
  conversationHistory: ConversationEntry[];
  /** Total call duration in seconds */
  totalDuration?: number;
  /** Last activity timestamp for timeout management */
  lastActivity: number;
  /** TTL timestamp for DynamoDB automatic cleanup (24 hours from start) */
  ttl: number;
  /** Error information if session failed */
  errorInfo?: {
    code: string;
    message: string;
    timestamp: number;
  };
}

/**
 * Configuration for session TTL and timeouts
 */
export interface SessionConfig {
  /** Session TTL in seconds (default: 24 hours) */
  sessionTtlSeconds: number;
  /** Inactivity timeout in seconds (default: 30 seconds) */
  inactivityTimeoutSeconds: number;
  /** Maximum call duration in seconds (default: 10 minutes) */
  maxCallDurationSeconds: number;
}

/**
 * Default session configuration
 */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  sessionTtlSeconds: 24 * 60 * 60, // 24 hours
  inactivityTimeoutSeconds: 30, // 30 seconds
  maxCallDurationSeconds: 10 * 60, // 10 minutes
};

/**
 * Generates a new unique session ID
 */
export function generateSessionId(): string {
  return uuidv4();
}

/**
 * Generates a TTL timestamp for DynamoDB (current time + TTL seconds)
 */
export function generateTtl(ttlSeconds: number = DEFAULT_SESSION_CONFIG.sessionTtlSeconds): number {
  return Math.floor(Date.now() / 1000) + ttlSeconds;
}

/**
 * Creates a new conversation entry
 */
export function createConversationEntry(
  type: ConversationEntry['type'],
  text: string,
  audioUrl?: string,
  confidence?: number
): ConversationEntry {
  return {
    id: uuidv4(),
    timestamp: Date.now(),
    type,
    text,
    audioUrl,
    confidence,
  };
}

/**
 * Validates a CallSession object
 */
export function validateCallSession(session: any): session is CallSession {
  return (
    session !== null &&
    typeof session === 'object' &&
    typeof session.sessionId === 'string' &&
    typeof session.callSid === 'string' &&
    typeof session.phoneNumber === 'string' &&
    typeof session.startTime === 'number' &&
    typeof session.status === 'string' &&
    Array.isArray(session.conversationHistory) &&
    typeof session.lastActivity === 'number' &&
    typeof session.ttl === 'number'
  );
}

/**
 * Validates a ConversationEntry object
 */
export function validateConversationEntry(entry: any): entry is ConversationEntry {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    typeof entry.id === 'string' &&
    typeof entry.timestamp === 'number' &&
    ['user', 'ai', 'system'].includes(entry.type) &&
    typeof entry.text === 'string'
  );
}

/**
 * Checks if a session has timed out due to inactivity
 */
export function isSessionTimedOut(
  session: CallSession,
  config: SessionConfig = DEFAULT_SESSION_CONFIG
): boolean {
  const now = Date.now();
  const timeSinceLastActivity = (now - session.lastActivity) / 1000;
  return timeSinceLastActivity > config.inactivityTimeoutSeconds;
}

/**
 * Checks if a session has exceeded maximum call duration
 */
export function isSessionOverDuration(
  session: CallSession,
  config: SessionConfig = DEFAULT_SESSION_CONFIG
): boolean {
  const now = Date.now();
  const callDuration = (now - session.startTime) / 1000;
  return callDuration > config.maxCallDurationSeconds;
}

/**
 * Creates a new CallSession with default values
 */
export function createCallSession(
  callSid: string,
  phoneNumber: string,
  config: SessionConfig = DEFAULT_SESSION_CONFIG
): CallSession {
  const now = Date.now();
  
  return {
    sessionId: generateSessionId(),
    callSid,
    phoneNumber,
    startTime: now,
    status: 'active',
    conversationHistory: [],
    lastActivity: now,
    ttl: generateTtl(config.sessionTtlSeconds),
  };
}