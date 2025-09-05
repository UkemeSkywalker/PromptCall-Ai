import { BedrockService, AIResponse } from './bedrock-service';
import { AIContext } from './conversation-context-manager';

/**
 * Configuration for AI conversation service
 */
export interface AIConversationConfig {
  maxResponseWords?: number;
  defaultResponseLength?: 'short' | 'medium' | 'long';
  voiceOptimized?: boolean;
  region?: string;
  modelId?: string;
}

/**
 * Voice-optimized prompt templates for different conversation scenarios
 */
export class VoicePromptTemplates {
  /**
   * System prompt for initial phone call greeting
   */
  static getWelcomePrompt(): string {
    return `You are a helpful AI assistant accessed via phone call. You're speaking to someone who may have limited internet access but has called to get AI assistance.

CRITICAL VOICE RULES:
- Keep responses under 100 words (40 seconds of speech)
- Use simple, conversational English
- Speak naturally as if on a phone call
- Be warm, friendly, and welcoming
- No bullet points or lists - speak everything naturally
- Use contractions (I'll, you'll, that's) for natural speech

The user has just connected. Welcome them warmly and ask how you can help them today.`;
  }

  /**
   * System prompt for general conversation
   */
  static getConversationPrompt(maxWords: number = 100): string {
    const seconds = Math.ceil(maxWords * 0.4);
    
    return `You are a helpful AI assistant accessed via phone call in regions with limited internet access.

CRITICAL VOICE OPTIMIZATION RULES:
- MAXIMUM ${maxWords} words (${seconds} seconds of speech) - this is STRICT for call cost management
- Use simple, conversational English suitable for phone calls
- Speak as if you're having a natural phone conversation
- NO bullet points, lists, or complex formatting - speak everything naturally
- Use short sentences and natural pauses
- Avoid technical jargon - explain things simply
- Be warm, friendly, and helpful
- If giving multiple points, use natural transitions like "first", "also", "and finally"
- End with a natural conversation closer when appropriate

PHONE CONVERSATION STYLE:
- Start responses naturally (avoid "Here's what I can tell you...")
- Use contractions (I'll, you'll, that's, it's) for natural speech
- Include natural speech patterns and filler words occasionally
- Keep explanations simple and direct
- If the topic is complex, focus on the most important points only`;
  }

  /**
   * System prompt for clarification requests
   */
  static getClarificationPrompt(): string {
    return `You are a helpful AI assistant on a phone call. The user's question wasn't clear or you need more information.

VOICE RULES:
- Keep under 50 words (20 seconds)
- Ask for clarification politely and naturally
- Speak as if you're on a phone call
- Be patient and understanding
- Use simple language

Politely ask the user to clarify or repeat their question.`;
  }

  /**
   * System prompt for ending conversations
   */
  static getGoodbyePrompt(): string {
    return `You are ending a helpful phone conversation with someone who called for AI assistance.

VOICE RULES:
- Keep under 30 words (12 seconds)
- Be warm and friendly
- Thank them for calling
- Offer to help again in the future
- End naturally as you would a phone call

Say goodbye warmly and naturally.`;
  }

  /**
   * System prompt for error handling
   */
  static getErrorPrompt(): string {
    return `You are a helpful AI assistant on a phone call, but something went wrong with processing the user's request.

VOICE RULES:
- Keep under 40 words (16 seconds)
- Apologize briefly and naturally
- Suggest they try again or rephrase
- Be understanding and patient
- Speak as if you're on a phone call

Apologize for the issue and ask them to try again.`;
  }
}

/**
 * Service for managing AI conversations with voice optimization
 */
export class AIConversationService {
  private bedrockService: BedrockService;
  private config: Required<AIConversationConfig>;

  constructor(config: AIConversationConfig = {}) {
    this.config = {
      maxResponseWords: config.maxResponseWords || 100,
      defaultResponseLength: config.defaultResponseLength || 'medium',
      voiceOptimized: config.voiceOptimized !== false, // Default to true
      region: config.region || process.env.AWS_REGION || 'us-east-1',
      modelId: config.modelId || 'anthropic.claude-3-haiku-20240307-v1:0'
    };

    this.bedrockService = new BedrockService({
      region: this.config.region,
      modelId: this.config.modelId,
      maxTokens: this.getMaxTokensForWords(this.config.maxResponseWords),
      temperature: 0.7
    });
  }

