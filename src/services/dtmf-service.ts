/**
 * DTMF Service for handling keypad input during phone calls
 * Supports "1" for submit and "0" for end call
 */

export interface DTMFInput {
  digits: string;
  callSid: string;
  from: string;
  to: string;
}

export interface DTMFResponse {
  action: 'submit' | 'end_call' | 'invalid' | 'help';
  message?: string;
  shouldContinue: boolean;
}

export class DTMFService {
  /**
   * Process DTMF input and determine the appropriate action
   */
  processDTMFInput(input: DTMFInput): DTMFResponse {
    const digit = input.digits;
    
    console.log(`Processing DTMF input: ${digit} for CallSid: ${input.callSid}`);
    
    switch (digit) {
      case '1':
        return {
          action: 'submit',
          message: 'Processing your request now.',
          shouldContinue: true
        };
      
      case '0':
        return {
          action: 'end_call',
          message: 'Thank you for using PromptCall AI. Goodbye!',
          shouldContinue: false
        };
      
      case '*':
        return {
          action: 'help',
          message: 'Press 1 to submit your spoken prompt for processing, or press 0 to end the call.',
          shouldContinue: true
        };
      
      default:
        return {
          action: 'invalid',
          message: 'Invalid key pressed. Press 1 to submit your prompt or 0 to end the call.',
          shouldContinue: true
        };
    }
  }

  /**
   * Generate TwiML for DTMF gathering
   */
  generateGatherTwiML(options: {
    action: string;
    timeout?: number;
    numDigits?: number;
    finishOnKey?: string;
    prompt?: string;
  }): string {
    const { action, timeout = 10, numDigits = 1, finishOnKey = '#', prompt } = options;
    
    let twiml = `<Gather action="${action}" method="POST" timeout="${timeout}" numDigits="${numDigits}" finishOnKey="${finishOnKey}">`;
    
    if (prompt) {
      twiml += `<Say voice="alice">${prompt}</Say>`;
    }
    
    twiml += '</Gather>';
    
    return twiml;
  }

  /**
   * Generate TwiML for recording with DTMF controls
   */
  generateRecordWithDTMFTwiML(options: {
    speechAction: string;
    dtmfAction: string;
    maxLength?: number;
    timeout?: number;
    prompt?: string;
  }): string {
    const { speechAction, dtmfAction, maxLength = 30, timeout = 10, prompt } = options;
    
    let twiml = '';
    
    if (prompt) {
      twiml += `<Say voice="alice">${prompt}</Say>`;
    }
    
    // Add DTMF gathering that wraps the recording
    twiml += `<Gather action="${dtmfAction}" method="POST" timeout="${timeout}" numDigits="1" finishOnKey="#">`;
    twiml += `<Record action="${speechAction}" method="POST" maxLength="${maxLength}" timeout="${timeout}" playBeep="true" />`;
    twiml += '</Gather>';
    
    // Fallback if no DTMF or speech input
    twiml += '<Say voice="alice">I didn\'t receive any input. Please try again.</Say>';
    
    return twiml;
  }

  /**
   * Generate welcome message with DTMF instructions
   */
  generateWelcomeWithInstructions(): string {
    return `Welcome to PromptCall AI. Please speak your question after the beep. 
            When you finish speaking, press 1 to submit your question for AI processing, 
            or press 0 to end the call. You can press star for help at any time.`;
  }

  /**
   * Generate reminder message for DTMF controls
   */
  generateControlsReminder(): string {
    return `Remember: Press 1 to submit your prompt, or press 0 to end the call.`;
  }
}