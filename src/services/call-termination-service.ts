/**
 * Call Termination and Cleanup Service
 * 
 * Handles proper call ending, session cleanup, and graceful goodbye messages
 */

import { DynamoSessionManager } from './dynamo-session-manager';
import { TimeoutManager } from './timeout-manager';

export interface TerminationTrigger {
  type: 'user_request' | 'completion_detected' | 'timeout' | 'error' | 'system_initiated';
  reason: string;
  userText?: string;
  confidence?: number;
}

export interface TerminationResult {
  shouldTerminate: boolean;
  twimlResponse: string;
  terminationType: 'immediate' | 'graceful' | 'continue';
  goodbyeMessage: string;
  sessionUpdated: boolean;
}

export interface CallTerminationConfig {
  enableCompletionDetection: boolean;
  completionKeywords: string[];
  farewellKeywords: string[];
  maxConversationTurns: number;
  enableGracefulGoodbyes: boolean;
}

export class CallTerminationService {
  private sessionManager: DynamoSessionManager;
  private timeoutManager: TimeoutManager;
  private config: CallTerminationConfig;

  constructor(
    sessionManager: DynamoSessionManager,
    timeoutManager: TimeoutManager,
    config: Partial<CallTerminationConfig> = {}
  ) {
    this.sessionManager = sessionManager;
    this.timeoutManager = timeoutManager;
    this.config = {
      enableCompletionDetection: true,
      completionKeywords: [
        'thank you', 'thanks', 'that\'s all', 'goodbye', 'bye', 'done',
        'finished', 'complete', 'no more questions', 'that helps',
        'perfect', 'great', 'awesome', 'exactly what i needed'
      ],
      farewellKeywords: [
        'goodbye', 'bye', 'see you', 'talk to you later', 'have a good day',
        'take care', 'farewell', 'catch you later', 'until next time'
      ],
      maxConversationTurns: 15,
      enableGracefulGoodbyes: true,
      ...config
    };
  }

  /**
   * Analyze user input to determine if call should be terminated
   */
  async analyzeTerminationIntent(
    sessionId: string,
    userText: string,
    conversationTurn: number,
    confidence: number = 1.0
  ): Promise<TerminationResult> {
    console.log(`🔍 TERMINATION ANALYSIS: Analyzing "${userText}" for termination intent`);

    // Check for explicit completion/farewell keywords
    const completionDetected = this.detectCompletionIntent(userText);
    const farewellDetected = this.detectFarewellIntent(userText);

    // Check conversation length
    const conversationTooLong = conversationTurn >= this.config.maxConversationTurns;

    if (completionDetected || farewellDetected) {
      console.log(`✅ TERMINATION: User completion/farewell detected`);
      return await this.handleUserRequestedTermination(sessionId, {
        type: 'user_request',
        reason: completionDetected ? 'User indicated completion' : 'User said farewell',
        userText,
        confidence
      });
    }

    if (conversationTooLong) {
      console.log(`⏰ TERMINATION: Conversation too long (${conversationTurn} turns)`);
      return await this.handleSystemInitiatedTermination(sessionId, {
        type: 'system_initiated',
        reason: 'Maximum conversation length reached',
        userText,
        confidence
      });
    }

    // No termination needed
    return {
      shouldTerminate: false,
      twimlResponse: '',
      terminationType: 'continue',
      goodbyeMessage: '',
      sessionUpdated: false
    };
  }

  /**
   * Handle explicit call termination request
   */
  async terminateCall(
    sessionId: string,
    trigger: TerminationTrigger
  ): Promise<TerminationResult> {
    console.log(`🔚 CALL TERMINATION: Terminating call for session ${sessionId}, reason: ${trigger.reason}`);

    try {
      // Update session status
      await this.sessionManager.updateSessionStatus(
        sessionId,
        'completed',
        Date.now(),
        trigger.type === 'error' ? { code: 'error', message: trigger.reason } : undefined
      );

      // Add final system message
      await this.sessionManager.addSystemMessage(
        sessionId,
        `Call terminated: ${trigger.reason}`
      );

      // Clean up timeout state
      this.timeoutManager.cleanupSession(sessionId);

      // Generate appropriate goodbye message and TwiML
      const goodbyeMessage = this.generateGoodbyeMessage(trigger);
      const twimlResponse = this.createTerminationTwiML(goodbyeMessage, trigger.type);

      console.log(`✅ CALL TERMINATED: Session ${sessionId} completed successfully`);

      return {
        shouldTerminate: true,
        twimlResponse,
        terminationType: trigger.type === 'error' ? 'immediate' : 'graceful',
        goodbyeMessage,
        sessionUpdated: true
      };

    } catch (error) {
      console.error(`❌ TERMINATION ERROR: Failed to terminate session ${sessionId}:`, error);
      
      // Fallback termination
      return {
        shouldTerminate: true,
        twimlResponse: this.createFallbackTerminationTwiML(),
        terminationType: 'immediate',
        goodbyeMessage: 'Thank you for using PromptCall AI. Goodbye!',
        sessionUpdated: false
      };
    }
  }

