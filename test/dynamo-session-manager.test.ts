/**
 * Integration tests for DynamoDB Session Manager
 * These tests require a local DynamoDB instance or AWS credentials
 */

import { DynamoSessionManager } from '../src/services/dynamo-session-manager';
import {
  CallSession,
  ConversationEntry,
  createConversationEntry,
  DEFAULT_SESSION_CONFIG,
} from '../src/types/session';

// Mock DynamoDB client for testing
jest.mock('@aws-sdk/client-dynamodb');

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const mockDynamoDBClient = {
  send: jest.fn(),
};

// Mock the DynamoDBClient constructor
(DynamoDBClient as jest.Mock).mockImplementation(() => mockDynamoDBClient);

describe('DynamoSessionManager', () => {
  let sessionManager: DynamoSessionManager;
  const testTableName = 'test-sessions';

  beforeEach(() => {
    jest.clearAllMocks();
    sessionManager = new DynamoSessionManager({
      tableName: testTableName,
      region: 'us-east-1',
    });
  });

  describe('createSession', () => {
    it('should create a new session successfully', async () => {
      const callSid = 'test-call-sid';
      const phoneNumber = '+1234567890';

      mockDynamoDBClient.send.mockResolvedValueOnce({});

      const session = await sessionManager.createSession(callSid, phoneNumber);

      expect(session.callSid).toBe(callSid);
      expect(session.phoneNumber).toBe(phoneNumber);
      expect(session.status).toBe('active');
      expect(session.conversationHistory).toEqual([]);
      expect(session.sessionId).toBeDefined();
      expect(session.ttl).toBeDefined();

      expect(mockDynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(PutItemCommand)
      );
    });

    it('should handle creation errors', async () => {
      const callSid = 'test-call-sid';
      const phoneNumber = '+1234567890';

      mockDynamoDBClient.send.mockRejectedValueOnce(new Error('DynamoDB error'));

      await expect(
        sessionManager.createSession(callSid, phoneNumber)
      ).rejects.toThrow('Failed to create session');
    });
  });

  describe('getSession', () => {
    it('should retrieve an existing session', async () => {
      const sessionId = 'test-session-id';
      const mockSession: CallSession = {
        sessionId,
        callSid: 'test-call-sid',
        phoneNumber: '+1234567890',
        startTime: Date.now(),
        status: 'active',
        conversationHistory: [],
        lastActivity: Date.now(),
        ttl: Math.floor(Date.now() / 1000) + 86400,
      };

      mockDynamoDBClient.send.mockResolvedValueOnce({
        Item: marshall(mockSession),
      });

      const result = await sessionManager.getSession(sessionId);

      expect(result).toEqual(mockSession);
      expect(mockDynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(GetItemCommand)
      );
    });

    it('should return null for non-existent session', async () => {
      const sessionId = 'non-existent-session';

      mockDynamoDBClient.send.mockResolvedValueOnce({});

      const result = await sessionManager.getSession(sessionId);

      expect(result).toBeNull();
    });

    it('should handle retrieval errors', async () => {
      const sessionId = 'test-session-id';

      mockDynamoDBClient.send.mockRejectedValueOnce(new Error('DynamoDB error'));

      await expect(sessionManager.getSession(sessionId)).rejects.toThrow(
        'Failed to retrieve session'
      );
    });
  });

  describe('getSessionByCallSid', () => {
    it('should retrieve session by call SID', async () => {
      const callSid = 'test-call-sid';
      const mockSession: CallSession = {
        sessionId: 'test-session-id',
        callSid,
        phoneNumber: '+1234567890',
        startTime: Date.now(),
        status: 'active',
        conversationHistory: [],
        lastActivity: Date.now(),
        ttl: Math.floor(Date.now() / 1000) + 86400,
      };

      mockDynamoDBClient.send.mockResolvedValueOnce({
        Items: [marshall(mockSession)],
      });

      const result = await sessionManager.getSessionByCallSid(callSid);

      expect(result).toEqual(mockSession);
      expect(mockDynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(ScanCommand)
      );
    });

    it('should return null when no session found by call SID', async () => {
      const callSid = 'non-existent-call-sid';

      mockDynamoDBClient.send.mockResolvedValueOnce({
        Items: [],
      });

      const result = await sessionManager.getSessionByCallSid(callSid);

      expect(result).toBeNull();
    });
  });

  describe('updateSessionStatus', () => {
    it('should update session status successfully', async () => {
      const sessionId = 'test-session-id';
      const newStatus = 'completed';
      const endTime = Date.now();

      mockDynamoDBClient.send.mockResolvedValueOnce({});

      await sessionManager.updateSessionStatus(sessionId, newStatus, endTime);

      expect(mockDynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(UpdateItemCommand)
      );
    });

    it('should update session status with error info', async () => {
      const sessionId = 'test-session-id';
      const newStatus = 'failed';
      const errorInfo = { code: 'TRANSCRIBE_ERROR', message: 'Failed to transcribe audio' };

      mockDynamoDBClient.send.mockResolvedValueOnce({});

      await sessionManager.updateSessionStatus(sessionId, newStatus, undefined, errorInfo);

      expect(mockDynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(UpdateItemCommand)
      );
    });
  });

  describe('appendConversationEntry', () => {
    it('should append conversation entry successfully', async () => {
      const sessionId = 'test-session-id';
      const entry = createConversationEntry('user', 'Hello, how are you?');

      mockDynamoDBClient.send.mockResolvedValueOnce({});

      await sessionManager.appendConversationEntry(sessionId, entry);

      expect(mockDynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(UpdateItemCommand)
      );
    });

    it('should handle append errors', async () => {
      const sessionId = 'test-session-id';
      const entry = createConversationEntry('user', 'Hello');

      mockDynamoDBClient.send.mockRejectedValueOnce(new Error('DynamoDB error'));

      await expect(
        sessionManager.appendConversationEntry(sessionId, entry)
      ).rejects.toThrow('Failed to append conversation entry');
    });
  });

  describe('conversation helper methods', () => {
    beforeEach(() => {
      mockDynamoDBClient.send.mockResolvedValue({});
    });

    it('should add user message', async () => {
      const sessionId = 'test-session-id';
      const text = 'Hello, AI!';
      const audioUrl = 'https://example.com/audio.wav';
      const confidence = 0.95;

      await sessionManager.addUserMessage(sessionId, text, audioUrl, confidence);

      expect(mockDynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(UpdateItemCommand)
      );
    });

    it('should add AI response', async () => {
      const sessionId = 'test-session-id';
      const text = 'Hello! How can I help you?';
      const audioUrl = 'https://example.com/response.wav';
      const processingDuration = 1500;

      await sessionManager.addAiResponse(sessionId, text, audioUrl, processingDuration);

      expect(mockDynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(UpdateItemCommand)
      );
    });

    it('should add system message', async () => {
      const sessionId = 'test-session-id';
      const text = 'Call started';

      await sessionManager.addSystemMessage(sessionId, text);

      expect(mockDynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(UpdateItemCommand)
      );
    });
  });

  describe('updateCallDuration', () => {
    it('should update call duration successfully', async () => {
      const sessionId = 'test-session-id';
      const duration = 120; // 2 minutes

      mockDynamoDBClient.send.mockResolvedValueOnce({});

      await sessionManager.updateCallDuration(sessionId, duration);

      expect(mockDynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(UpdateItemCommand)
      );
    });

    it('should handle update duration errors', async () => {
      const sessionId = 'test-session-id';
      const duration = 120;

      mockDynamoDBClient.send.mockRejectedValueOnce(new Error('DynamoDB error'));

      await expect(
        sessionManager.updateCallDuration(sessionId, duration)
      ).rejects.toThrow('Failed to update call duration');
    });
  });

  describe('deleteSession', () => {
    it('should delete session successfully', async () => {
      const sessionId = 'test-session-id';

      mockDynamoDBClient.send.mockResolvedValueOnce({});

      await sessionManager.deleteSession(sessionId);

      expect(mockDynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(DeleteItemCommand)
      );
    });
  });

  describe('listActiveSessions', () => {
    it('should list active sessions', async () => {
      const mockSessions: CallSession[] = [
        {
          sessionId: 'session-1',
          callSid: 'call-1',
          phoneNumber: '+1234567890',
          startTime: Date.now(),
          status: 'active',
          conversationHistory: [],
          lastActivity: Date.now(),
          ttl: Math.floor(Date.now() / 1000) + 86400,
        },
        {
          sessionId: 'session-2',
          callSid: 'call-2',
          phoneNumber: '+0987654321',
          startTime: Date.now(),
          status: 'active',
          conversationHistory: [],
          lastActivity: Date.now(),
          ttl: Math.floor(Date.now() / 1000) + 86400,
        },
      ];

      mockDynamoDBClient.send.mockResolvedValueOnce({
        Items: mockSessions.map(session => marshall(session, { removeUndefinedValues: true })),
      });

      const result = await sessionManager.listActiveSessions();

      expect(result).toHaveLength(2);
      expect(result[0].sessionId).toBe('session-1');
      expect(result[1].sessionId).toBe('session-2');
    });

    it('should return empty array when no active sessions', async () => {
      mockDynamoDBClient.send.mockResolvedValueOnce({
        Items: undefined,
      });

      const result = await sessionManager.listActiveSessions();

      expect(result).toEqual([]);
    });
  });

  describe('buildConversationContext', () => {
    it('should build conversation context from history', async () => {
      const sessionId = 'test-session-id';
      const mockSession: CallSession = {
        sessionId,
        callSid: 'test-call-sid',
        phoneNumber: '+1234567890',
        startTime: Date.now(),
        status: 'active',
        conversationHistory: [
          createConversationEntry('user', 'Hello'),
          createConversationEntry('ai', 'Hi there! How can I help you?'),
          createConversationEntry('user', 'What is the weather like?'),
        ],
        lastActivity: Date.now(),
        ttl: Math.floor(Date.now() / 1000) + 86400,
      };

      mockDynamoDBClient.send.mockResolvedValueOnce({
        Item: marshall(mockSession, { removeUndefinedValues: true }),
      });

      const context = await sessionManager.buildConversationContext(sessionId);

      expect(context).toContain('User: Hello');
      expect(context).toContain('Assistant: Hi there! How can I help you?');
      expect(context).toContain('User: What is the weather like?');
    });
  });

  describe('healthCheck', () => {
    it('should return true when DynamoDB is accessible', async () => {
      // Reset mock for this specific test
      mockDynamoDBClient.send.mockClear();
      mockDynamoDBClient.send.mockResolvedValueOnce({
        Items: [],
      });

      const result = await sessionManager.healthCheck();

      expect(result).toBe(true);
    });

    it('should return false when DynamoDB is not accessible', async () => {
      // Reset mock for this specific test
      mockDynamoDBClient.send.mockClear();
      mockDynamoDBClient.send.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await sessionManager.healthCheck();

      expect(result).toBe(false);
    });
  });
});