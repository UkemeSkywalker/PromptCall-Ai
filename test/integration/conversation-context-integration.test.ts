/**
 * Integration test for Conversation Context Manager
 * This test demonstrates the complete conversation flow
 */

import { ConversationContextManager } from '../../src/services/conversation-context-manager';
import { DynamoSessionManager } from '../../src/services/dynamo-session-manager';

// Skip these tests by default since they require AWS setup
const runIntegrationTests = process.env.RUN_INTEGRATION_TESTS === 'true';

describe.skip('Conversation Context Integration Tests', () => {
  let contextManager: ConversationContextManager;
  let sessionManager: DynamoSessionManager;
  const testTableName = process.env.TEST_TABLE_NAME || 'promptcall-sessions-test';
  
  beforeAll(() => {
    if (!runIntegrationTests) {
      console.log('Skipping integration tests. Set RUN_INTEGRATION_TESTS=true to run.');
      return;
    }
    
    sessionManager = new DynamoSessionManager({
      tableName: testTableName,
      region: process.env.AWS_REGION || 'us-east-1',
    });
    
    contextManager = new ConversationContextManager(sessionManager);
  });

  afterEach(async () => {
    if (!runIntegrationTests) return;
    
    // Clean up test sessions
    try {
      const activeSessions = await sessionManager.listActiveSessions();
      for (const session of activeSessions) {
        if (session.callSid.startsWith('test-context-')) {
          await sessionManager.deleteSession(session.sessionId);
        }
      }
    } catch (error) {
      console.log('Cleanup error (expected if no sessions):', error);
    }
  });

  it('should manage complete conversation lifecycle with context', async () => {
    if (!runIntegrationTests) return;
    
    const callSid = 'test-context-call';
    const phoneNumber = '+1234567890';
    
    // Initialize conversation
    const { session, context: initialContext } = await contextManager.initializeConversation(
      callSid, 
      phoneNumber,
      { responseLength: 'medium' }
    );
    
    expect(session.sessionId).toBeDefined();
    expect(initialContext.systemPrompt).toContain('start of the conversation');
    expect(initialContext.userPreferences.responseLength).toBe('medium');
    
    // Process first user message
    const context1 = await contextManager.processUserMessage(
      session.sessionId,
      'Hello, I need help with the weather',
      'https://example.com/audio1.wav',
      0.95
    );
    
    expect(context1.conversationContext).toContain('User: Hello, I need help with the weather');
    expect(context1.lastUserIntent).toBe('seeking_help');
    expect(context1.userPreferences.topics).toContain('weather');
    
    // Process AI response
    await contextManager.processAIResponse(
      session.sessionId,
      'I can help you with weather information. What location are you interested in?',
      'https://example.com/response1.wav',
      1200
    );
    
    // Process second user message
    const context2 = await contextManager.processUserMessage(
      session.sessionId,
      'What is the weather like in New York today?',
      'https://example.com/audio2.wav',
      0.92
    );
    
    expect(context2.conversationContext).toContain('User: Hello, I need help with the weather');
    expect(context2.conversationContext).toContain('Assistant: I can help you with weather information');
    expect(context2.conversationContext).toContain('User: What is the weather like in New York today?');
    expect(context2.lastUserIntent).toBe('asking_question');
    
    // Process final AI response
    await contextManager.processAIResponse(
      session.sessionId,
      'The weather in New York today is sunny with a high of 75 degrees Fahrenheit.',
      'https://example.com/response2.wav',
      1500
    );
    
    // Check session health
    const health = await contextManager.checkSessionHealth(session.sessionId);
    expect(health.needsAttention).toBe(false);
    
    // Get conversation statistics
    const stats = await contextManager.getConversationStats(session.sessionId);
    expect(stats.turnCount).toBe(2); // 2 user messages
    expect(stats.topicsDiscussed).toContain('weather');
    expect(stats.averageResponseLength).toBeGreaterThan(0);
    
    // Validate AI response
    const testResponse = 'The weather is nice today with sunny skies.';
    const validation = contextManager.validateAIResponse(testResponse, context2.userPreferences);
    expect(validation.isValid).toBe(true);
    
    // Clean up
    await sessionManager.deleteSession(session.sessionId);
  }, 30000);

  it('should handle conversation with preference inference', async () => {
    if (!runIntegrationTests) return;
    
    const callSid = 'test-context-preferences';
    const phoneNumber = '+0987654321';
    
    // Initialize conversation
    const { session } = await contextManager.initializeConversation(callSid, phoneNumber);
    
    // Add short user messages to infer short response preference
    await contextManager.processUserMessage(session.sessionId, 'Hi');
    await contextManager.processAIResponse(session.sessionId, 'Hello! How can I help?');
    
    await contextManager.processUserMessage(session.sessionId, 'Weather?');
    await contextManager.processAIResponse(session.sessionId, 'Sure, what location?');
    
    // Build context and check inferred preferences
    const context = await contextManager.buildAIContext(session.sessionId);
    expect(context.userPreferences.responseLength).toBe('short');
    
    // Clean up
    await sessionManager.deleteSession(session.sessionId);
  }, 30000);

  it('should detect session health issues', async () => {
    if (!runIntegrationTests) return;
    
    const callSid = 'test-context-health';
    const phoneNumber = '+1111111111';
    
    // Initialize conversation
    const { session } = await contextManager.initializeConversation(callSid, phoneNumber);
    
    // Create a long conversation to trigger summary recommendation
    for (let i = 0; i < 20; i++) {
      await contextManager.processUserMessage(session.sessionId, `User message ${i}`);
      await contextManager.processAIResponse(session.sessionId, `AI response ${i}`);
    }
    
    // Check session health
    const health = await contextManager.checkSessionHealth(session.sessionId);
    expect(health.needsAttention).toBe(true);
    expect(health.reasons).toContain('Long conversation may need summarization');
    
    // Clean up
    await sessionManager.deleteSession(session.sessionId);
  }, 30000);
});