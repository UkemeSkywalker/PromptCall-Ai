/**
 * Timeout and Inactivity Management Service
 * 
 * Handles user silence detection, timeout scenarios, and graceful conversation ending
 */

import { DynamoSessionManager } from './dynamo-session-manager';

export interface TimeoutConfig {
  initialTimeoutSeconds: number;
  maxTimeoutSeconds: number;
  inactivityWarningSeconds: number;
  maxInactivityAttempts: number;
  gracefulEndingTimeoutSeconds: number;
}

export interface TimeoutState {
  sessionId: string;
  consecutiveTimeouts: number;
  lastActivityTime: number;
  warningsSent: number;
  isInGracefulEnding: boolean;
  totalInactiveTime: number;
}

export interface TimeoutResult {
  shouldContinue: boolean;
  twimlResponse: string;
  timeoutState: TimeoutState;
  action: 'continue' | 'warn' | 'end_gracefully' | 'end_immediately';
}

export class TimeoutManager {
  private sessionManager: DynamoSessionManager;
  private config: TimeoutConfig;
  private timeoutStates: Map<string, TimeoutState> = new Map();

  constructor(
    sessionManager: DynamoSessionManager,
    config: Partial<TimeoutConfig> = {}
  ) {
    this.sessionManager = sessionManager;
    this.config = {
      initialTimeoutSeconds: 10,
      maxTimeoutSeconds: 20,
      inactivityWarningSeconds: 30,
      maxInactivityAttempts: 2,
      gracefulEndingTimeoutSeconds: 15,
      ...config
    };
  }

  /**
   * Handle timeout scenario when user doesn't respond
   */
  async handleTimeout(sessionId: string, callSid: string): Promise<TimeoutResult> {
    console.log(`⏰ TIMEOUT: Handling timeout for session ${sessionId}`);

    // Get or create timeout state
    let timeoutState = this.timeoutStates.get(sessionId);
    if (!timeoutState) {
      timeoutState = this.initializeTimeoutState(sessionId);
      this.timeoutStates.set(sessionId, timeoutState);
    }

    // Update timeout state
    timeoutState.consecutiveTimeouts++;
    timeoutState.totalInactiveTime += this.config.initialTimeoutSeconds;
    const currentTime = Date.now();

    console.log(`⏰ TIMEOUT STATE: Consecutive timeouts: ${timeoutState.consecutiveTimeouts}, Total inactive: ${timeoutState.totalInactiveTime}s`);

    // Determine action based on timeout state
    if (timeoutState.consecutiveTimeouts === 1) {
      // First timeout - gentle prompt
      return await this.handleFirstTimeout(timeoutState, callSid);
    } else if (timeoutState.consecutiveTimeouts === 2) {
      // Second timeout - more direct prompt
      return await this.handleSecondTimeout(timeoutState, callSid);
    } else if (timeoutState.consecutiveTimeouts >= 3) {
      // Third timeout or more - graceful ending
      return await this.handleFinalTimeout(timeoutState, callSid);
    }

    // Default continue
    return {
      shouldContinue: true,
      twimlResponse: this.createContinueTwiML(),
      timeoutState,
      action: 'continue'
    };
  }

  /**
   * Handle user activity - reset timeout counters
   */
  async handleUserActivity(sessionId: string): Promise<void> {
    console.log(`✅ ACTIVITY: User activity detected for session ${sessionId}`);
    
    const timeoutState = this.timeoutStates.get(sessionId);
    if (timeoutState) {
      timeoutState.consecutiveTimeouts = 0;
      timeoutState.warningsSent = 0;
      timeoutState.lastActivityTime = Date.now();
      timeoutState.isInGracefulEnding = false;
      
      // Add system message about activity resumption
      await this.sessionManager.addSystemMessage(
        sessionId,
        'User activity resumed - timeout counters reset'
      );
    }
  }

  /**
   * Check if session should be ended due to prolonged inactivity
   */
  shouldEndSession(sessionId: string): boolean {
    const timeoutState = this.timeoutStates.get(sessionId);
    if (!timeoutState) return false;

    const totalInactiveMinutes = timeoutState.totalInactiveTime / 60;
    const maxInactiveMinutes = 5; // End session after 5 minutes of total inactivity

    return totalInactiveMinutes >= maxInactiveMinutes || 
           timeoutState.consecutiveTimeouts >= 4;
  }

