/**
 * Unit tests for Conversation Context Manager
 */

import { ConversationContextManager, DEFAULT_CONTEXT_CONFIG } from '../src/services/conversation-context-manager';
import { DynamoSessionManager } from '../src/services/dynamo-session-manager';
import {
  CallSession,
  ConversationEntry,
  createCallSession,
  createConversationEntry,
} from '../src/types/session';

// Mock DynamoSessionManager
const mockSessionManager = {
  createSession: jest.fn(),
  getSession: jest.fn(),
  getSessionByCallSid: jest.fn(),
  updateSessionStatus: jest.fn(),
  appendConversationEntry: jest.fn(),
  addUserMessage: jest.fn(),
  addAiResponse: jest.fn(),
  addSystemMessage: jest.fn(),
  updateCallDuration: jest.fn(),
  deleteSession: jest.fn(),
  listActiveSessions: jest.fn(),
  getConversationHistory: jest.fn(),
  buildConversationContext: jest.fn(),
  healthCheck: jest.fn(),
} as any;

describe('ConversationContextManager', () => {
  let contextManager: ConversationContextManager;

  beforeEach(() => {
    jest.clearAllMocks();
    contextManager = new ConversationContextManager(mockSessionManager);
  });

  describe('initializeConversation', () => {
    it('should initialize a new conversation with greeting phase', async () => {
      const callSid = 'test-call-sid';
      const phoneNumber = '+1234567890';
      const mockSession = createCallSession(callSid, phoneNumber);

      mockSessionManager.createSession.mockResolvedValueOnce(mockSession);
      mockSessionManager.addSystemMessage.mockResolvedValueOnce();
      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const result = await contextManager.initializeConversation(callSid, phoneNumber);

      expect(result.session).toEqual(mockSession);
      expect(result.context.sessionId).toBe(mockSession.sessionId);
      expect(result.context.systemPrompt).toContain('start of the conversation');
      expect(mockSessionManager.createSession).toHaveBeenCalledWith(callSid, phoneNumber);
      expect(mockSessionManager.addSystemMessage).toHaveBeenCalledWith(
        mockSession.sessionId,
        'Conversation initialized - greeting phase'
      );
    });

    it('should initialize conversation with custom user preferences', async () => {
      const callSid = 'test-call-sid';
      const phoneNumber = '+1234567890';
      const mockSession = createCallSession(callSid, phoneNumber);
      const userPreferences = { responseLength: 'short' as const, language: 'en' };

      mockSessionManager.createSession.mockResolvedValueOnce(mockSession);
      mockSessionManager.addSystemMessage.mockResolvedValueOnce();
      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const result = await contextManager.initializeConversation(callSid, phoneNumber, userPreferences);

      expect(result.context.userPreferences.responseLength).toBe('short');
      expect(result.context.systemPrompt).toContain('very brief');
    });
  });

  describe('processUserMessage', () => {
    it('should process user message and update context', async () => {
      const sessionId = 'test-session-id';
      const userText = 'Hello, how are you?';
      const audioUrl = 'https://example.com/audio.wav';
      const confidence = 0.95;

      const mockSession = createCallSession('test-call', '+1234567890');
      mockSession.sessionId = sessionId;
      mockSession.conversationHistory = [
        createConversationEntry('user', userText, audioUrl, confidence),
      ];

      mockSessionManager.addUserMessage.mockResolvedValueOnce();
      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const context = await contextManager.processUserMessage(sessionId, userText, audioUrl, confidence);

      expect(context.sessionId).toBe(sessionId);
      expect(context.conversationContext).toContain('User: Hello, how are you?');
      expect(mockSessionManager.addUserMessage).toHaveBeenCalledWith(
        sessionId,
        userText,
        audioUrl,
        confidence
      );
    });
  });

  describe('processAIResponse', () => {
    it('should process AI response and update conversation', async () => {
      const sessionId = 'test-session-id';
      const aiText = 'I am doing well, thank you! How can I help you today?';
      const audioUrl = 'https://example.com/response.wav';
      const processingDuration = 1500;

      mockSessionManager.addAiResponse.mockResolvedValueOnce();

      await contextManager.processAIResponse(sessionId, aiText, audioUrl, processingDuration);

      expect(mockSessionManager.addAiResponse).toHaveBeenCalledWith(
        sessionId,
        aiText,
        audioUrl,
        processingDuration
      );
    });
  });

  describe('buildAIContext', () => {
    it('should build comprehensive AI context', async () => {
      const sessionId = 'test-session-id';
      const mockSession = createCallSession('test-call', '+1234567890');
      mockSession.sessionId = sessionId;
      mockSession.conversationHistory = [
        createConversationEntry('user', 'Hello'),
        createConversationEntry('ai', 'Hi there! How can I help you?'),
        createConversationEntry('user', 'What is the weather like?'),
      ];

      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const context = await contextManager.buildAIContext(sessionId);

      expect(context.sessionId).toBe(sessionId);
      expect(context.conversationContext).toContain('User: Hello');
      expect(context.conversationContext).toContain('Assistant: Hi there!');
      expect(context.conversationContext).toContain('User: What is the weather like?');
      expect(context.systemPrompt).toContain('helpful AI assistant');
      expect(context.contextWindow).toHaveLength(3);
      expect(context.conversationSummary).toContain('2 user messages');
    });

    it('should handle empty conversation history', async () => {
      const sessionId = 'test-session-id';
      const mockSession = createCallSession('test-call', '+1234567890');
      mockSession.sessionId = sessionId;
      mockSession.conversationHistory = [];

      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const context = await contextManager.buildAIContext(sessionId);

      expect(context.conversationContext).toBe('This is the start of a new conversation.');
      expect(context.systemPrompt).toContain('start of the conversation');
      expect(context.conversationSummary).toBe('No conversation history yet.');
    });

    it('should throw error for non-existent session', async () => {
      const sessionId = 'non-existent-session';

      mockSessionManager.getSession.mockResolvedValueOnce(null);

      await expect(contextManager.buildAIContext(sessionId)).rejects.toThrow(
        'Session not found: non-existent-session'
      );
    });
  });

  describe('checkSessionHealth', () => {
    it('should detect healthy session', async () => {
      const sessionId = 'test-session-id';
      const mockSession = createCallSession('test-call', '+1234567890');
      mockSession.sessionId = sessionId;
      mockSession.lastActivity = Date.now() - 5000; // 5 seconds ago
      mockSession.conversationHistory = [
        createConversationEntry('user', 'Hello'),
        createConversationEntry('ai', 'Hi there!'),
      ];

      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const health = await contextManager.checkSessionHealth(sessionId);

      expect(health.needsAttention).toBe(false);
      expect(health.reasons).toHaveLength(0);
      expect(health.recommendations).toHaveLength(0);
    });

    it('should detect timed out session', async () => {
      const sessionId = 'test-session-id';
      const mockSession = createCallSession('test-call', '+1234567890');
      mockSession.sessionId = sessionId;
      mockSession.lastActivity = Date.now() - 60000; // 60 seconds ago (timeout is 30s)
      mockSession.conversationHistory = [];

      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const health = await contextManager.checkSessionHealth(sessionId);

      expect(health.needsAttention).toBe(true);
      expect(health.reasons).toContain('Session timed out due to inactivity');
      expect(health.recommendations).toContain('Send timeout prompt or end session gracefully');
    });

    it('should detect long conversation needing summary', async () => {
      const sessionId = 'test-session-id';
      const mockSession = createCallSession('test-call', '+1234567890');
      mockSession.sessionId = sessionId;
      mockSession.lastActivity = Date.now();
      
      // Create conversation history longer than summary threshold (15)
      mockSession.conversationHistory = Array.from({ length: 20 }, (_, i) =>
        createConversationEntry(i % 2 === 0 ? 'user' : 'ai', `Message ${i}`)
      );

      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const health = await contextManager.checkSessionHealth(sessionId);

      expect(health.needsAttention).toBe(true);
      expect(health.reasons).toContain('Long conversation may need summarization');
      expect(health.recommendations).toContain('Provide conversation summary and check if user needs more help');
    });

    it('should detect repeated errors', async () => {
      const sessionId = 'test-session-id';
      const mockSession = createCallSession('test-call', '+1234567890');
      mockSession.sessionId = sessionId;
      mockSession.lastActivity = Date.now();
      mockSession.conversationHistory = [
        createConversationEntry('user', 'Hello'),
        createConversationEntry('system', 'Transcription error occurred'),
        createConversationEntry('user', 'Can you hear me?'),
        createConversationEntry('system', 'Audio processing error'),
      ];

      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const health = await contextManager.checkSessionHealth(sessionId);

      expect(health.needsAttention).toBe(true);
      expect(health.reasons).toContain('Multiple recent errors detected');
      expect(health.recommendations).toContain('Apologize for technical difficulties and offer alternative assistance');
    });

    it('should handle non-existent session', async () => {
      const sessionId = 'non-existent-session';

      mockSessionManager.getSession.mockResolvedValueOnce(null);

      const health = await contextManager.checkSessionHealth(sessionId);

      expect(health.needsAttention).toBe(true);
      expect(health.reasons).toContain('Session not found');
      expect(health.recommendations).toContain('Create new session');
    });
  });

  describe('validateAIResponse', () => {
    it('should validate appropriate AI response', () => {
      const response = 'I can help you with that. What specific information do you need?';
      const preferences = { responseLength: 'medium' as const, topics: [], language: 'en', voiceSpeed: 'normal' as const };

      const validation = contextManager.validateAIResponse(response, preferences);

      expect(validation.isValid).toBe(true);
      expect(validation.issues).toHaveLength(0);
      expect(validation.suggestions).toHaveLength(0);
    });

    it('should detect response that is too long', () => {
      const response = 'This is a very long response that exceeds the word limit. '.repeat(20); // ~200 words
      const preferences = { responseLength: 'medium' as const, topics: [], language: 'en', voiceSpeed: 'normal' as const };

      const validation = contextManager.validateAIResponse(response, preferences);

      expect(validation.isValid).toBe(false);
      expect(validation.issues[0]).toContain('Response too long');
      expect(validation.suggestions).toContain('Shorten response or split into multiple parts');
    });

    it('should detect visual references inappropriate for phone calls', () => {
      const response = 'Please click on the link and look at the image to see the details.';
      const preferences = { responseLength: 'medium' as const, topics: [], language: 'en', voiceSpeed: 'normal' as const };

      const validation = contextManager.validateAIResponse(response, preferences);

      expect(validation.isValid).toBe(false);
      expect(validation.issues).toContain('Response contains visual references inappropriate for phone calls');
      expect(validation.suggestions).toContain('Replace visual references with audio-appropriate language');
    });

    it('should detect response longer than user preference', () => {
      // Create a response with more than 75 words (50 * 1.5 = 75 words threshold for short)
      const response = Array(80).fill('word').join(' '); // 80 words, definitely over 75
      const preferences = { responseLength: 'short' as const, topics: [], language: 'en', voiceSpeed: 'normal' as const };

      const validation = contextManager.validateAIResponse(response, preferences);

      expect(validation.isValid).toBe(false);
      expect(validation.issues).toContain('Response longer than user preference (short)');
      expect(validation.suggestions).toContain('Adjust response to match short preference');
    });
  });

  describe('getConversationStats', () => {
    it('should calculate conversation statistics', async () => {
      const sessionId = 'test-session-id';
      const startTime = Date.now() - 120000; // 2 minutes ago
      const mockSession = createCallSession('test-call', '+1234567890');
      mockSession.sessionId = sessionId;
      mockSession.startTime = startTime;
      mockSession.conversationHistory = [
        createConversationEntry('user', 'Hello, I need help with weather information'),
        createConversationEntry('ai', 'I can help you with weather information. What location are you interested in?'),
        createConversationEntry('user', 'What is the weather like in New York?'),
        createConversationEntry('ai', 'The weather in New York is currently sunny with a temperature of 75 degrees.'),
      ];

      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const stats = await contextManager.getConversationStats(sessionId);

      expect(stats.turnCount).toBe(2); // 2 user messages
      expect(stats.duration).toBe(120); // 2 minutes in seconds
      expect(stats.averageResponseLength).toBeGreaterThan(0);
      expect(stats.topicsDiscussed).toContain('weather');
      expect(stats.userEngagement).toBe('medium'); // 2 messages in 2 minutes = 1 msg/min
    });

    it('should handle session with no conversation', async () => {
      const sessionId = 'test-session-id';
      const mockSession = createCallSession('test-call', '+1234567890');
      mockSession.sessionId = sessionId;
      mockSession.conversationHistory = [];

      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const stats = await contextManager.getConversationStats(sessionId);

      expect(stats.turnCount).toBe(0);
      expect(stats.averageResponseLength).toBe(0);
      expect(stats.topicsDiscussed).toHaveLength(0);
      expect(stats.userEngagement).toBe('low');
    });

    it('should throw error for non-existent session', async () => {
      const sessionId = 'non-existent-session';

      mockSessionManager.getSession.mockResolvedValueOnce(null);

      await expect(contextManager.getConversationStats(sessionId)).rejects.toThrow(
        'Session not found: non-existent-session'
      );
    });
  });

  describe('user preference inference', () => {
    it('should infer short response preference from brief user messages', async () => {
      const sessionId = 'test-session-id';
      const mockSession = createCallSession('test-call', '+1234567890');
      mockSession.sessionId = sessionId;
      mockSession.conversationHistory = [
        createConversationEntry('user', 'Hi'),
        createConversationEntry('ai', 'Hello! How can I help you?'),
        createConversationEntry('user', 'Weather?'),
      ];

      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const context = await contextManager.buildAIContext(sessionId);

      expect(context.userPreferences.responseLength).toBe('short');
    });

    it('should infer long response preference from detailed user messages', async () => {
      const sessionId = 'test-session-id';
      const mockSession = createCallSession('test-call', '+1234567890');
      mockSession.sessionId = sessionId;
      mockSession.conversationHistory = [
        createConversationEntry('user', 'Hello, I am calling because I need detailed information about the weather patterns in my area and how they might affect my outdoor activities this weekend.'),
        createConversationEntry('ai', 'I can help you with detailed weather information.'),
      ];

      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const context = await contextManager.buildAIContext(sessionId);

      expect(context.userPreferences.responseLength).toBe('long');
    });

    it('should extract topics from conversation', async () => {
      const sessionId = 'test-session-id';
      const mockSession = createCallSession('test-call', '+1234567890');
      mockSession.sessionId = sessionId;
      mockSession.conversationHistory = [
        createConversationEntry('user', 'I need help with my computer software'),
        createConversationEntry('ai', 'I can help with technology issues.'),
        createConversationEntry('user', 'Also, what is the weather like for travel?'),
      ];

      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const context = await contextManager.buildAIContext(sessionId);

      expect(context.userPreferences.topics).toContain('technology');
      expect(context.userPreferences.topics).toContain('weather');
      expect(context.userPreferences.topics).toContain('travel');
    });
  });

  describe('intent extraction', () => {
    it('should extract seeking_help intent', async () => {
      const sessionId = 'test-session-id';
      const mockSession = createCallSession('test-call', '+1234567890');
      mockSession.sessionId = sessionId;
      mockSession.conversationHistory = [
        createConversationEntry('user', 'Can you help me with something?'),
      ];

      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const context = await contextManager.buildAIContext(sessionId);

      expect(context.lastUserIntent).toBe('seeking_help');
    });

    it('should extract ending_conversation intent', async () => {
      const sessionId = 'test-session-id';
      const mockSession = createCallSession('test-call', '+1234567890');
      mockSession.sessionId = sessionId;
      mockSession.conversationHistory = [
        createConversationEntry('user', 'Thank you, bye!'),
      ];

      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const context = await contextManager.buildAIContext(sessionId);

      expect(context.lastUserIntent).toBe('ending_conversation');
    });

    it('should extract asking_question intent', async () => {
      const sessionId = 'test-session-id';
      const mockSession = createCallSession('test-call', '+1234567890');
      mockSession.sessionId = sessionId;
      mockSession.conversationHistory = [
        createConversationEntry('user', 'What is the capital of France?'),
      ];

      mockSessionManager.getSession.mockResolvedValueOnce(mockSession);

      const context = await contextManager.buildAIContext(sessionId);

      expect(context.lastUserIntent).toBe('asking_question');
    });
  });
});