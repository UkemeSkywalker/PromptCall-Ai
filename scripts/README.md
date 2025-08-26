# Session Management Demonstration

This directory contains scripts to demonstrate the DynamoDB session management capabilities of PromptCall AI.

## Prerequisites

1. **AWS Credentials**: Configure your AWS credentials

   ```bash
   aws configure
   ```

2. **Deploy Infrastructure**: Deploy the CDK stack to create the DynamoDB table
   ```bash
   npm run deploy
   ```

## Running the Demonstration

### Option 1: Using npm script (Recommended)

```bash
npm run demo
```

### Option 2: Direct execution

```bash
# Build first
npm run build

# Run the demonstration
node scripts/test-session-management.js
```

## What the Demonstration Does

The script will:

1. **Health Check** - Verify DynamoDB connectivity
2. **Create Session** - Create a new call session with unique ID
3. **Add Conversation** - Add realistic conversation history:
   - User messages with confidence scores and audio URLs
   - AI responses with processing times
   - System messages for call quality
4. **Read Session** - Retrieve and display session data
5. **Update Metadata** - Update call duration and session status
6. **Build AI Context** - Generate conversation context for AI processing
7. **Get Statistics** - Calculate conversation metrics
8. **List Sessions** - Show all active sessions

## Viewing Results in AWS Console

After running the demonstration, you can view the session data in AWS DynamoDB Console:

1. Go to [AWS DynamoDB Console](https://console.aws.amazon.com/dynamodb/)
2. Navigate to **Tables** > **promptcall-sessions**
3. Click **"Explore table items"**
4. Look for the session ID printed by the script

## Sample Output

```
🚀 Starting DynamoDB Session Management Demonstration

📋 Step 1: Testing DynamoDB connectivity...
   ✅ DynamoDB Health Check: PASSED

📋 Step 2: Creating a new call session...
   ✅ Created session: 550e8400-e29b-41d4-a716-446655440000
   📞 Call SID: demo-call-1640995200000
   📱 Phone: +1234567890
   🕐 Started: 2024-01-01T12:00:00.000Z
   ⏰ TTL: 2024-01-02T12:00:00.000Z

📋 Step 3: Adding conversation history...
   💬 Added user message: "Hello, I need help with the weather forecast"
   🤖 Added AI response: "I can help you with weather information..."
   💬 Added user message: "What is the weather like in New York City today?"
   🤖 Added AI response: "The weather in New York City today is sunny..."
   ⚙️  Added system message: "Call quality is excellent"

📋 Step 4: Reading session data from DynamoDB...
   ✅ Successfully retrieved session: 550e8400-e29b-41d4-a716-446655440000
   📊 Conversation entries: 5
   📈 Session status: active
   🕐 Last activity: 2024-01-01T12:05:00.000Z

   📜 Conversation History:
      1. [12:00:30 PM] ⚙️  System: Conversation initialized - greeting phase
      2. [12:01:15 PM] 👤 User: Hello, I need help with the weather forecast
         📊 Confidence: 95.0%
         🎵 Audio: https://example.com/audio/user-message-1.wav
      3. [12:01:45 PM] 🤖 AI: I can help you with weather information. What location...
         🎵 Audio: https://example.com/audio/ai-response-1.wav
      4. [12:02:30 PM] 👤 User: What is the weather like in New York City today?
         📊 Confidence: 92.0%
         🎵 Audio: https://example.com/audio/user-message-2.wav
      5. [12:03:15 PM] 🤖 AI: The weather in New York City today is sunny with a high...
         🎵 Audio: https://example.com/audio/ai-response-2.wav
      6. [12:03:45 PM] ⚙️  System: Call quality is excellent

📋 Step 5: Updating session metadata...
   ✅ Updated call duration to 180 seconds
   ✅ Updated session status to "completed"

📋 Step 6: Building AI context for conversation...
   🧠 AI Context built successfully
   📝 System prompt length: 1247 characters
   💭 Conversation context length: 456 characters
   🎯 Last user intent: asking_question
   📚 Topics discussed: weather
   ⚡ Response preference: medium

📋 Step 7: Getting conversation statistics...
   📊 Turn count: 2
   ⏱️  Duration: 180 seconds
   📏 Average response length: 89 characters
   🏷️  Topics discussed: weather
   💪 User engagement: medium

🎉 Session Management Demonstration Complete!

📍 You can now view this session data in AWS DynamoDB Console:
   🔗 Table: promptcall-sessions
   🆔 Session ID: 550e8400-e29b-41d4-a716-446655440000
   📞 Call SID: demo-call-1640995200000

💡 To view in AWS Console:
   1. Go to AWS DynamoDB Console
   2. Navigate to Tables > promptcall-sessions
   3. Click "Explore table items"
   4. Search for sessionId: 550e8400-e29b-41d4-a716-446655440000

📌 Session preserved for inspection in DynamoDB Console
   Session will auto-expire in 24 hours due to TTL: 2024-01-02T12:00:00.000Z

✨ Demonstration completed successfully!
```

## Data Structure in DynamoDB

The session data stored in DynamoDB will look like this:

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "callSid": "demo-call-1640995200000",
  "phoneNumber": "+1234567890",
  "startTime": 1640995200000,
  "endTime": 1640995380000,
  "status": "completed",
  "totalDuration": 180,
  "lastActivity": 1640995380000,
  "ttl": 1641081600,
  "conversationHistory": [
    {
      "id": "entry-1",
      "timestamp": 1640995230000,
      "type": "system",
      "text": "Conversation initialized - greeting phase"
    },
    {
      "id": "entry-2",
      "timestamp": 1640995275000,
      "type": "user",
      "text": "Hello, I need help with the weather forecast",
      "audioUrl": "https://example.com/audio/user-message-1.wav",
      "confidence": 0.95
    },
    {
      "id": "entry-3",
      "timestamp": 1640995305000,
      "type": "ai",
      "text": "I can help you with weather information. What location are you interested in?",
      "audioUrl": "https://example.com/audio/ai-response-1.wav",
      "processingDuration": 1200
    }
  ]
}
```

## Troubleshooting

### Common Issues

1. **ResourceNotFoundException**: The DynamoDB table doesn't exist

   - Solution: Run `npm run deploy` to create the infrastructure

2. **UnrecognizedClientException**: AWS credentials not configured

   - Solution: Run `aws configure` to set up credentials

3. **AccessDeniedException**: Insufficient permissions
   - Solution: Ensure your AWS user has DynamoDB permissions

### Environment Variables

You can customize the demonstration with environment variables:

```bash
# Use a different table name
SESSION_TABLE_NAME=my-custom-table npm run demo

# Use a different AWS region
AWS_REGION=us-west-2 npm run demo
```

## Next Steps

After running this demonstration, you can:

1. **View the data** in AWS DynamoDB Console
2. **Modify the script** to test different scenarios
3. **Run integration tests** with `RUN_INTEGRATION_TESTS=true npm test`
4. **Deploy to production** and test with real Twilio webhooks
