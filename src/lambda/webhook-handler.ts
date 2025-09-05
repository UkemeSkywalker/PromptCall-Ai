import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

console.log('=== LAMBDA INITIALIZATION START ===');
console.log('Environment variables:', {
  SESSION_TABLE_NAME: process.env.SESSION_TABLE_NAME,
  AUDIO_BUCKET_NAME: process.env.AUDIO_BUCKET_NAME,
  AWS_REGION: process.env.AWS_REGION,
  NODE_ENV: process.env.NODE_ENV
});

console.log('Attempting to import services...');
try {
  console.log('Importing services from ../services');
  const services = require('../services');
  console.log('Available services:', Object.keys(services));

  var {
    DTMFService,
    TwiMLService,
    DynamoSessionManager,
    S3Service,
    TranscriptionProcessor,
    ConversationContextManager,
    AIConversationService
  } = services;

  console.log('Services imported successfully');
} catch (importError) {
  console.error('CRITICAL: Failed to import services:', importError);
  console.error('Import error stack:', importError instanceof Error ? importError.stack : 'No stack trace');
  throw importError;
}

console.log('Initializing service instances...');
try {
  var dtmfService = new DTMFService();
  console.log('DTMFService initialized');

  var twimlService = new TwiMLService();
  console.log('TwiMLService initialized');

  var sessionManager = new DynamoSessionManager({
    tableName: process.env.SESSION_TABLE_NAME || 'promptcall-sessions',
    region: process.env.AWS_REGION || 'us-east-1'
  });
  console.log('DynamoSessionManager initialized');

  var s3Service = new S3Service({
    bucketName: process.env.AUDIO_BUCKET_NAME || 'promptcall-audio-bucket',
    region: process.env.AWS_REGION || 'us-east-1'
  });
  console.log('S3Service initialized');

  var transcriptionProcessor = new TranscriptionProcessor(s3Service, {
    region: process.env.AWS_REGION || 'us-east-1',
    confidenceThreshold: 0.7,
    maxRetries: 2
  });
  console.log('TranscriptionProcessor initialized');

  var contextManager = new ConversationContextManager(sessionManager);
  console.log('ConversationContextManager initialized');

  var aiConversationService = new AIConversationService({
    maxResponseWords: 100, // ~40 seconds of speech for call cost management
    defaultResponseLength: 'medium',
    voiceOptimized: true,
    region: process.env.AWS_REGION || 'us-east-1'
  });
  console.log('AIConversationService initialized');

} catch (initError) {
  console.error('CRITICAL: Failed to initialize services:', initError);
  console.error('Initialization error stack:', initError instanceof Error ? initError.stack : 'No stack trace');
  throw initError;
}

