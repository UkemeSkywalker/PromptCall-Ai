/**
 * Integration test for DynamoDB Session Manager
 * This test requires AWS credentials and a real DynamoDB table
 * Run with: npm test -- --testPathPattern=integration --testTimeout=30000
 */

import { DynamoSessionManager } from '../../src/services/dynamo-session-manager';
import { createConversationEntry } from '../../src/types/session';

// Skip these tests by default since they require AWS setup
const runIntegrationTests = process.env.RUN_INTEGRATION_TESTS === 'true';

describe.skip('DynamoDB Integration Tests', () => {
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
  });

  afterEach(async () => {
    if (!runIntegrationTests) return;
    
    // Clean up test sessions
    try {
      const activeSessions = await sessionManager.listActiveSessions();
      for (const session of activeSessions) {
        if (session.callSid.startsWith('test-')) {
          await sessionManager.deleteSession(session.sessionId);
        }
      }
    } catch (error) {
      console.log('Cleanup error (expected if no sessions):', error);
    }
  });

  it('should perform complete session lifecycle', async () => {
    if (!runIntegrationTests) return;
    
    const callSid = 'test-integration-call';
    const phoneNumber = '+1234567890';
    
    // Create session
    const session = await sessionManager.createSession(callSid, phoneNumber);
    expect(session.sessionId).toBeDefined();
    expect(session.callSid).toBe(callSid);
    expect(session.phoneNumber).toBe(phoneNumber);
    
    // Retrieve session
    const retrievedSession = await sessionManager.getSession(session.sessionId);
    expect(retrievedSession).toEqual(session);
    
    // Add conversation entries
    await sessionManager.addUserMessage(
      session.sessionId,
      'Hello, how are you?',
      'https://example.com/audio1.wav',
      0.95
    );
    
    await sessionManager.addAiResponse(
      session.sessionId,
      'I am doing well, thank you! How can I help you today?',
      'https://example.com/response1.wav',
      1500
    );
    
    await sessionManager.addSystemMessage(session.sessionId, 'Call quality is good');
    
    // Update call duration
    await sessionManager.updateCallDuration(session.sessionId, 120);
    
    // Get updated session
    const updatedSession = await sessionManager.getSession(session.sessionId);
    expect(updatedSession?.conversationHistory).toHaveLength(3);
    expect(updatedSession?.totalDuration).toBe(120);
    
    // Build conversation context
    const context = await sessionManager.buildConversationContext(session.sessionId);
    expect(context).toContain('User: Hello, how are you?');
    expect(context).toContain('Assistant: I am doing well, thank you!');
    expect(context).toContain('System: Call quality is good');
    
    // Update session status
    await sessionManager.updateSessionStatus(session.sessionId, 'completed', Date.now());
    
    // Verify final state
    const finalSession = await sessionManager.getSession(session.sessionId);
    expect(finalSession?.status).toBe('completed');
    expect(finalSession?.endTime).toBeDefined();
    
    // Clean up
    await sessionManager.deleteSession(session.sessionId);
    
    // Verify deletion
    const deletedSession = await sessionManager.getSession(session.sessionId);
    expect(deletedSession).toBeNull();
  }, 30000);

  it('should handle session retrieval by call SID', async () => {
    if (!runIntegrationTests) return;
    
    const callSid = 'test-call-sid-lookup';
    const phoneNumber = '+0987654321';
    
    // Create session
    const session = await sessionManager.createSession(callSid, phoneNumber);
    
    // Retrieve by call SID
    const retrievedSession = await sessionManager.getSessionByCallSid(callSid);
    expect(retrievedSession?.sessionId).toBe(session.sessionId);
    expect(retrievedSession?.callSid).toBe(callSid);
    
    // Clean up
    await sessionManager.deleteSession(session.sessionId);
  }, 30000);

  it('should list active sessions', async () => {
    if (!runIntegrationTests) return;
    
    // Create multiple test sessions
    const session1 = await sessionManager.createSession('test-call-1', '+1111111111');
    const session2 = await sessionManager.createSession('test-call-2', '+2222222222');
    
    // List active sessions
    const activeSessions = await sessionManager.listActiveSessions();
    const testSessions = activeSessions.filter(s => s.callSid.startsWith('test-'));
    
    expect(testSessions.length).toBeGreaterThanOrEqual(2);
    
    // Clean up
    await sessionManager.deleteSession(session1.sessionId);
    await sessionManager.deleteSession(session2.sessionId);
  }, 30000);

  it('should perform health check', async () => {
    if (!runIntegrationTests) return;
    
    const isHealthy = await sessionManager.healthCheck();
    expect(isHealthy).toBe(true);
  }, 30000);
});