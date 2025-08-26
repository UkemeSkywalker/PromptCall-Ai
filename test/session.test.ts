/**
 * Unit tests for session data models and validation functions
 */

import {
  CallSession,
  ConversationEntry,
  SessionStatus,
  generateSessionId,
  generateTtl,
  createConversationEntry,
  validateCallSession,
  validateConversationEntry,
  isSessionTimedOut,
  isSessionOverDuration,
  createCallSession,
  DEFAULT_SESSION_CONFIG,
} from '../src/types/session';

describe('Session Data Models', () => {
  describe('generateSessionId', () => {
    it('should generate unique session IDs', () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();
      
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
      expect(id1.length).toBeGreaterThan(0);
    });
  });

  describe('generateTtl', () => {
    it('should generate TTL timestamp in the future', () => {
      const now = Math.floor(Date.now() / 1000);
      const ttl = generateTtl(3600); // 1 hour
      
      expect(ttl).toBeGreaterThan(now);
      expect(ttl).toBeLessThanOrEqual(now + 3600);
    });

    it('should use default TTL when no parameter provided', () => {
      const now = Math.floor(Date.now() / 1000);
      const ttl = generateTtl();
      
      expect(ttl).toBeGreaterThan(now);
      expect(ttl).toBeLessThanOrEqual(now + DEFAULT_SESSION_CONFIG.sessionTtlSeconds);
    });
  });

  describe('createConversationEntry', () => {
    it('should create a valid conversation entry', () => {
      const entry = createConversationEntry('user', 'Hello, how are you?');
      
      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.type).toBe('user');
      expect(entry.text).toBe('Hello, how are you?');
      expect(typeof entry.timestamp).toBe('number');
    });

    it('should create entry with optional parameters', () => {
      const entry = createConversationEntry(
        'user',
        'Test message',
        'https://example.com/audio.wav',
        0.95
      );
      
      expect(entry.audioUrl).toBe('https://example.com/audio.wav');
      expect(entry.confidence).toBe(0.95);
    });

    it('should create entries with different types', () => {
      const userEntry = createConversationEntry('user', 'User message');
      const aiEntry = createConversationEntry('ai', 'AI response');
      const systemEntry = createConversationEntry('system', 'System message');
      
      expect(userEntry.type).toBe('user');
      expect(aiEntry.type).toBe('ai');
      expect(systemEntry.type).toBe('system');
    });
  });

  describe('validateCallSession', () => {
    it('should validate a correct CallSession', () => {
      const session: CallSession = {
        sessionId: 'test-session-id',
        callSid: 'test-call-sid',
        phoneNumber: '+1234567890',
        startTime: Date.now(),
        status: 'active',
        conversationHistory: [],
        lastActivity: Date.now(),
        ttl: generateTtl(),
      };
      
      expect(validateCallSession(session)).toBe(true);
    });

    it('should reject invalid CallSession objects', () => {
      const invalidSessions = [
        null,
        undefined,
        {},
        { sessionId: 'test' }, // missing required fields
        { 
          sessionId: 123, // wrong type
          callSid: 'test',
          phoneNumber: '+1234567890',
          startTime: Date.now(),
          status: 'active',
          conversationHistory: [],
          lastActivity: Date.now(),
          ttl: generateTtl(),
        },
      ];
      
      invalidSessions.forEach(session => {
        expect(validateCallSession(session)).toBe(false);
      });
    });
  });

  describe('validateConversationEntry', () => {
    it('should validate a correct ConversationEntry', () => {
      const entry: ConversationEntry = {
        id: 'test-id',
        timestamp: Date.now(),
        type: 'user',
        text: 'Test message',
      };
      
      expect(validateConversationEntry(entry)).toBe(true);
    });

    it('should reject invalid ConversationEntry objects', () => {
      const invalidEntries = [
        null,
        undefined,
        {},
        { id: 'test' }, // missing required fields
        {
          id: 'test',
          timestamp: Date.now(),
          type: 'invalid-type', // invalid type
          text: 'Test message',
        },
      ];
      
      invalidEntries.forEach(entry => {
        expect(validateConversationEntry(entry)).toBe(false);
      });
    });
  });

  describe('isSessionTimedOut', () => {
    it('should detect timed out sessions', () => {
      const oldTimestamp = Date.now() - (35 * 1000); // 35 seconds ago
      const session: CallSession = {
        sessionId: 'test',
        callSid: 'test',
        phoneNumber: '+1234567890',
        startTime: Date.now(),
        status: 'active',
        conversationHistory: [],
        lastActivity: oldTimestamp,
        ttl: generateTtl(),
      };
      
      expect(isSessionTimedOut(session)).toBe(true);
    });

    it('should not detect active sessions as timed out', () => {
      const recentTimestamp = Date.now() - (10 * 1000); // 10 seconds ago
      const session: CallSession = {
        sessionId: 'test',
        callSid: 'test',
        phoneNumber: '+1234567890',
        startTime: Date.now(),
        status: 'active',
        conversationHistory: [],
        lastActivity: recentTimestamp,
        ttl: generateTtl(),
      };
      
      expect(isSessionTimedOut(session)).toBe(false);
    });
  });

  describe('isSessionOverDuration', () => {
    it('should detect sessions over maximum duration', () => {
      const oldStartTime = Date.now() - (15 * 60 * 1000); // 15 minutes ago
      const session: CallSession = {
        sessionId: 'test',
        callSid: 'test',
        phoneNumber: '+1234567890',
        startTime: oldStartTime,
        status: 'active',
        conversationHistory: [],
        lastActivity: Date.now(),
        ttl: generateTtl(),
      };
      
      expect(isSessionOverDuration(session)).toBe(true);
    });

    it('should not detect short sessions as over duration', () => {
      const recentStartTime = Date.now() - (5 * 60 * 1000); // 5 minutes ago
      const session: CallSession = {
        sessionId: 'test',
        callSid: 'test',
        phoneNumber: '+1234567890',
        startTime: recentStartTime,
        status: 'active',
        conversationHistory: [],
        lastActivity: Date.now(),
        ttl: generateTtl(),
      };
      
      expect(isSessionOverDuration(session)).toBe(false);
    });
  });

  describe('createCallSession', () => {
    it('should create a valid CallSession with default config', () => {
      const callSid = 'test-call-sid';
      const phoneNumber = '+1234567890';
      
      const session = createCallSession(callSid, phoneNumber);
      
      expect(session.sessionId).toBeDefined();
      expect(session.callSid).toBe(callSid);
      expect(session.phoneNumber).toBe(phoneNumber);
      expect(session.status).toBe('active');
      expect(session.conversationHistory).toEqual([]);
      expect(session.startTime).toBeDefined();
      expect(session.lastActivity).toBeDefined();
      expect(session.ttl).toBeDefined();
      expect(validateCallSession(session)).toBe(true);
    });

    it('should create session with custom config', () => {
      const customConfig = {
        sessionTtlSeconds: 7200, // 2 hours
        inactivityTimeoutSeconds: 60, // 1 minute
        maxCallDurationSeconds: 1800, // 30 minutes
      };
      
      const session = createCallSession('test-call', '+1234567890', customConfig);
      
      expect(session.ttl).toBeGreaterThan(Math.floor(Date.now() / 1000) + 7000);
      expect(validateCallSession(session)).toBe(true);
    });
  });
});