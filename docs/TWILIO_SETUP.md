# Twilio Setup Guide for PromptCall AI

This guide will help you set up Twilio credentials and phone number for Milestone 3: Basic Call Handling.

## 🎯 What You'll Need

- Twilio Account SID
- Twilio Auth Token  
- Twilio Phone Number (with Voice capabilities)

## 📋 Step-by-Step Setup

### Step 1: Create Twilio Account

1. Go to [Twilio Console](https://console.twilio.com/)
2. Click **"Sign up"** if you don't have an account
3. Complete the registration process
4. Verify your phone number
5. You'll get **$15 in free credits** to start

### Step 2: Get Account Credentials

1. In the Twilio Console, you'll see your **Account SID** and **Auth Token** on the dashboard
2. Copy these values - you'll need them for environment variables

   ```
   Account SID: ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   Auth Token: your_auth_token_here
   ```

### Step 3: Purchase a Phone Number

#### Option A: Nigerian Number (Recommended for Nigerian users)
1. In Twilio Console, go to **Phone Numbers** → **Manage** → **Buy a number**
2. Choose **Nigeria** from the country dropdown
3. Filter by **Voice** capabilities
4. Select a Nigerian number (+234...)
5. Click **Buy** (costs vary by country, typically $1-5/month)
6. Copy the phone number (format: +234xxxxxxxxx)

#### Option B: US Number (Good for development/testing)
1. Choose **United States** from the country dropdown
2. Filter by **Voice** capabilities  
3. Select a US number (+1...)
4. Click **Buy** (costs approximately $1/month)
5. Copy the phone number (format: +1234567890)

#### Option C: Port Your Existing Nigerian Number
1. Contact Twilio support to port your existing number
2. This keeps your current number but adds Twilio capabilities
3. More complex process but maintains your existing number

### Step 4: Configure Environment Variables

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` file with your Twilio credentials:
   ```bash
   # Twilio Configuration
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token_here
   TWILIO_PHONE_NUMBER=+1234567890
   
   # AWS Configuration  
   AWS_REGION=us-east-1
   SESSION_TABLE_NAME=promptcall-sessions
   ```

### Step 5: Deploy Infrastructure

Deploy the CDK stack to get your API Gateway URLs:

```bash
npm run deploy
```

This will output your webhook URLs that look like:
```
https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/webhook/voice
https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/webhook/speech
https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/webhook/events
```

### Step 6: Configure Twilio Webhooks

1. In Twilio Console, go to **Phone Numbers** → **Manage** → **Active numbers**
2. Click on your purchased phone number
3. In the **Voice Configuration** section:
   - **Webhook URL**: `https://your-api-gateway-url/webhook/voice`
   - **HTTP Method**: `POST`
4. Click **Save**

## 🧪 Testing Your Setup

### Test 1: Verify Credentials
```bash
npm run check-twilio
```

### Test 2: Test Webhooks
```bash
npm run test-webhooks
```

### Test 3: Make a Test Call
1. Call your Twilio phone number
2. You should hear a welcome message
3. Check DynamoDB for the created session

## 💰 Cost Breakdown

### Nigerian Numbers
- **Phone Number**: ~$3-5/month (varies by number type)
- **Incoming Calls**: ~$0.02-0.05/minute (local rates)
- **Text-to-Speech**: $0.04 per 1,000 characters
- **Recording**: $0.0025/minute

### US Numbers (for comparison)
- **Phone Number**: ~$1/month
- **Incoming Calls**: $0.0085/minute
- **Text-to-Speech**: $0.04 per 1,000 characters
- **Recording**: $0.0025/minute

**Example**: A 2-minute call in Nigeria with 200 characters of TTS costs approximately $0.05-0.15

## 🔒 Security Best Practices

### Use API Keys (Recommended)
Instead of using your Auth Token directly, create API Keys:

1. Go to **Account** → **API keys & tokens** → **Create API key**
2. Give it a friendly name like "PromptCall AI"
3. Copy the **SID** and **Secret**
4. Add to your `.env`:
   ```bash
   TWILIO_API_KEY_SID=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_API_KEY_SECRET=your_api_key_secret_here
   ```

### Webhook Signature Validation
We'll implement Twilio signature validation to ensure webhooks are authentic.

## 🚨 Troubleshooting

### Common Issues

1. **"Invalid credentials"**
   - Double-check your Account SID and Auth Token
   - Make sure there are no extra spaces

2. **"Phone number not found"**
   - Ensure the phone number includes country code (+1 for US)
   - Format: +1234567890 (no spaces or dashes)

3. **"Webhook timeout"**
   - Check that your API Gateway is deployed
   - Verify the webhook URL is correct
   - Check CloudWatch logs for errors

### Getting Help

- **Twilio Docs**: https://www.twilio.com/docs/voice
- **Twilio Support**: Available in the console
- **Community**: https://stackoverflow.com/questions/tagged/twilio

## 📞 What Happens Next

Once you have Twilio set up, we can:

1. **Receive Calls** - Handle incoming calls to your Twilio number
2. **Play Messages** - Use text-to-speech for welcome messages
3. **Record Audio** - Capture user speech for transcription
4. **Manage Sessions** - Create DynamoDB sessions for each call
5. **Handle Events** - Process call start, end, and error events

The system will be ready for end-to-end testing with real phone calls! 🎉