console.log('=== LAMBDA INITIALIZATION COMPLETE ===');

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('=== WEBHOOK REQUEST START ===');
  console.log('Request ID:', event.requestContext?.requestId);
  console.log('Path:', event.path);
  console.log('Method:', event.httpMethod);
  console.log('Headers:', JSON.stringify(event.headers, null, 2));
  console.log('Body:', event.body);
  console.log('=== WEBHOOK REQUEST DETAILS ===');

  const path = event.path;
  const httpMethod = event.httpMethod;

  try {
    console.log('Processing webhook request...');
    console.log('Request path:', path);
    console.log('HTTP method:', httpMethod);

    // Parse Twilio webhook parameters
    const body = event.body ? parseFormData(event.body) : {};
    console.log('Raw body:', event.body);
    console.log('Parsed webhook body:', JSON.stringify(body, null, 2));

    // Route to appropriate handler based on path
    console.log('Routing request...');
    console.log('Path matching check:', {
      path,
      voiceMatch: path.includes('/webhook/voice'),
      speechMatch: path.includes('/webhook/speech'),
      dtmfMatch: path.includes('/webhook/dtmf'),
      eventsMatch: path.includes('/webhook/events'),
      methodMatch: httpMethod === 'POST'
    });

    if (path.includes('/webhook/voice') && httpMethod === 'POST') {
      console.log('✅ Routing to voice webhook handler');
      return handleVoiceWebhook(body, event);
    } else if (path.includes('/webhook/speech') && httpMethod === 'POST') {
      console.log('✅ Routing to speech webhook handler - ENDPOINT REACHED');
      return handleSpeechWebhook(body, event);
    } else if (path.includes('/webhook/transcription-status') && (httpMethod === 'POST' || httpMethod === 'GET')) {
      console.log('✅ Routing to transcription status handler');
      return await handleTranscriptionStatus(body, event);
    } else if (path.includes('/webhook/dtmf') && httpMethod === 'POST') {
      console.log('✅ Routing to DTMF webhook handler');
      return await handleDTMFWebhook(body, event);
    } else if (path.includes('/webhook/events') && httpMethod === 'POST') {
      console.log('✅ Routing to events webhook handler');
      return await handleEventsWebhook(body);
    }

    console.log('❌ No matching route found');
    console.log('Available routes should be: /webhook/voice, /webhook/speech, /webhook/dtmf, /webhook/events');
    console.log('Actual path received:', path);

    // Add a test endpoint for debugging
    if (path.includes('/test') || path === '/') {
      console.log('Test endpoint hit - Lambda is working');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Lambda is working',
          timestamp: new Date().toISOString(),
          path: path,
          method: httpMethod
        })
      };
    }

    // Default response
    return createTwiMLResponse('Hello from PromptCall AI. Please try calling again.');

  } catch (error) {
    console.error('=== CRITICAL ERROR IN WEBHOOK HANDLER ===');
    console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('Request context:', {
      path: event.path,
      method: event.httpMethod,
      requestId: event.requestContext?.requestId
    });
    console.error('=== END CRITICAL ERROR ===');

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
  return TwiMLService.parseWebhookParams(body);
}

function getBaseUrl(event: APIGatewayProxyEvent): string {
  return `https://${event.headers.Host}${event.requestContext.stage ? `/${event.requestContext.stage}` : ''}`;
}

async function handleVoiceWebhook(body: Record<string, string>, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { callSid, from, to, callStatus } = TwiMLService.extractTwilioParams(body);

  console.log(`Incoming call from ${from} to ${to}, CallSid: ${callSid}, Status: ${callStatus}`);

  try {
    // Create new session when call starts
    const session = await sessionManager.createSession(callSid, from);

    // Add system message to track call start
    await sessionManager.addSystemMessage(session.sessionId, `Call started from ${from} to ${to}, Status: ${callStatus}`);

    console.log(`Created session for CallSid: ${callSid}, SessionId: ${session.sessionId}`);
  } catch (error) {
    console.error('Error creating session:', error);
    // Continue with call even if session creation fails
  }

  // Create TwiML response with welcome message and DTMF-enabled recording
  const welcomeMessage = dtmfService.generateWelcomeWithInstructions();

  // Get the base URL from the event
  const baseUrl = getBaseUrl(event);

  // Use DTMF-enabled recording for consistent "press 1 to submit" experience
  const recordWithDTMF = dtmfService.generateRecordWithDTMFTwiML({
    speechAction: `${baseUrl}/webhook/speech`,
    dtmfAction: `${baseUrl}/webhook/dtmf`,
    maxLength: 30,
    timeout: 10,
    prompt: welcomeMessage
  });

  const twiml = twimlService.createComplexResponse([
    recordWithDTMF
  ]);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml'
    },
    body: twiml
  };
}

