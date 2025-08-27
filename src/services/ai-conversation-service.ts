import { BedrockService, AIResponse } from './bedrock-service';
import { ConversationContextManager, AIContext } from './conversation-context-manager';
import { DynamoSessionManager } from './dynamo-session-manager';

/**
 * Configuration for AI conversation service
 */
export interface AIConversationConfig {
  bedrockModelId?: string;
  maxRetries?: number;
  fallbackResponses?: string[];
}

/**
 * Result of processing a user query with full context
 */
export interface ConversationResult {
  aiResponse: AIResponse;
  context: AIContext;
  responseStats: {
    wordCount: number;
    estimatedSpeechSeconds: number;
    isWithinLimit: boolean;
  };
  validationResult: {
    isValid: boolean;
    issues: string[];
    suggestions: string[];
  };
}

/**
 * Integrated AI conversation service that combines Bedrock AI with conversation context management
 */
export class AIConversationService {
  private bedrockService: BedrockService;
  private contextManager: ConversationContextManager;
  private config: AIConversationConfig;

  constructor(
    sessionManager: DynamoSessionManager,
    config: AIConversationConfig = {}
  ) {
    this.config = {
      maxRetries: 3,
      fallbackResponses: [
        "I'm sorry, I'm having trouble processing your request right now. Could you please try asking in a different way?",
        "I apologize, but I'm experiencing some technical difficulties. Let me try to help you with something else.",
        "I'm having some connection issues at the moment. Is there something simpler I can help you with?"
      ],
      ...config
    };

    this.bedrockService = new BedrockService({
      modelId: config.bedrockModelId
    });

    this.contextManager = new ConversationContextManager(sessionManager);
  }

  /**
   * Initialize a new conversation session
   */
  async initializeConversation(
    callSid: string,
    phoneNumber: string
  ): Promise<{ sessionId: string; welcomeMessage: string }> {
    const { session, context } = await this.contextManager.initializeConversation(
      callSid,
      phoneNumber
    );

    // Generate personalized welcome message
    const welcomeMessage = await this.generateWelcomeMessage(context);

    return {
      sessionId: session.sessionId,
      welcomeMessage
    };
  }

  /**
   * Process a user message and generate AI response with full context
   */
  async processUserMessage(
    sessionId: string,
    userText: string,
    audioUrl?: string,
    confidence?: number
  ): Promise<ConversationResult> {
    // Update conversation context with user message
    const context = await this.contextManager.processUserMessage(
      sessionId,
      userText,
      audioUrl,
      confidence
    );

    // Generate AI response with context
    const aiResponse = await this.generateContextualResponse(userText, context);

    // Validate the response
    const validationResult = this.contextManager.validateAIResponse(
      aiResponse.text,
      context.userPreferences
    );

    // Get response statistics
    const responseStats = this.bedrockService.getResponseStats(aiResponse.text);

    // Store AI response in conversation context
    await this.contextManager.processAIResponse(
      sessionId,
      aiResponse.text,
      undefined, // audioUrl will be added later by TTS service
      responseStats.estimatedSpeechSeconds * 1000 // convert to milliseconds
    );

    return {
      aiResponse,
      context,
      responseStats,
      validationResult
    };
  }

  /**
   * Generate AI response with full conversation context
   */
  private async generateContextualResponse(
    userQuery: string,
    context: AIContext,
    retryCount: number = 0
  ): Promise<AIResponse> {
    try {
      return await this.bedrockService.processQueryWithContext(userQuery, {
        conversationContext: context.conversationContext,
        systemPrompt: context.systemPrompt,
        userPreferences: context.userPreferences,
        conversationSummary: context.conversationSummary,
        lastUserIntent: context.lastUserIntent
      });

    } catch (error) {
      console.error(`AI response generation failed (attempt ${retryCount + 1}):`, error);

      // Retry with simplified context
      if (retryCount < this.config.maxRetries!) {
        console.log(`Retrying with simplified context...`);
        
        try {
          return await this.bedrockService.processQuery(
            userQuery,
            context.conversationSummary || 'Previous conversation context'
          );
        } catch (retryError) {
          return this.generateContextualResponse(userQuery, context, retryCount + 1);
        }
      }

      // Use fallback response
      console.log('Using fallback response due to repeated failures');
      return this.generateFallbackResponse(error);
    }
  }

  /**
   * Generate a welcome message based on context
   */
  private async generateWelcomeMessage(context: AIContext): Promise<string> {
    try {
      const welcomeQuery = "Generate a warm, friendly welcome message for someone who just called for AI assistance";
      
      return (await this.bedrockService.processQueryWithContext(welcomeQuery, {
        systemPrompt: context.systemPrompt,
        userPreferences: { responseLength: 'short', topics: [] }
      })).text;

    } catch (error) {
      console.error('Failed to generate welcome message:', error);
      return "Hello! Welcome to PromptCall AI. I'm here to help you with any questions you might have. What can I assist you with today?";
    }
  }

  /**
   * Generate fallback response when AI service fails
   */
  private generateFallbackResponse(error: any): AIResponse {
    const fallbackText = this.config.fallbackResponses![
      Math.floor(Math.random() * this.config.fallbackResponses!.length)
    ];

    return {
      text: fallbackText,
      usage: {
        inputTokens: 0,
        outputTokens: fallbackText.split(/\s+/).length
      }
    };
  }

  /**
   * Check if a session needs attention (timeouts, errors, etc.)
   */
  async checkSessionHealth(sessionId: string): Promise<{
    needsAttention: boolean;
    reasons: string[];
    recommendations: string[];
    suggestedResponse?: string;
  }> {
    const healthCheck = await this.contextManager.checkSessionHealth(sessionId);
    
    let suggestedResponse: string | undefined;

    if (healthCheck.needsAttention) {
      // Generate appropriate response based on the issues
      if (healthCheck.reasons.includes('Session timed out due to inactivity')) {
        suggestedResponse = "I notice you've been quiet for a while. Are you still there? Is there anything else I can help you with?";
      } else if (healthCheck.reasons.includes('Session exceeded maximum duration')) {
        suggestedResponse = "We've been talking for quite a while now. Is there anything else I can help you with before we wrap up?";
      } else if (healthCheck.reasons.includes('Long conversation may need summarization')) {
        suggestedResponse = "Let me quickly summarize what we've discussed so far, and then let me know if there's anything else you need help with.";
      }
    }

    return {
      ...healthCheck,
      suggestedResponse
    };
  }

  /**
   * Get conversation statistics
   */
  async getConversationStats(sessionId: string) {
    return this.contextManager.getConversationStats(sessionId);
  }

  /**
   * End conversation gracefully
   */
  async endConversation(sessionId: string): Promise<string> {
    try {
      const stats = await this.getConversationStats(sessionId);
      
      const endingQuery = `Generate a friendly goodbye message. We discussed ${stats.topicsDiscussed.join(', ')} and had ${stats.turnCount} exchanges.`;
      
      const response = await this.bedrockService.processQuery(endingQuery);
      
      // Mark session as completed
      // This would be handled by the session manager
      
      return response.text;

    } catch (error) {
      console.error('Failed to generate ending message:', error);
      return "Thank you for calling PromptCall AI! I hope I was able to help you today. Have a great day!";
    }
  }

  /**
   * Test the AI conversation service
   */
  async testService(): Promise<boolean> {
    try {
      const testResult = await this.bedrockService.testConnection();
      return testResult;
    } catch (error) {
      console.error('AI conversation service test failed:', error);
      return false;
    }
  }
}