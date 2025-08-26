#!/usr/bin/env ts-node
/**
 * Demonstration script for DynamoDB session management
 * This script will create, read, and update call sessions with conversation history
 * You can see the results in AWS DynamoDB console
 */

import { DynamoSessionManager } from '../src/services/dynamo-session-manager';
import { ConversationContextManager } from '../src/services/conversation-context-manager';

async function demonstrateSessionManagement() {
  console.log('🚀 Starting DynamoDB Session Management Demonstration\n');

  // Initialize session manager
  const sessionManager = new DynamoSessionManager({
    tableName: process.env.SESSION_TABLE_NAME || 'promptcall-sessions',
    region: process.env.AWS_REGION || 'us-east-1',
  });

  // Initialize conversation context manager
  const contextManager = new ConversationContextManager(sessionManager);

  try {
    // Test 1: Health Check
    console.log('📋 Step 1: Testing DynamoDB connectivity...');
    const isHealthy = await sessionManager.healthCheck();
    console.log(`   ✅ DynamoDB Health Check: ${isHealthy ? 'PASSED' : 'FAILED'}\n`);

    if (!isHealthy) {
      console.log('❌ Cannot connect to DynamoDB. Please check your AWS credentials and table configuration.');
      return;
    }

    // Test 2: Create a new session
    console.log('📋 Step 2: Creating a new call session...');
    const callSid = `demo-call-${Date.now()}`;
    const phoneNumber = '+1234567890';
    
    const { session, context } = await contextManager.initializeConversation(
      callSid,
      phoneNumber,
      { responseLength: 'medium', language: 'en' }
    );

    console.log(`   ✅ Created session: ${session.sessionId}`);
    console.log(`   📞 Call SID: ${session.callSid}`);
    console.log(`   📱 Phone: ${session.phoneNumber}`);
    console.log(`   🕐 Started: ${new Date(session.startTime).toISOString()}`);
    console.log(`   ⏰ TTL: ${new Date(session.ttl * 1000).toISOString()}\n`);

    // Test 3: Add conversation history
    console.log('📋 Step 3: Adding conversation history...');
    
    // User message 1
    await contextManager.processUserMessage(
      session.sessionId,
      'Hello, I need help with the weather forecast',
      'https://example.com/audio/user-message-1.wav',
      0.95
    );
    console.log('   💬 Added user message: "Hello, I need help with the weather forecast"');

    // AI response 1
    await contextManager.processAIResponse(
      session.sessionId,
      'I can help you with weather information. What location are you interested in?',
      'https://example.com/audio/ai-response-1.wav',
      1200
    );
    console.log('   🤖 Added AI response: "I can help you with weather information..."');

    // User message 2
    await contextManager.processUserMessage(
      session.sessionId,
      'What is the weather like in New York City today?',
      'https://example.com/audio/user-message-2.wav',
      0.92
    );
    console.log('   💬 Added user message: "What is the weather like in New York City today?"');

    // AI response 2
    await contextManager.processAIResponse(
      session.sessionId,
      'The weather in New York City today is sunny with a high of 75°F and low of 60°F. There is a 10% chance of rain.',
      'https://example.com/audio/ai-response-2.wav',
      1800
    );
    console.log('   🤖 Added AI response: "The weather in New York City today is sunny..."');

    // System message
    await sessionManager.addSystemMessage(session.sessionId, 'Call quality is excellent');
    console.log('   ⚙️  Added system message: "Call quality is excellent"\n');

    // Test 4: Read and display session data
    console.log('📋 Step 4: Reading session data from DynamoDB...');
    const retrievedSession = await sessionManager.getSession(session.sessionId);
    
    if (retrievedSession) {
      console.log(`   ✅ Successfully retrieved session: ${retrievedSession.sessionId}`);
      console.log(`   📊 Conversation entries: ${retrievedSession.conversationHistory.length}`);
      console.log(`   📈 Session status: ${retrievedSession.status}`);
      console.log(`   🕐 Last activity: ${new Date(retrievedSession.lastActivity).toISOString()}\n`);

      // Display conversation history
      console.log('   📜 Conversation History:');
      retrievedSession.conversationHistory.forEach((entry, index) => {
        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
        const speaker = entry.type === 'user' ? '👤 User' : entry.type === 'ai' ? '🤖 AI' : '⚙️  System';
        const text = entry.text.length > 60 ? entry.text.substring(0, 60) + '...' : entry.text;
        console.log(`      ${index + 1}. [${timestamp}] ${speaker}: ${text}`);
        if (entry.confidence) {
          console.log(`         📊 Confidence: ${(entry.confidence * 100).toFixed(1)}%`);
        }
        if (entry.audioUrl) {
          console.log(`         🎵 Audio: ${entry.audioUrl}`);
        }
      });
      console.log();
    }

    // Test 5: Update session metadata
    console.log('📋 Step 5: Updating session metadata...');
    await sessionManager.updateCallDuration(session.sessionId, 180); // 3 minutes
    console.log('   ✅ Updated call duration to 180 seconds');

    await sessionManager.updateSessionStatus(session.sessionId, 'completed', Date.now());
    console.log('   ✅ Updated session status to "completed"\n');

    // Test 6: Build AI context
    console.log('📋 Step 6: Building AI context for conversation...');
    const aiContext = await contextManager.buildAIContext(session.sessionId);
    console.log(`   🧠 AI Context built successfully`);
    console.log(`   📝 System prompt length: ${aiContext.systemPrompt.length} characters`);
    console.log(`   💭 Conversation context length: ${aiContext.conversationContext.length} characters`);
    console.log(`   🎯 Last user intent: ${aiContext.lastUserIntent}`);
    console.log(`   📚 Topics discussed: ${aiContext.userPreferences.topics.join(', ')}`);
    console.log(`   ⚡ Response preference: ${aiContext.userPreferences.responseLength}\n`);

    // Test 7: Get conversation statistics
    console.log('📋 Step 7: Getting conversation statistics...');
    const stats = await contextManager.getConversationStats(session.sessionId);
    console.log(`   📊 Turn count: ${stats.turnCount}`);
    console.log(`   ⏱️  Duration: ${stats.duration} seconds`);
    console.log(`   📏 Average response length: ${stats.averageResponseLength} characters`);
    console.log(`   🏷️  Topics discussed: ${stats.topicsDiscussed.join(', ')}`);
    console.log(`   💪 User engagement: ${stats.userEngagement}\n`);

    // Test 8: Session health check
    console.log('📋 Step 8: Checking session health...');
    const health = await contextManager.checkSessionHealth(session.sessionId);
    console.log(`   🏥 Needs attention: ${health.needsAttention}`);
    if (health.needsAttention) {
      console.log(`   ⚠️  Reasons: ${health.reasons.join(', ')}`);
      console.log(`   💡 Recommendations: ${health.recommendations.join(', ')}`);
    } else {
      console.log('   ✅ Session is healthy');
    }
    console.log();

    // Test 9: List active sessions
    console.log('📋 Step 9: Listing active sessions...');
    const activeSessions = await sessionManager.listActiveSessions(10);
    console.log(`   📋 Found ${activeSessions.length} active sessions`);
    activeSessions.forEach((s, index) => {
      console.log(`      ${index + 1}. ${s.sessionId} (${s.callSid}) - ${s.phoneNumber}`);
    });
    console.log();

    // Test 10: Retrieve by Call SID
    console.log('📋 Step 10: Testing retrieval by Call SID...');
    const sessionByCallSid = await sessionManager.getSessionByCallSid(callSid);
    if (sessionByCallSid) {
      console.log(`   ✅ Successfully retrieved session by Call SID: ${sessionByCallSid.sessionId}`);
    } else {
      console.log('   ❌ Failed to retrieve session by Call SID');
    }
    console.log();

    // Final verification
    console.log('📋 Step 11: Final verification - reading updated session...');
    const finalSession = await sessionManager.getSession(session.sessionId);
    if (finalSession) {
      console.log(`   ✅ Session status: ${finalSession.status}`);
      console.log(`   ✅ Total duration: ${finalSession.totalDuration} seconds`);
      console.log(`   ✅ End time: ${finalSession.endTime ? new Date(finalSession.endTime).toISOString() : 'Not set'}`);
      console.log(`   ✅ Conversation entries: ${finalSession.conversationHistory.length}`);
    }

    console.log('\n🎉 Session Management Demonstration Complete!');
    console.log('\n📍 You can now view this session data in AWS DynamoDB Console:');
    console.log(`   🔗 Table: ${sessionManager['tableName']}`);
    console.log(`   🆔 Session ID: ${session.sessionId}`);
    console.log(`   📞 Call SID: ${callSid}`);
    console.log('\n💡 To view in AWS Console:');
    console.log('   1. Go to AWS DynamoDB Console');
    console.log('   2. Navigate to Tables > promptcall-sessions');
    console.log('   3. Click "Explore table items"');
    console.log(`   4. Search for sessionId: ${session.sessionId}`);

    // Optional: Clean up (comment out to keep data for inspection)
    console.log('\n🧹 Cleaning up demo session...');
    await sessionManager.deleteSession(session.sessionId);
    console.log('   ✅ Demo session deleted');

  } catch (error) {
    console.error('❌ Error during demonstration:', error);
    
    if (error.message?.includes('ResourceNotFoundException')) {
      console.log('\n💡 It looks like the DynamoDB table does not exist.');
      console.log('   Please deploy the CDK stack first:');
      console.log('   npm run deploy');
    } else if (error.message?.includes('UnrecognizedClientException')) {
      console.log('\n💡 AWS credentials issue detected.');
      console.log('   Please configure your AWS credentials:');
      console.log('   aws configure');
    } else if (error.message?.includes('AccessDeniedException')) {
      console.log('\n💡 Permission issue detected.');
      console.log('   Please ensure your AWS user has DynamoDB permissions.');
    }
  }
}

// Run the demonstration
if (require.main === module) {
  demonstrateSessionManagement()
    .then(() => {
      console.log('\n✨ Demonstration completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Demonstration failed:', error);
      process.exit(1);
    });
}

export { demonstrateSessionManagement };