async function handleSpeechWebhook(body: Record<string, string>, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('=== SPEECH WEBHOOK HANDLER START ===');
  console.log('Speech endpoint reached successfully - no 403 error here');

  const { recordingUrl, callSid, recordingDuration } = TwiMLService.extractTwilioParams(body);

  console.log('Speech webhook parameters:', {
    callSid,
    recordingUrl,
    recordingDuration,
    allParams: body
  });

  console.log(`Speech recording received for CallSid: ${callSid}, URL: ${recordingUrl}, Duration: ${recordingDuration}s`);

  try {
    console.log('Attempting to find session by CallSid...');
    // Find session by CallSid
    const session = await sessionManager.getSessionByCallSid(callSid);
    console.log('Session lookup result:', session ? 'Found' : 'Not found');

    if (!session) {
      console.warn(`Session not found for CallSid: ${callSid}`);
      const twiml = twimlService.createSayResponse('Sorry, there was an error. Please try again.');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/xml' },
        body: twiml
      };
    }

    console.log('Validating audio quality...');
    // Quick audio validation
    const audioValidation = transcriptionProcessor.validateAudioQuality({
      url: recordingUrl,
      duration: recordingDuration ? parseFloat(recordingDuration) : undefined
    });

    if (!audioValidation.isValid) {
      console.warn(`Audio quality issues for CallSid ${callSid}:`, audioValidation.issues);
      await sessionManager.addSystemMessage(session.sessionId, `Audio quality issues: ${audioValidation.issues.join(', ')}`);

      const baseUrl = getBaseUrl(event);
      const recordWithDTMF = dtmfService.generateRecordWithDTMFTwiML({
        speechAction: `${baseUrl}/webhook/speech`,
        dtmfAction: `${baseUrl}/webhook/dtmf`,
        maxLength: 30,
        timeout: 10,
        prompt: 'I had trouble with your audio. Please speak clearly.'
      });

      const twiml = twimlService.createComplexResponse([
        twimlService.createSayVerb('I had trouble with your audio. Please speak clearly.'),
        recordWithDTMF
      ]);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/xml' },
        body: twiml
      };
    }

    // CRITICAL FIX: Respond immediately to avoid Twilio timeout
    console.log('Starting async transcription processing...');

    // Add initial recording info to session
    await sessionManager.addUserMessage(session.sessionId, 'Speech recorded - processing transcription...', recordingUrl);

    // Start transcription processing asynchronously (don't await)
    processTranscriptionAsync(recordingUrl, session.sessionId, callSid).catch(error => {
      console.error('Async transcription processing failed:', error);
    });

    // Immediately respond to Twilio with processing message
    // Store the session info in the session itself for later retrieval
    await sessionManager.addSystemMessage(session.sessionId, `Waiting for transcription completion - CallSid: ${callSid}`);

    const twiml = twimlService.createComplexResponse([
      twimlService.createSayVerb('I heard you. Processing your request now, please wait a moment.'),
      twimlService.createPauseVerb(3),
      twimlService.createRedirectVerb(`${getBaseUrl(event)}/webhook/transcription-status`, 'POST')
    ]);

    console.log('Returning immediate response to avoid timeout');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/xml' },
      body: twiml
    };

  } catch (error) {
    console.error('Error in speech webhook handler:', error);

    const twiml = twimlService.createSayResponse('Sorry, there was an error processing your speech. Please try calling again.');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/xml' },
      body: twiml
    };
  }
}

