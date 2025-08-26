import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Received webhook event:', JSON.stringify(event, null, 2));
  
  const path = event.path;
  const httpMethod = event.httpMethod;
  
  try {
    // Parse Twilio webhook parameters
    const body = event.body ? parseFormData(event.body) : {};
    console.log('Parsed webhook body:', body);
    
    // Route to appropriate handler based on path
    if (path.includes('/webhook/voice') && httpMethod === 'POST') {
      return handleVoiceWebhook(body);
    } else if (path.includes('/webhook/speech') && httpMethod === 'POST') {
      return handleSpeechWebhook(body);
    } else if (path.includes('/webhook/events') && httpMethod === 'POST') {
      return handleEventsWebhook(body);
    }
    
    // Default response
    return createTwiMLResponse('Hello from PromptCall AI. Please try calling again.');
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/xml'
      },
      body: '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, there was an error. Please try again.</Say></Response>'
    };
  }
};

function parseFormData(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};
  
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  
  return result;
}

function handleVoiceWebhook(body: Record<string, string>): APIGatewayProxyResult {
  const callSid = body.CallSid;
  const from = body.From;
  const to = body.To;
  
  console.log(`Incoming call from ${from} to ${to}, CallSid: ${callSid}`);
  
  // Create TwiML response for welcome message and recording
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Welcome to PromptCall AI. Please speak your question after the beep, and I'll help you with an AI-powered response.</Say>
  <Record 
    action="/webhook/speech" 
    method="POST" 
    maxLength="30" 
    timeout="10"
    playBeep="true"
    recordingStatusCallback="/webhook/events"
    recordingStatusCallbackMethod="POST"
  />
  <Say voice="alice">I didn't hear anything. Please try calling again.</Say>
</Response>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml'
    },
    body: twiml
  };
}

function handleSpeechWebhook(body: Record<string, string>): APIGatewayProxyResult {
  const recordingUrl = body.RecordingUrl;
  const callSid = body.CallSid;
  
  console.log(`Speech recording received for CallSid: ${callSid}, URL: ${recordingUrl}`);
  
  // For now, just acknowledge the recording and provide a basic response
  // In later tasks, this will integrate with Transcribe, Bedrock, and Polly
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you for your question. I'm processing your request and will have an AI response ready soon. This is a basic response for now.</Say>
  <Pause length="1"/>
  <Say voice="alice">Is there anything else I can help you with?</Say>
  <Record 
    action="/webhook/speech" 
    method="POST" 
    maxLength="30" 
    timeout="10"
    playBeep="true"
  />
  <Say voice="alice">Thank you for using PromptCall AI. Goodbye!</Say>
</Response>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml'
    },
    body: twiml
  };
}

function handleEventsWebhook(body: Record<string, string>): APIGatewayProxyResult {
  const recordingStatus = body.RecordingStatus;
  const callSid = body.CallSid;
  
  console.log(`Recording event for CallSid: ${callSid}, Status: ${recordingStatus}`);
  
  // Log the event for monitoring
  // In later tasks, this will update session status in DynamoDB
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml'
    },
    body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
  };
}

function createTwiMLResponse(message: string): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml'
    },
    body: `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">${message}</Say></Response>`
  };
}