  /**
   * Process user query with full conversation context
   */
  async processConversation(
    userQuery: string,
    aiContext: AIContext
  ): Promise<AIResponse> {
    try {
      // Build voice-optimized context
      const voiceContext = this.buildVoiceOptimizedContext(aiContext);
      
      // Process with Bedrock
      const response = await this.bedrockService.processQueryWithContext(
        userQuery,
        voiceContext
      );

      // Additional voice optimization
      if (this.config.voiceOptimized) {
        response.text = this.enhanceVoiceOptimization(response.text);
      }

      // Validate response meets voice requirements
      this.validateVoiceResponse(response.text);

      return response;

    } catch (error) {
      console.error('AI conversation processing error:', error);
      
      // Return fallback response for voice calls
      return {
        text: "I'm sorry, I'm having trouble processing that right now. Could you please try asking your question again?",
        usage: { inputTokens: 0, outputTokens: 0 }
      };
    }
  }

  /**
   * Generate AI-powered welcome message for new callers
   * Note: This is for AI-generated dynamic welcomes, not the standard DTMF welcome
   * The standard welcome with DTMF instructions is handled by DTMFService
   */
  async generateAIWelcome(): Promise<AIResponse> {
    const welcomeContext = {
      systemPrompt: VoicePromptTemplates.getWelcomePrompt(),
      userPreferences: {
        responseLength: 'short' as const,
        topics: [],
        language: 'en',
        voiceSpeed: 'normal' as const
      }
    };

    return await this.bedrockService.processQueryWithContext(
      'A new caller has just connected to the AI assistance line.',
      welcomeContext
    );
  }

  /**
   * Generate clarification request
   */
  async generateClarification(context?: string): Promise<AIResponse> {
    const clarificationContext = {
      systemPrompt: VoicePromptTemplates.getClarificationPrompt(),
      conversationContext: context,
      userPreferences: {
        responseLength: 'short' as const,
        topics: [],
        language: 'en',
        voiceSpeed: 'normal' as const
      }
    };

    return await this.bedrockService.processQueryWithContext(
      'The user\'s question was unclear or incomplete.',
      clarificationContext
    );
  }

  /**
   * Generate goodbye message
   */
  async generateGoodbye(): Promise<AIResponse> {
    const goodbyeContext = {
      systemPrompt: VoicePromptTemplates.getGoodbyePrompt(),
      userPreferences: {
        responseLength: 'short' as const,
        topics: [],
        language: 'en',
        voiceSpeed: 'normal' as const
      }
    };

    return await this.bedrockService.processQueryWithContext(
      'The user is ending the call and saying goodbye.',
      goodbyeContext
    );
  }

  /**
   * Generate error response
   */
  async generateErrorResponse(errorType?: string): Promise<AIResponse> {
    const errorContext = {
      systemPrompt: VoicePromptTemplates.getErrorPrompt(),
      userPreferences: {
        responseLength: 'short' as const,
        topics: [],
        language: 'en',
        voiceSpeed: 'normal' as const
      }
    };

    const errorMessage = errorType ? 
      `There was a ${errorType} error while processing the request.` :
      'There was an error processing the request.';

    return await this.bedrockService.processQueryWithContext(
      errorMessage,
      errorContext
    );
  }

  /**
   * Build voice-optimized context from AI context
   */
  private buildVoiceOptimizedContext(aiContext: AIContext): any {
    const responseLength = aiContext.userPreferences?.responseLength || this.config.defaultResponseLength;
    const maxWords = this.getMaxWordsForLength(responseLength);

    return {
      systemPrompt: aiContext.systemPrompt || VoicePromptTemplates.getConversationPrompt(maxWords),
      conversationContext: aiContext.conversationContext,
      conversationSummary: aiContext.conversationSummary,
      lastUserIntent: aiContext.lastUserIntent,
      userPreferences: {
        responseLength,
        topics: aiContext.userPreferences?.topics || [],
        language: aiContext.userPreferences?.language || 'en',
        voiceSpeed: aiContext.userPreferences?.voiceSpeed || 'normal'
      }
    };
  }