// New async function to handle transcription processing
async function processTranscriptionAsync(recordingUrl: string, sessionId: string, callSid: string): Promise<void> {
  try {
    console.log(`Starting async transcription for session ${sessionId}`);

    const transcriptionResult = await transcriptionProcessor.processAudioFromUrl(
      recordingUrl,
      sessionId,
      callSid
    );

    console.log(`Transcription completed: ${transcriptionProcessor.formatResultForLogging(transcriptionResult)}`);

    // Update session with transcription result
    if (transcriptionProcessor.isTranscriptionAcceptable(transcriptionResult)) {
      console.log('Transcription is acceptable, updating session...');
      await sessionManager.addUserMessage(
        sessionId,
        transcriptionResult.text,
        recordingUrl,
        transcriptionResult.confidence
      );

      // Mark session as ready for AI processing
      await sessionManager.addSystemMessage(sessionId, 'Transcription completed successfully - starting AI processing');

      console.log(`Successfully transcribed for session ${sessionId}: "${transcriptionResult.text}"`);

      // AUTOMATICALLY PROCESS WITH AI AFTER SUCCESSFUL TRANSCRIPTION
      try {
        console.log(`🤖 Starting AI processing for session ${sessionId}`);
        console.log(`🎯 User question: "${transcriptionResult.text}"`);

        // Build AI context for the conversation
        const aiContext = await contextManager.buildAIContext(sessionId);
        console.log(`📋 AI context built for session ${sessionId}`);

        // Generate AI response
        const aiStartTime = Date.now();
        const aiResponse = await aiConversationService.processConversation(
          transcriptionResult.text,
          aiContext
        );
        const aiProcessingTime = Date.now() - aiStartTime;

        console.log(`✅ AI response generated in ${aiProcessingTime}ms`);
        console.log(`🎯 AI response: "${aiResponse.text}"`);
        console.log(`📊 AI response stats: ${aiResponse.text.split(' ').length} words, ~${Math.ceil(aiResponse.text.split(' ').length * 0.4)}s speech`);

        // Store AI response in session
        await contextManager.processAIResponse(
          sessionId,
          aiResponse.text,
          undefined, // No audio URL for AI response yet (will be added in TTS milestone)
          aiProcessingTime
        );

        // Add system message for successful AI processing
        await sessionManager.addSystemMessage(sessionId, `AI response generated successfully in ${aiProcessingTime}ms - ready for delivery`);

        console.log(`🎉 AI processing completed successfully for session ${sessionId}`);

      } catch (aiError) {
        console.error('❌ AI processing failed:', aiError);

        // Log AI error to session
        await sessionManager.addSystemMessage(
          sessionId,
          `AI processing failed: ${aiError instanceof Error ? aiError.message : 'Unknown error'}`
        );

        // Still mark transcription as completed even if AI fails
        await sessionManager.addSystemMessage(sessionId, 'Transcription completed but AI processing failed - ready for retry');
      }

    } else {
      console.log('Transcription quality is poor, marking for retry...');
      const issueMessage = transcriptionProcessor.getTranscriptionIssueMessage(transcriptionResult);

      await sessionManager.addSystemMessage(
        sessionId,
        `Transcription issue: ${issueMessage} (confidence: ${transcriptionResult.confidence})`
      );

      // Mark session as needing retry
      await sessionManager.addSystemMessage(sessionId, 'Transcription quality poor - needs retry');
    }

  } catch (error) {
    console.error('Async transcription processing failed:', error);

    await sessionManager.addSystemMessage(
      sessionId,
      `Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// New handler for checking transcription status
async function handleTranscriptionStatus(body: Record<string, string>, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // Get CallSid from the Twilio webhook body (standard Twilio parameter)
  const { callSid } = TwiMLService.extractTwilioParams(body);

  console.log(`Checking transcription status for CallSid: ${callSid}`);

  if (!callSid) {
    const twiml = twimlService.createSayResponse('Sorry, there was an error. Please try again.');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/xml' },
      body: twiml
    };
  }

  try {
    // Find session by CallSid
    const session = await sessionManager.getSessionByCallSid(callSid);
    if (!session) {
      const twiml = twimlService.createSayResponse('Sorry, there was an error. Please try again.');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/xml' },
        body: twiml
      };
    }

    console.log(`Found session: ${session.sessionId}, checking transcription status...`);

    // Check the latest system messages to determine processing status
    const recentMessages = session.conversationHistory?.slice(-10) || [];
    const hasCompletedTranscription = recentMessages.some((msg: any) =>
      msg.type === 'system' && msg.text.includes('Transcription completed successfully')
    );
    const hasAIResponse = recentMessages.some((msg: any) =>
      msg.type === 'system' && msg.text.includes('AI response generated successfully')
    );
    const aiProcessingFailed = recentMessages.some((msg: any) =>
      msg.type === 'system' && msg.text.includes('AI processing failed')
    );
    const needsRetry = recentMessages.some((msg: any) =>
      msg.type === 'system' && msg.text.includes('needs retry')
    );
    const hasFailed = recentMessages.some((msg: any) =>
      msg.type === 'system' && msg.text.includes('Transcription failed')
    );

    // Check if we have AI responses in conversation history
    const aiMessages = session.conversationHistory?.filter((msg: any) => msg.type === 'ai') || [];
    const hasAIMessageInHistory = aiMessages.length > 0;

    // Also check if we have any user messages with actual transcribed text (not just "Speech recorded")
    const userMessages = session.conversationHistory?.filter((msg: any) => msg.type === 'user') || [];
    const hasTranscribedText = userMessages.some((msg: any) =>
      msg.text &&
      msg.text !== 'Speech recorded - processing transcription...' &&
      msg.text.length > 10 // Reasonable transcription length
    );

    console.log(`Processing status check: transcription=${hasCompletedTranscription}, aiResponse=${hasAIResponse}, aiInHistory=${hasAIMessageInHistory}, aiProcessingFailed=${aiProcessingFailed}, needsRetry=${needsRetry}, failed=${hasFailed}, hasTranscribedText=${hasTranscribedText}`);
    console.log(`Recent messages count: ${recentMessages.length}, User messages count: ${userMessages.length}, AI messages count: ${aiMessages.length}`);
    console.log(`Session status: ${session.status}, Session ID: ${session.sessionId}`);
    console.log(`Full conversation history length: ${session.conversationHistory?.length || 0}`);

    recentMessages.forEach((msg: any, index: number) => {
      console.log(`  Message ${index}: type=${msg.type}, timestamp=${msg.timestamp}, text="${msg.text}"`);
    });

    if (userMessages.length > 0) {
      console.log('User messages:');
      userMessages.forEach((msg: any, index: number) => {
        console.log(`  User ${index}: "${msg.text}" (length: ${msg.text?.length || 0})`);
      });
    }

    if (aiMessages.length > 0) {
      console.log('AI messages:');
      aiMessages.forEach((msg: any, index: number) => {
        console.log(`  AI ${index}: "${msg.text?.substring(0, 100)}..." (length: ${msg.text?.length || 0})`);
      });
    }

    const baseUrl = getBaseUrl(event);

    if (hasAIResponse || hasAIMessageInHistory) {
      // AI processing completed - deliver the response and continue conversation
      console.log('AI processing completed successfully, delivering response');

      // Get the latest AI response
      const latestAIMessage = aiMessages[aiMessages.length - 1];
      const aiResponseText = latestAIMessage?.text || "I've processed your question. How else can I help you?";

      console.log(`Delivering AI response: "${aiResponseText.substring(0, 100)}..."`);

      // Create seamless follow-up recording with DTMF support
      const recordWithDTMF = dtmfService.generateRecordWithDTMFTwiML({
        speechAction: `${baseUrl}/webhook/speech`,
        dtmfAction: `${baseUrl}/webhook/dtmf`,
        maxLength: 20, // Shorter for follow-ups
        timeout: 15,   // Shorter timeout for follow-ups
        prompt: 'Ask another question and press 1 when finished, or press 0 to end the call.'
      });

      const twiml = twimlService.createComplexResponse([
        twimlService.createSayVerb(aiResponseText),
        twimlService.createPauseVerb(1),
        recordWithDTMF
      ]);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/xml' },
        body: twiml
      };

    } else if (aiProcessingFailed && hasCompletedTranscription) {
      // AI processing failed but transcription was successful - offer retry
      console.log('AI processing failed, offering retry');

      const recordWithDTMF = dtmfService.generateRecordWithDTMFTwiML({
        speechAction: `${baseUrl}/webhook/speech`,
        dtmfAction: `${baseUrl}/webhook/dtmf`,
        maxLength: 30,
        timeout: 10,
        prompt: "I understood your question but I'm having trouble processing it right now. Please ask your question again and press 1 when finished, or press 0 to end the call."
      });

      const twiml = twimlService.createComplexResponse([
        twimlService.createSayVerb("I understood your question but I'm having trouble processing it right now. Please ask your question again and press 1 when finished, or press 0 to end the call."),
        recordWithDTMF
      ]);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/xml' },
        body: twiml
      };

    } else if (hasCompletedTranscription || hasTranscribedText) {
      // Transcription completed but AI still processing - wait a bit more
      console.log('Transcription completed, AI processing in progress...');

      const twiml = twimlService.createComplexResponse([
        twimlService.createSayVerb('I understood your question and I\'m thinking about it. Please wait a moment.'),
        twimlService.createPauseVerb(3),
        twimlService.createRedirectVerb(`${baseUrl}/webhook/transcription-status`, 'POST')
      ]);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/xml' },
        body: twiml
      };

    } else if (needsRetry || hasFailed) {
      // Transcription failed or needs retry
      console.log('Transcription needs retry or failed');

      const recordWithDTMF = dtmfService.generateRecordWithDTMFTwiML({
        speechAction: `${baseUrl}/webhook/speech`,
        dtmfAction: `${baseUrl}/webhook/dtmf`,
        maxLength: 30,
        timeout: 10,
        prompt: "I didn't catch that clearly. Please speak your question again more clearly and press 1 when finished."
      });

      const twiml = twimlService.createComplexResponse([
        twimlService.createSayVerb("I didn't catch that clearly. Please speak your question again more clearly and press 1 when finished."),
        recordWithDTMF
      ]);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/xml' },
        body: twiml
      };

    } else {
      // Still processing - wait a bit more
      console.log('Transcription still processing, waiting...');

      const twiml = twimlService.createComplexResponse([
        twimlService.createSayVerb('Still processing, please wait a moment longer.'),
        twimlService.createPauseVerb(2),
        twimlService.createRedirectVerb(`${baseUrl}/webhook/transcription-status`, 'POST')
      ]);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/xml' },
        body: twiml
      };
    }

  } catch (error) {
    console.error('Error checking transcription status:', error);

    const twiml = twimlService.createSayResponse('Sorry, there was an error. Please try again.');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/xml' },
      body: twiml
    };
  }
}

async function handleDTMFWebhook(body: Record<string, string>, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { digits, callSid, from, to } = TwiMLService.extractTwilioParams(body);

  console.log(`DTMF input received: ${digits} for CallSid: ${callSid}`);

  try {
    // Find session by CallSid and track DTMF input
    const session = await sessionManager.getSessionByCallSid(callSid);
    if (session) {
      await sessionManager.addSystemMessage(session.sessionId, `DTMF input received: ${digits}`);
    } else {
      console.warn(`Session not found for CallSid: ${callSid}`);
    }
  } catch (error) {
    console.error('Error tracking DTMF input in session:', error);
  }

  const dtmfInput = {
    digits,
    callSid,
    from,
    to
  };

  const response = dtmfService.processDTMFInput(dtmfInput);

  const verbs: string[] = [];

  if (response.message) {
    verbs.push(twimlService.createSayVerb(response.message));
  }

  if (response.action === 'submit') {
    // User pressed "1" - this means they want to try recording again (from timeout fallback)
    verbs.push(twimlService.createSayVerb('Please speak your question after the beep and press 1 when finished.'));

    // Start new recording session
    const baseUrl = getBaseUrl(event);
    const recordWithDTMF = dtmfService.generateRecordWithDTMFTwiML({
      speechAction: `${baseUrl}/webhook/speech`,
      dtmfAction: `${baseUrl}/webhook/dtmf`,
      maxLength: 30,
      timeout: 10,
      prompt: ''
    });
    verbs.push(recordWithDTMF);

  } else if (response.action === 'end_call') {
    // User pressed "0" - end the call gracefully
    try {
      // Find session by CallSid and update status to completed
      const session = await sessionManager.getSessionByCallSid(callSid);
      if (session) {
        await sessionManager.updateSessionStatus(session.sessionId, 'completed', Date.now());
        await sessionManager.addSystemMessage(session.sessionId, 'Call ended by user request (pressed 0)');
      } else {
        console.warn(`Session not found for CallSid: ${callSid}`);
      }
    } catch (error) {
      console.error('Error updating session on call end:', error);
    }
    verbs.push(twimlService.createHangupVerb());

  } else if (response.action === 'help') {
    // User pressed "*" - provide help
    verbs.push(twimlService.createPauseVerb(1));

    // Continue with recording after help
    const baseUrl = getBaseUrl(event);
    const recordWithDTMF = dtmfService.generateRecordWithDTMFTwiML({
      speechAction: `${baseUrl}/webhook/speech`,
      dtmfAction: `${baseUrl}/webhook/dtmf`,
      maxLength: 30,
      timeout: 10,
      prompt: 'Please speak your question after the beep.'
    });
    verbs.push(recordWithDTMF);

  } else {
    // Invalid input - provide guidance and continue
    verbs.push(twimlService.createPauseVerb(1));

    const baseUrl = getBaseUrl(event);
    const recordWithDTMF = dtmfService.generateRecordWithDTMFTwiML({
      speechAction: `${baseUrl}/webhook/speech`,
      dtmfAction: `${baseUrl}/webhook/dtmf`,
      maxLength: 30,
      timeout: 10,
      prompt: 'Please speak your question after the beep.'
    });
    verbs.push(recordWithDTMF);
  }

  const twiml = twimlService.createComplexResponse(verbs);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml'
    },
    body: twiml
  };
}

async function handleEventsWebhook(body: Record<string, string>): Promise<APIGatewayProxyResult> {
  const { recordingStatus, callSid, callStatus, callDuration } = TwiMLService.extractTwilioParams(body);

  console.log(`Event received for CallSid: ${callSid}, Recording Status: ${recordingStatus}, Call Status: ${callStatus}`);

  try {
    // Find session by CallSid
    const session = await sessionManager.getSessionByCallSid(callSid);
    if (!session) {
      console.warn(`Session not found for CallSid: ${callSid}`);
      // Continue processing even if session not found
    } else {
      // Handle different types of events
      if (recordingStatus) {
        // Recording status events
        await sessionManager.addSystemMessage(session.sessionId, `Recording status: ${recordingStatus}`);

        if (recordingStatus === 'completed') {
          console.log(`Recording completed for CallSid: ${callSid}`);
        } else if (recordingStatus === 'failed') {
          console.log(`Recording failed for CallSid: ${callSid}`);
          await sessionManager.addSystemMessage(session.sessionId, 'Recording failed - audio may not be available');
        }
      }

      if (callStatus) {
        // Call status events
        await sessionManager.addSystemMessage(session.sessionId, `Call status: ${callStatus}`);

        if (callStatus === 'completed') {
          // Call ended - update session
          const duration = callDuration ? parseInt(callDuration) : 0;
          await sessionManager.updateSessionStatus(session.sessionId, 'completed', Date.now());
          if (duration > 0) {
            await sessionManager.updateCallDuration(session.sessionId, duration);
          }
          console.log(`Call completed for CallSid: ${callSid}, Duration: ${duration}s`);

        } else if (callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer') {
          // Call failed - update session with error
          await sessionManager.updateSessionStatus(session.sessionId, 'failed', Date.now(), {
            code: callStatus,
            message: `Call ${callStatus}`
          });
          console.log(`Call failed for CallSid: ${callSid}, Status: ${callStatus}`);
        }
      }
    }

  } catch (error) {
    console.error('Error handling event webhook:', error);
    // Continue processing even if session update fails
  }

  const twiml = twimlService.createComplexResponse([]);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml'
    },
    body: twiml
  };
}

function createTwiMLResponse(message: string): APIGatewayProxyResult {
  const twiml = twimlService.createSayResponse(message);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml'
    },
    body: twiml
  };
}