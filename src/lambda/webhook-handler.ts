import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoSessionManager } from '../services/dynamo-session-manager';
import { S3Service } from '../services/s3-service';
import { TranscribeService } from '../services/transcribe-service';
import { TranscriptionProcessor } from '../services/transcription-processor';
import { AIConversationService } from '../services/ai-conversation-service';
import { createConversationEntry } from '../types/session';

// Initialize services
const sessionManager = new DynamoSessionManager({
    tableName: process.env.SESSION_TABLE_NAME || 'promptcall-sessions',
});

const s3Service = new S3Service(
    process.env.AUDIO_BUCKET_NAME || 'promptcall-audio-bucket'
);

const transcribeService = new TranscribeService();

const transcriptionProcessor = new TranscriptionProcessor(
    transcribeService,
    sessionManager,
    {
        confidenceThreshold: 0.75, // Lowered for telephony audio quality
        maxRetryAttempts: 2,
        retryDelayMs: 2000,
        maxTranscriptionTimeMs: 60000,
    }
);

const aiConversationService = new AIConversationService(sessionManager);

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
            console.log(`🔵 ROUTING: Voice webhook called`);
            return await handleVoiceWebhook(body);
        } else if (path.includes('/webhook/speech') && httpMethod === 'POST') {
            console.log(`🎤 ROUTING: Speech webhook called - RECORDING RECEIVED!`);
            return await handleSpeechWebhook(body);
        } else if (path.includes('/webhook/events') && httpMethod === 'POST') {
            console.log(`📋 ROUTING: Events webhook called`);
            return await handleEventsWebhook(body);
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

async function handleVoiceWebhook(body: Record<string, string>): Promise<APIGatewayProxyResult> {
    const callSid = body.CallSid;
    const from = body.From;
    const to = body.To;

    console.log(`🔵 VOICE WEBHOOK: Incoming call from ${from} to ${to}, CallSid: ${callSid}`);

    try {
        // Initialize conversation with AI service
        const { sessionId, welcomeMessage } = await aiConversationService.initializeConversation(callSid, from);
        console.log(`✅ AI CONVERSATION INITIALIZED: ${sessionId} for call ${callSid}`);
        console.log(`👋 WELCOME MESSAGE: ${welcomeMessage}`);

        // Create TwiML response with personalized welcome message and recording
        const twiml = generateWelcomeTwiML(welcomeMessage);
        console.log(`📋 TWIML RESPONSE: Sending AI-generated welcome message with recording instructions`);
        console.log(`🎤 RECORDING SETUP: Speech will be sent to /webhook/speech endpoint`);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/xml'
            },
            body: twiml
        };
    } catch (error) {
        console.error('❌ ERROR in voice webhook:', error);

        // Return error TwiML response
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/xml'
            },
            body: '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, there was an error starting your session. Please try again.</Say></Response>'
        };
    }
}