  /**
   * Enhanced voice optimization beyond basic Bedrock optimization
   */
  private enhanceVoiceOptimization(text: string): string {
    let optimized = text;

    // Remove any remaining formatting
    optimized = optimized.replace(/\[.*?\]/g, ''); // Remove bracketed content
    optimized = optimized.replace(/\(.*?\)/g, ''); // Remove parenthetical content that might be confusing
    
    // Ensure natural phone conversation flow
    optimized = optimized.replace(/^(Well,|So,|Now,|Okay,)/i, ''); // Remove unnecessary conversation starters
    optimized = optimized.replace(/\s+/g, ' ').trim(); // Clean up spacing

    // Add natural phone conversation elements if missing
    if (!optimized.match(/^(Hi|Hello|Hey|Thanks|Sure|Absolutely|Of course)/i)) {
      // Don't add greeting if it's a continuation
      if (!optimized.match(/^(Also|Additionally|Furthermore|Moreover|And|But|However)/i)) {
        optimized = optimized;
      }
    }

    return optimized;
  }

  /**
   * Validate response meets voice requirements
   */
  private validateVoiceResponse(text: string): void {
    const wordCount = text.split(/\s+/).length;
    const maxWords = this.config.maxResponseWords;

    if (wordCount > maxWords) {
      console.warn(`Voice response exceeds ${maxWords} words: ${wordCount} words`);
      console.warn(`Response: ${text.substring(0, 100)}...`);
    }

    // Check for problematic formatting that survived optimization
    const problematicPatterns = [
      /\*\*.*?\*\*/,  // Bold text
      /\*.*?\*/,      // Italic text
      /`.*?`/,        // Code text
      /#{1,6}\s/,     // Headers
      /^\s*[-*+]\s/m, // Bullet points
      /^\s*\d+\.\s/m  // Numbered lists
    ];

    for (const pattern of problematicPatterns) {
      if (pattern.test(text)) {
        console.warn('Voice response contains formatting that may not work well for speech:', pattern);
      }
    }
  }

  /**
   * Get maximum words for response length preference
   */
  private getMaxWordsForLength(length: 'short' | 'medium' | 'long'): number {
    switch (length) {
      case 'short': return 50;   // ~20 seconds
      case 'medium': return 100; // ~40 seconds
      case 'long': return 150;   // ~60 seconds
      default: return 100;
    }
  }

  /**
   * Convert word count to approximate token count
   */
  private getMaxTokensForWords(words: number): number {
    // Rough approximation: 1 word ≈ 1.3 tokens
    return Math.ceil(words * 1.3);
  }

  /**
   * Get current configuration
   */
  getConfig(): AIConversationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<AIConversationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Update Bedrock service if relevant config changed
    if (newConfig.region || newConfig.modelId || newConfig.maxResponseWords) {
      this.bedrockService = new BedrockService({
        region: this.config.region,
        modelId: this.config.modelId,
        maxTokens: this.getMaxTokensForWords(this.config.maxResponseWords),
        temperature: 0.7
      });
    }
  }

  /**
   * Test the service with a sample conversation
   */
  async testService(): Promise<boolean> {
    try {
      const testContext: AIContext = {
        sessionId: 'test-session',
        conversationContext: '',
        systemPrompt: VoicePromptTemplates.getConversationPrompt(50),
        userPreferences: {
          responseLength: 'short',
          topics: [],
          language: 'en',
          voiceSpeed: 'normal'
        },
        conversationSummary: '',
        lastUserIntent: 'testing',
        contextWindow: []
      };

      const response = await this.processConversation('Hello, can you hear me?', testContext);
      return response.text.length > 0;
    } catch (error) {
      console.error('AI conversation service test failed:', error);
      return false;
    }
  }
}