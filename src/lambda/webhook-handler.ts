import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DTMFService, DTMFInput } from '../services/dtmf-service';

const dtmfService = new DTMFService();

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
    } else if (path.includes('/webhook/dtmf') && httpMethod === 'POST') {
      return handleDTMFWebhook(body);
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
  
  // Create TwiML response with welcome message and recording
  const welcomeMessage = dtmfService.generateWelcomeWithInstructions();
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${welcomeMessage}</Say>
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
  
  // After speech recording, immediately wait for DTMF input without any prompt
  // User should press "1" to submit or "0" to end call
  const gatherTwiML = dtmfService.generateGatherTwiML({
    action: '/webhook/dtmf',
    timeout: 30, // Give user time to press a key
    numDigits: 1,
    finishOnKey: '' // Don't require finish key, just single digit
  });
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${gatherTwiML}
  <Say voice="alice">I didn't receive any keypad input. Please press 1 to submit your question or 0 to end the call.</Say>
</Response>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml'
    },
    body: twiml
  };
}

function handleDTMFWebhook(body: Record<string, string>): APIGatewayProxyResult {
  const digits = body.Digits;
  const callSid = body.CallSid;
  const from = body.From;
  const to = body.To;
  
  console.log(`DTMF input received: ${digits} for CallSid: ${callSid}`);
  
  const dtmfInput: DTMFInput = {
    digits,
    callSid,
    from,
    to
  };
  
  const response = dtmfService.processDTMFInput(dtmfInput);
  
  let twiml = `<?xml version="1.0" encoding="UTF-8"?><Response>`;
  
  if (response.message) {
    twiml += `<Say voice="alice">${response.message}</Say>`;
  }
  
  if (response.action === 'submit') {
    // User pressed "1" - process their spoken prompt
    twiml += `<Say voice="alice">Processing your request now. Please wait.</Say>`;
    // In later tasks, this will trigger AI processing
    twiml += `<Say voice="alice">This is a placeholder response. Your AI processing will be implemented in later tasks.</Say>`;
    twiml += `<Pause length="1"/>`;
    twiml += `<Say voice="alice">Is there anything else I can help you with?</Say>`;
    
    // Continue with another recording session
    const recordWithDTMF = dtmfService.generateRecordWithDTMFTwiML({
      speechAction: '/webhook/speech',
      dtmfAction: '/webhook/dtmf',
      maxLength: 30,
      timeout: 10,
      prompt: dtmfService.generateControlsReminder()
    });
    twiml += recordWithDTMF;
    
  } else if (response.action === 'end_call') {
    // User pressed "0" - end the call gracefully
    twiml += `<Hangup/>`;
    
  } else if (response.action === 'help') {
    // User pressed "*" - provide help
    twiml += `<Pause length="1"/>`;
    
    // Continue with recording after help
    const recordWithDTMF = dtmfService.generateRecordWithDTMFTwiML({
      speechAction: '/webhook/speech',
      dtmfAction: '/webhook/dtmf',
      maxLength: 30,
      timeout: 10,
      prompt: 'Please speak your question after the beep.'
    });
    twiml += recordWithDTMF;
    
  } else {
    // Invalid input - provide guidance and continue
    twiml += `<Pause length="1"/>`;
    
    const recordWithDTMF = dtmfService.generateRecordWithDTMFTwiML({
      speechAction: '/webhook/speech',
      dtmfAction: '/webhook/dtmf',
      maxLength: 30,
      timeout: 10,
      prompt: 'Please speak your question after the beep.'
    });
    twiml += recordWithDTMF;
  }
  
  twiml += `</Response>`;
  
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