async function handleSpeechWebhook(body: Record<string, string>): Promise<APIGatewayProxyResult> {
    console.log(`🎤 SPEECH WEBHOOK CALLED! Full body:`, JSON.stringify(body, null, 2));

    // Test environment variables
    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    console.log(`🔑 ENV TEST: TWILIO_ACCOUNT_SID = ${twilioAccountSid ? twilioAccountSid.substring(0, 10) + '...' : 'NOT SET'}`);
    console.log(`🔑 ENV TEST: TWILIO_AUTH_TOKEN = ${twilioAuthToken ? twilioAuthToken.substring(0, 10) + '...' : 'NOT SET'}`);

    const recordingUrl = body.RecordingUrl;
    const callSid = body.CallSid;
    const recordingDuration = body.RecordingDuration;

    console.log(`🎤 SPEECH WEBHOOK: Recording received for CallSid: ${callSid}`);
    console.log(`📊 RECORDING DETAILS: URL: ${recordingUrl}, Duration: ${recordingDuration}s`);

    // For now, let's just return a simple response to confirm the webhook is being called
    if (!recordingUrl) {
        console.log(`❌ NO RECORDING URL: Twilio didn't provide a recording URL`);
        return createTwiMLResponse('No recording received. Please try again.');
    }

    try {
        // Find session by call SID
        const session = await sessionManager.getSessionByCallSid(callSid);

        if (!session) {
            console.warn(`❌ SESSION NOT FOUND: No session found for CallSid: ${callSid}`);
            return createErrorTwiMLResponse('Session not found. Please try calling again.');
        }

        console.log(`✅ SESSION FOUND: Processing speech for session ${session.sessionId}`);

        // Create conversation entry for user audio
        const userEntry = createConversationEntry(
            'user',
            'Audio recording received - processing transcription...',
            recordingUrl
        );

        // Add the conversation entry to session
        await sessionManager.appendConversationEntry(session.sessionId, userEntry);

        // Upload audio file to S3 with proper metadata
        try {
            console.log(`📤 S3 UPLOAD: Starting upload of audio file to S3...`);
            const uploadResult = await s3Service.uploadAudioFromUrl(
                recordingUrl,
                session.sessionId,
                callSid
            );
            console.log(`✅ S3 UPLOAD SUCCESS: Audio uploaded to ${uploadResult.s3Key}`);

            // Update the conversation entry with S3 audio file metadata
            await sessionManager.updateConversationEntryWithAudio(
                session.sessionId,
                userEntry.id,
                {
                    originalUrl: recordingUrl,
                    s3Key: uploadResult.s3Key,
                    s3Url: uploadResult.s3Url,
                    fileSize: uploadResult.metadata.fileSize,
                    duration: recordingDuration ? parseFloat(recordingDuration) : undefined,
                    uploadedAt: uploadResult.metadata.uploadedAt
                }
            );

            console.log(`Audio uploaded to S3: ${uploadResult.s3Url}`);

            // Validate audio quality before transcription
            const audioQuality = transcriptionProcessor.validateAudioQuality({
                fileSize: uploadResult.metadata.fileSize,
                duration: recordingDuration ? parseFloat(recordingDuration) : undefined
            });

            if (!audioQuality.isValid) {
                console.warn(`Audio quality validation failed: ${audioQuality.reason}`);
                await sessionManager.addSystemMessage(
                    session.sessionId,
                    `Audio quality issue: ${audioQuality.reason}`
                );

                return createTwiMLResponse(
                    'I\'m sorry, but the audio quality was not sufficient for transcription. Please try speaking more clearly and try again.'
                );
            }

            // Process transcription with validation and retry logic
            console.log(`Starting transcription processing for session: ${session.sessionId}`);
            const transcriptionResult = await transcriptionProcessor.processTranscription(
                uploadResult.s3Url,
                session.sessionId,
                userEntry.id,
                callSid
            );

            // Handle transcription results
            if (transcriptionResult.success) {
                console.log(`Transcription successful: "${transcriptionResult.text}" (confidence: ${transcriptionResult.confidence.toFixed(3)})`);

                try {
                    // Process user message with AI conversation service
                    console.log(`🤖 AI PROCESSING: Starting AI response generation for: "${transcriptionResult.text}"`);
                    const conversationResult = await aiConversationService.processUserMessage(
                        session.sessionId,
                        transcriptionResult.text,
                        uploadResult.s3Url,
                        transcriptionResult.confidence
                    );

                    console.log(`✅ AI RESPONSE GENERATED: "${conversationResult.aiResponse.text}"`);
                    console.log(`📊 AI RESPONSE STATS:`, conversationResult.responseStats);
                    console.log(`✅ VALIDATION:`, conversationResult.validationResult.isValid ? 'PASSED' : 'FAILED');

                    if (!conversationResult.validationResult.isValid) {
                        console.warn(`⚠️ AI RESPONSE ISSUES:`, conversationResult.validationResult.issues);
                    }

                    // Generate TwiML response with AI-generated content
                    const twiml = generateAIResponseTwiML(conversationResult.aiResponse.text);

                    return {
                        statusCode: 200,
                        headers: {
                            'Content-Type': 'application/xml'
                        },
                        body: twiml
                    };

                } catch (aiError) {
                    console.error(`❌ AI PROCESSING FAILED:`, aiError);
                    
                    // Fallback to simple acknowledgment
                    await sessionManager.addSystemMessage(
                        session.sessionId,
                        `AI processing failed: ${aiError instanceof Error ? aiError.message : 'Unknown error'}`
                    );

                    const fallbackTwiml = generateTranscriptionSuccessTwiML(transcriptionResult.text);
                    return {
                        statusCode: 200,
                        headers: {
                            'Content-Type': 'application/xml'
                        },
                        body: fallbackTwiml
                    };
                }
            } else {
                console.error(`Transcription failed after ${transcriptionResult.attempts} attempts: ${transcriptionResult.error}`);

                // Generate response for transcription failure
                const twiml = generateTranscriptionFailureTwiML(transcriptionResult.attempts);

                return {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'application/xml'
                    },
                    body: twiml
                };
            }

        } catch (uploadError) {
            console.error('Error uploading audio to S3:', uploadError);
            await sessionManager.addSystemMessage(
                session.sessionId,
                `Audio upload failed: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`
            );

            return createErrorTwiMLResponse('Sorry, there was an error processing your audio. Please try again.');
        }
    } catch (error) {
        console.error('Error handling speech webhook:', error);

        return createErrorTwiMLResponse('Sorry, there was an error processing your speech. Please try again.');
    }
}