  /**
   * Check if user input indicates conversation completion
   */
  private detectCompletionIntent(userText: string): boolean {
    const lowerText = userText.toLowerCase();
    
    return this.config.completionKeywords.some(keyword => 
      lowerText.includes(keyword.toLowerCase())
    );
  }

  /**
   * Check if user input indicates farewell
   */
  private detectFarewellIntent(userText: string): boolean {
    const lowerText = userText.toLowerCase();
    
    return this.config.farewellKeywords.some(keyword => 
      lowerText.includes(keyword.toLowerCase())
    );
  }

  /**
   * Handle user-requested termination
   */
  private async handleUserRequestedTermination(
    sessionId: string,
    trigger: TerminationTrigger
  ): Promise<TerminationResult> {
    return await this.terminateCall(sessionId, trigger);
  }

  /**
   * Handle system-initiated termination
   */
  private async handleSystemInitiatedTermination(
    sessionId: string,
    trigger: TerminationTrigger
  ): Promise<TerminationResult> {
    // For system-initiated termination, offer one more chance
    const goodbyeMessage = "It looks like we've had a good conversation. Is there anything else I can help you with before we end our call?";
    
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" rate="1">
    ${goodbyeMessage}
  </Say>
  <Record 
    action="https://kl1zzr3v5k.execute-api.us-east-1.amazonaws.com/prod/webhook/speech" 
    method="POST" 
    maxLength="20" 
    timeout="8"
    playBeep="true"
    recordingStatusCallback="https://kl1zzr3v5k.execute-api.us-east-1.amazonaws.com/prod/webhook/events"
    recordingStatusCallbackMethod="POST"
  />
  <Say voice="alice">Thank you for using PromptCall AI. Goodbye!</Say>
  <Hangup/>
</Response>`;

    return {
      shouldTerminate: false, // Give one more chance
      twimlResponse,
      terminationType: 'graceful',
      goodbyeMessage,
      sessionUpdated: false
    };
  }

  /**
   * Generate appropriate goodbye message based on termination trigger
   */
  private generateGoodbyeMessage(trigger: TerminationTrigger): string {
    const goodbyeOptions = {
      user_request: [
        "You're very welcome! Thank you for using PromptCall AI. Have a great day!",
        "I'm glad I could help! Thanks for calling PromptCall AI. Take care!",
        "It was my pleasure to assist you. Thank you for using PromptCall AI. Goodbye!",
        "Happy to help! Thanks for using PromptCall AI. Have a wonderful day!"
      ],
      completion_detected: [
        "I'm glad we could resolve everything for you. Thank you for using PromptCall AI!",
        "Perfect! It sounds like you have what you need. Thanks for calling PromptCall AI!",
        "Excellent! I'm happy I could help. Thank you for using PromptCall AI. Goodbye!"
      ],
      timeout: [
        "Thank you for using PromptCall AI. Feel free to call back anytime if you need assistance. Goodbye!",
        "It seems like you might be busy. Thanks for using PromptCall AI. Have a great day!"
      ],
      system_initiated: [
        "We've covered a lot today! Thank you for using PromptCall AI. Feel free to call back anytime!",
        "It's been great helping you today. Thank you for using PromptCall AI. Goodbye!"
      ],
      error: [
        "Thank you for your patience. Please feel free to call PromptCall AI again. Goodbye!",
        "We apologize for any inconvenience. Thank you for using PromptCall AI. Goodbye!"
      ]
    };

    const options = goodbyeOptions[trigger.type] || goodbyeOptions.user_request;
    return options[Math.floor(Math.random() * options.length)];
  }

  /**
   * Create TwiML for call termination
   */
  private createTerminationTwiML(goodbyeMessage: string, triggerType: string): string {
    // Add a brief pause before goodbye for natural flow
    const pauseLength = triggerType === 'error' ? '0.5' : '1';

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="${pauseLength}"/>
  <Say voice="alice" rate="1">
    ${goodbyeMessage}
  </Say>
  <Hangup/>
</Response>`;
  }

  /**
   * Create fallback TwiML for termination errors
   */
  private createFallbackTerminationTwiML(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">
    Thank you for using PromptCall AI. Goodbye!
  </Say>
  <Hangup/>
</Response>`;
  }

  /**
   * Get termination statistics for monitoring
   */
  getTerminationStats(): {
    completionKeywords: string[];
    farewellKeywords: string[];
    maxConversationTurns: number;
  } {
    return {
      completionKeywords: this.config.completionKeywords,
      farewellKeywords: this.config.farewellKeywords,
      maxConversationTurns: this.config.maxConversationTurns
    };
  }

  /**
   * Update termination configuration
   */
  updateConfig(newConfig: Partial<CallTerminationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log(`🔧 TERMINATION CONFIG: Updated configuration`);
  }
}