  /**
   * Get appropriate timeout duration based on conversation state
   */
  getTimeoutDuration(conversationPhase: string, consecutiveTimeouts: number): number {
    const baseTimeout = this.config.initialTimeoutSeconds;
    
    // Increase timeout for later conversation phases
    const phaseMultiplier = {
      'greeting': 1.0,
      'conversation': 1.2,
      'clarification': 1.5,
      'closing': 0.8
    }[conversationPhase] || 1.0;

    // Decrease timeout after multiple timeouts to end conversation sooner
    const timeoutMultiplier = Math.max(0.5, 1.0 - (consecutiveTimeouts * 0.2));

    return Math.round(baseTimeout * phaseMultiplier * timeoutMultiplier);
  }

  private initializeTimeoutState(sessionId: string): TimeoutState {
    return {
      sessionId,
      consecutiveTimeouts: 0,
      lastActivityTime: Date.now(),
      warningsSent: 0,
      isInGracefulEnding: false,
      totalInactiveTime: 0
    };
  }

  private async handleFirstTimeout(timeoutState: TimeoutState, callSid: string): Promise<TimeoutResult> {
    console.log(`⏰ FIRST TIMEOUT: Sending gentle prompt`);
    
    await this.sessionManager.addSystemMessage(
      timeoutState.sessionId,
      'First timeout - sending gentle prompt'
    );

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" rate="1">
    I'm here and ready to help. Please let me know what you'd like to ask about.
  </Say>
  <Record 
    action="https://kl1zzr3v5k.execute-api.us-east-1.amazonaws.com/prod/webhook/speech" 
    method="POST" 
    maxLength="30" 
    timeout="15"
    playBeep="true"
    recordingStatusCallback="https://kl1zzr3v5k.execute-api.us-east-1.amazonaws.com/prod/webhook/events"
    recordingStatusCallbackMethod="POST"
  />
</Response>`;

    return {
      shouldContinue: true,
      twimlResponse,
      timeoutState,
      action: 'warn'
    };
  }

  private async handleSecondTimeout(timeoutState: TimeoutState, callSid: string): Promise<TimeoutResult> {
    console.log(`⏰ SECOND TIMEOUT: Sending more direct prompt`);
    
    await this.sessionManager.addSystemMessage(
      timeoutState.sessionId,
      'Second timeout - sending direct prompt'
    );

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" rate="1">
    Are you still there? If you need help, please speak after the beep. 
    If you're finished, you can hang up at any time.
  </Say>
  <Record 
    action="https://kl1zzr3v5k.execute-api.us-east-1.amazonaws.com/prod/webhook/speech" 
    method="POST" 
    maxLength="20" 
    timeout="12"
    playBeep="true"
    recordingStatusCallback="https://kl1zzr3v5k.execute-api.us-east-1.amazonaws.com/prod/webhook/events"
    recordingStatusCallbackMethod="POST"
  />
</Response>`;

    return {
      shouldContinue: true,
      twimlResponse,
      timeoutState,
      action: 'warn'
    };
  }

  private async handleFinalTimeout(timeoutState: TimeoutState, callSid: string): Promise<TimeoutResult> {
    console.log(`⏰ FINAL TIMEOUT: Ending conversation gracefully`);
    
    timeoutState.isInGracefulEnding = true;
    
    await this.sessionManager.addSystemMessage(
      timeoutState.sessionId,
      'Final timeout - ending conversation gracefully'
    );

    // Update session status to completed due to timeout
    await this.sessionManager.updateSessionStatus(
      timeoutState.sessionId,
      'completed',
      Date.now(),
      { code: 'timeout', message: 'Session ended due to user inactivity' }
    );

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" rate="1">
    It seems like you might be busy right now. Thank you for using PromptCall AI. 
    Feel free to call back anytime if you need assistance. Goodbye!
  </Say>
  <Hangup/>
</Response>`;

    return {
      shouldContinue: false,
      twimlResponse,
      timeoutState,
      action: 'end_gracefully'
    };
  }

  private createContinueTwiML(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">
    Please let me know how I can help you.
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

  /**
   * Clean up timeout state when session ends
   */
  cleanupSession(sessionId: string): void {
    this.timeoutStates.delete(sessionId);
    console.log(`🧹 CLEANUP: Removed timeout state for session ${sessionId}`);
  }

  /**
   * Get current timeout state for monitoring
   */
  getTimeoutState(sessionId: string): TimeoutState | null {
    return this.timeoutStates.get(sessionId) || null;
  }
}