async function handleEventsWebhook(body: Record<string, string>): Promise<APIGatewayProxyResult> {
    const recordingStatus = body.RecordingStatus;
    const callSid = body.CallSid;
    const callStatus = body.CallStatus;

    console.log(`Event for CallSid: ${callSid}, RecordingStatus: ${recordingStatus}, CallStatus: ${callStatus}`);

    try {
        // Find session by call SID
        const session = await sessionManager.getSessionByCallSid(callSid);

        if (session) {
            // Handle different event types
            if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer') {
                // Call ended - update session status
                const endTime = Date.now();
                const status = callStatus === 'completed' ? 'completed' : 'failed';

                await sessionManager.updateSessionStatus(
                    session.sessionId,
                    status,
                    endTime,
                    callStatus !== 'completed' ? { code: callStatus, message: `Call ended with status: ${callStatus}` } : undefined
                );

                // Add system message for call end
                await sessionManager.addSystemMessage(session.sessionId, `Call ended with status: ${callStatus}`);

                console.log(`Updated session ${session.sessionId} status to ${status}`);
            } else if (recordingStatus) {
                // Recording event - add system message
                await sessionManager.addSystemMessage(session.sessionId, `Recording status: ${recordingStatus}`);
                console.log(`Added recording status to session ${session.sessionId}: ${recordingStatus}`);
            }
        } else {
            console.warn(`No session found for CallSid: ${callSid} in events webhook`);
        }
    } catch (error) {
        console.error('Error handling events webhook:', error);
    }

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

function createErrorTwiMLResponse(message: string): APIGatewayProxyResult {
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/xml'
        },
        body: `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">${message}</Say></Response>`
    };
}

function generateWelcomeTwiML(welcomeMessage?: string): string {
    const message = welcomeMessage || "Welcome to PromptCall AI. I'm here to help you with any questions you might have. Please speak after the beep.";
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" rate="medium">
    ${message}
  </Say>
  <Record 
    action="https://kl1zzr3v5k.execute-api.us-east-1.amazonaws.com/prod/webhook/speech" 
    method="POST" 
    maxLength="30" 
    timeout="10"
    playBeep="true"
    recordingStatusCallback="https://kl1zzr3v5k.execute-api.us-east-1.amazonaws.com/prod/webhook/events"
    recordingStatusCallbackMethod="POST"
  />
</Response>`;
}

function generateAIResponseTwiML(aiResponse: string): string {
    // Escape XML special characters in AI response
    const escapedResponse = aiResponse
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" rate="medium">
    ${escapedResponse}
  </Say>
  <Pause length="1"/>
  <Say voice="alice">
    Is there anything else I can help you with?
  </Say>
  <Record 
    action="https://kl1zzr3v5k.execute-api.us-east-1.amazonaws.com/prod/webhook/speech" 
    method="POST" 
    maxLength="30" 
    timeout="10"
    playBeep="true"
    recordingStatusCallback="https://kl1zzr3v5k.execute-api.us-east-1.amazonaws.com/prod/webhook/events"
    recordingStatusCallbackMethod="POST"
  />
  <Say voice="alice">Thank you for using PromptCall AI. Goodbye!</Say>
</Response>`;
}

function generateTranscriptionSuccessTwiML(transcribedText: string): string {
    // Truncate text for voice response (keep it under 100 characters for clarity)
    const truncatedText = transcribedText.length > 100
        ? transcribedText.substring(0, 97) + '...'
        : transcribedText;

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" rate="medium">
    I heard you say: ${truncatedText}
  </Say>
  <Pause length="1"/>
  <Say voice="alice" rate="medium">
    I'm processing your request and will have an AI response ready soon. 
    This completes our speech-to-text integration.
  </Say>
  <Pause length="1"/>
  <Say voice="alice">Is there anything else I can help you with?</Say>
  <Record 
    action="https://kl1zzr3v5k.execute-api.us-east-1.amazonaws.com/prod/webhook/speech" 
    method="POST" 
    maxLength="30" 
    timeout="10"
    playBeep="true"
    recordingStatusCallback="https://kl1zzr3v5k.execute-api.us-east-1.amazonaws.com/prod/webhook/events"
    recordingStatusCallbackMethod="POST"
  />
  <Say voice="alice">Thank you for using PromptCall AI. Goodbye!</Say>
</Response>`;
}

function generateTranscriptionFailureTwiML(attempts: number): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" rate="medium">
    I'm sorry, but I wasn't able to understand your speech clearly after ${attempts} attempts. 
    This could be due to background noise or unclear audio.
  </Say>
  <Pause length="1"/>
  <Say voice="alice" rate="medium">
    Please try speaking more clearly, or call back from a quieter location.
  </Say>
  <Pause length="1"/>
  <Say voice="alice">Would you like to try again?</Say>
  <Record 
    action="https://kl1zzr3v5k.execute-api.us-east-1.amazonaws.com/prod/webhook/speech" 
    method="POST" 
    maxLength="30" 
    timeout="10"
    playBeep="true"
    recordingStatusCallback="https://kl1zzr3v5k.execute-api.us-east-1.amazonaws.com/prod/webhook/events"
    recordingStatusCallbackMethod="POST"
  />
  <Say voice="alice">Thank you for using PromptCall AI. Goodbye!</Say>
</Response>`;
}