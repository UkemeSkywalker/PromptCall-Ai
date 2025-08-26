/**
 * Conversation Context Manager for PromptCall AI MVP
 * Manages conversation context, AI prompts, and session state for optimal AI interactions
 */

import {
  CallSession,
  ConversationEntry,
  SessionStatus,
  isSessionTimedOut,
  isSessionOverDuration,
  SessionConfig,
  DEFAULT_SESSION_CONFIG,
} from '../types/session';
import { DynamoSessionManager } from './dynamo-session-manager';

/**
 * User preferences for conversation management
 */
export interface UserPreferences {
  responseLength: 'short' | 'medium' | 'long';
  topics: string[];
  language: string;
  voiceSpeed: 'slow' | 'normal' | 'fast';
}

/**
 * AI Context for processing user queries
 */
export interface AIContext {
  sessionId: string;
  conversationContext: string;
  userPreferences: UserPreferences;
  systemPrompt: string;
  conversationSummary?: string;
  lastUserIntent?: string;
  contextWindow: ConversationEntry[];
}

/**
 * Session state information beyond basic status
 */
export interface SessionState {
  status: SessionStatus;
  phase: 'greeting' | 'conversation' | 'clarification' | 'closing';
  turnCount: number;
  lastActivity: number;
  isWaitingForUser: boolean;
  hasErrors: boolean;
  errorCount: number;
  averageResponseTime: number;
  userEngagement: 'high' | 'medium' | 'low';
}

/**
 * Configuration for conversation context management
 */
export interface ConversationContextConfig {
  maxContextEntries: number;
  maxContextLength: number;
  summaryThreshold: number;
  responseWordLimit: number;
  sessionConfig: SessionConfig;
}

/**
 * Default configuration for conversation context
 */
export const DEFAULT_CONTEXT_CONFIG: ConversationContextConfig = {
  maxContextEntries: 10, // Keep last 10 conversation turns
  maxContextLength: 2000, // Max characters in context string
  summaryThreshold: 15, // Summarize after 15 entries
  responseWordLimit: 150, // Max words in AI response (for 60-second speech)
  sessionConfig: DEFAULT_SESSION_CONFIG,
};

export class ConversationContextManager {
  private sessionManager: DynamoSessionManager;
  private config: ConversationContextConfig;

  constructor(
    sessionManager: DynamoSessionManager,
    config: ConversationContextConfig = DEFAULT_CONTEXT_CONFIG
  ) {
    this.sessionManager = sessionManager;
    this.config = config;
  }

  /**
   * Initializes a new conversation session with greeting phase
   */
  async initializeConversation(
    callSid: string,
    phoneNumber: string,
    userPreferences?: Partial<UserPreferences>
  ): Promise<{ session: CallSession; context: AIContext }> {
    // Create new session
    const session = await this.sessionManager.createSession(callSid, phoneNumber);

    // Add system message for conversation start
    await this.sessionManager.addSystemMessage(
      session.sessionId,
      'Conversation initialized - greeting phase'
    );

    // Build initial AI context
    const context = await this.buildAIContext(session.sessionId, userPreferences);

    return { session, context };
  }

  /**
   * Processes a user message and updates conversation context
   */
  async processUserMessage(
    sessionId: string,
    userText: string,
    audioUrl?: string,
    confidence?: number
  ): Promise<AIContext> {
    // Add user message to session
    await this.sessionManager.addUserMessage(sessionId, userText, audioUrl, confidence);

    // Update session state
    await this.updateSessionState(sessionId, {
      isWaitingForUser: false,
      lastActivity: Date.now(),
    });

    // Build updated AI context
    return this.buildAIContext(sessionId);
  }

  /**
   * Processes an AI response and updates conversation context
   */
  async processAIResponse(
    sessionId: string,
    aiText: string,
    audioUrl?: string,
    processingDuration?: number
  ): Promise<void> {
    // Add AI response to session
    await this.sessionManager.addAiResponse(sessionId, aiText, audioUrl, processingDuration);

    // Update session state
    await this.updateSessionState(sessionId, {
      isWaitingForUser: true,
      lastActivity: Date.now(),
    });

    // Update conversation phase based on content
    await this.updateConversationPhase(sessionId, aiText);
  }

  /**
   * Builds comprehensive AI context for processing user queries
   */
  async buildAIContext(
    sessionId: string,
    userPreferences?: Partial<UserPreferences>
  ): Promise<AIContext> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Get conversation history with context window
    const contextWindow = this.getContextWindow(session.conversationHistory);

    // Build conversation context string
    const conversationContext = this.buildContextString(contextWindow);

    // Determine user preferences
    const preferences = this.buildUserPreferences(session, userPreferences);

    // Generate system prompt based on conversation phase
    const systemPrompt = this.generateSystemPrompt(session, preferences);

    // Extract conversation summary and user intent
    const conversationSummary = this.generateConversationSummary(contextWindow);
    const lastUserIntent = this.extractUserIntent(contextWindow);

    return {
      sessionId,
      conversationContext,
      userPreferences: preferences,
      systemPrompt,
      conversationSummary,
      lastUserIntent,
      contextWindow,
    };
  }

  /**
   * Gets the relevant context window from conversation history
   */
  private getContextWindow(conversationHistory: ConversationEntry[]): ConversationEntry[] {
    // Get the most recent entries within limits
    const recentEntries = conversationHistory.slice(-this.config.maxContextEntries);

    // Filter out system messages for AI context (keep user and AI only)
    return recentEntries.filter(entry => entry.type === 'user' || entry.type === 'ai');
  }

  /**
   * Builds a formatted context string for AI processing
   */
  private buildContextString(contextWindow: ConversationEntry[]): string {
    if (contextWindow.length === 0) {
      return 'This is the start of a new conversation.';
    }

    const contextLines = contextWindow.map(entry => {
      const speaker = entry.type === 'user' ? 'User' : 'Assistant';
      const timestamp = new Date(entry.timestamp).toISOString();
      return `[${timestamp}] ${speaker}: ${entry.text}`;
    });

    let contextString = contextLines.join('\n');

    // Truncate if too long
    if (contextString.length > this.config.maxContextLength) {
      contextString = contextString.substring(0, this.config.maxContextLength) + '...';
    }

    return contextString;
  }

  /**
   * Builds user preferences from session data and overrides
   */
  private buildUserPreferences(
    session: CallSession,
    overrides?: Partial<UserPreferences>
  ): UserPreferences {
    // Default preferences
    const defaults: UserPreferences = {
      responseLength: 'medium',
      topics: [],
      language: 'en',
      voiceSpeed: 'normal',
    };

    // Infer preferences from conversation history
    const inferred = this.inferUserPreferences(session.conversationHistory);

    // Merge defaults, inferred, and overrides
    return {
      ...defaults,
      ...inferred,
      ...overrides,
    };
  }

  /**
   * Infers user preferences from conversation patterns
   */
  private inferUserPreferences(conversationHistory: ConversationEntry[]): Partial<UserPreferences> {
    const preferences: Partial<UserPreferences> = {};

    // Analyze conversation length preferences
    const userMessages = conversationHistory.filter(entry => entry.type === 'user');
    const avgUserMessageLength = userMessages.reduce((sum, msg) => sum + msg.text.length, 0) / userMessages.length;

    if (avgUserMessageLength < 50) {
      preferences.responseLength = 'short';
    } else if (avgUserMessageLength > 150) {
      preferences.responseLength = 'long';
    } else {
      preferences.responseLength = 'medium';
    }

    // Extract topics from conversation
    const topics = this.extractTopics(conversationHistory);
    if (topics.length > 0) {
      preferences.topics = topics;
    }

    return preferences;
  }

  /**
   * Generates system prompt based on conversation phase and preferences
   */
  private generateSystemPrompt(session: CallSession, preferences: UserPreferences): string {
    const basePrompt = `You are a helpful AI assistant accessible via phone call. 
You are speaking to someone who called a phone number to get AI assistance.
Keep responses conversational, clear, and optimized for voice communication.`;

    const lengthGuidance = {
      short: 'Keep responses very brief (1-2 sentences, max 50 words).',
      medium: 'Keep responses concise but complete (2-4 sentences, max 100 words).',
      long: 'Provide detailed responses when needed (max 150 words for 60-second speech limit).',
    };

    const phaseGuidance = this.getPhaseGuidance(session);

    return `${basePrompt}

${lengthGuidance[preferences.responseLength]}

${phaseGuidance}

Important guidelines:
- Speak naturally as if having a phone conversation
- Use simple, clear language that's easy to understand over the phone
- Ask clarifying questions if the user's request is unclear
- Be helpful and supportive
- Remember this is a voice-only interaction - no visual elements
- Keep track of the conversation context and refer back to previous topics when relevant`;
  }

  /**
   * Gets phase-specific guidance for the system prompt
   */
  private getPhaseGuidance(session: CallSession): string {
    const turnCount = session.conversationHistory.filter(entry => entry.type === 'user').length;

    if (turnCount === 0) {
      return 'This is the start of the conversation. Greet the user warmly and ask how you can help them today.';
    } else if (turnCount < 3) {
      return 'You are in the early conversation phase. Focus on understanding what the user needs help with.';
    } else if (turnCount < 10) {
      return 'You are in an active conversation. Provide helpful responses and maintain engagement.';
    } else {
      return 'This is an extended conversation. Consider summarizing key points and checking if the user needs anything else.';
    }
  }

  /**
   * Generates a conversation summary for context
   */
  private generateConversationSummary(contextWindow: ConversationEntry[]): string {
    if (contextWindow.length === 0) {
      return 'No conversation history yet.';
    }

    const userMessages = contextWindow.filter(entry => entry.type === 'user');
    const aiMessages = contextWindow.filter(entry => entry.type === 'ai');

    if (userMessages.length === 0) {
      return 'User has not spoken yet.';
    }

    const topics = this.extractTopics(contextWindow);
    const topicSummary = topics.length > 0 ? `Topics discussed: ${topics.join(', ')}` : 'General conversation';

    return `Conversation with ${userMessages.length} user messages and ${aiMessages.length} AI responses. ${topicSummary}`;
  }

  /**
   * Extracts the user's likely intent from recent messages
   */
  private extractUserIntent(contextWindow: ConversationEntry[]): string {
    const recentUserMessages = contextWindow
      .filter(entry => entry.type === 'user')
      .slice(-2); // Last 2 user messages

    if (recentUserMessages.length === 0) {
      return 'unknown';
    }

    const lastMessage = recentUserMessages[recentUserMessages.length - 1].text.toLowerCase();

    // Simple intent classification
    if (lastMessage.includes('help') || lastMessage.includes('how')) {
      return 'seeking_help';
    } else if (lastMessage.includes('thank') || lastMessage.includes('bye')) {
      return 'ending_conversation';
    } else if (lastMessage.includes('?')) {
      return 'asking_question';
    } else if (lastMessage.includes('tell me') || lastMessage.includes('what is')) {
      return 'requesting_information';
    } else {
      return 'general_conversation';
    }
  }

  /**
   * Extracts topics from conversation history
   */
  private extractTopics(conversationHistory: ConversationEntry[]): string[] {
    const topics: string[] = [];
    const text = conversationHistory.map(entry => entry.text).join(' ').toLowerCase();

    // Simple keyword-based topic extraction
    const topicKeywords = {
      weather: ['weather', 'temperature', 'rain', 'sunny', 'cloudy'],
      technology: ['computer', 'software', 'app', 'website', 'tech'],
      health: ['health', 'doctor', 'medicine', 'sick', 'pain'],
      travel: ['travel', 'trip', 'vacation', 'flight', 'hotel'],
      food: ['food', 'recipe', 'cooking', 'restaurant', 'eat'],
      business: ['business', 'work', 'job', 'career', 'company'],
    };

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        topics.push(topic);
      }
    }

    return topics;
  }

  /**
   * Updates session state with new information
   */
  private async updateSessionState(
    sessionId: string,
    stateUpdates: Partial<SessionState>
  ): Promise<void> {
    // This would typically update a separate session state record
    // For now, we'll use the session's lastActivity field
    if (stateUpdates.lastActivity) {
      // The session manager already updates lastActivity in conversation methods
      // Additional state management could be added here
    }
  }

  /**
   * Updates conversation phase based on AI response content
   */
  private async updateConversationPhase(sessionId: string, aiText: string): Promise<void> {
    const lowerText = aiText.toLowerCase();

    if (lowerText.includes('hello') || lowerText.includes('welcome')) {
      // Still in greeting phase
    } else if (lowerText.includes('goodbye') || lowerText.includes('thank you for calling')) {
      // Moving to closing phase
    } else if (lowerText.includes('could you clarify') || lowerText.includes('what do you mean')) {
      // In clarification phase
    } else {
      // Active conversation phase
    }

    // Add system message to track phase changes
    // This could be enhanced with more sophisticated phase tracking
  }

  /**
   * Checks if session needs attention (timeout, errors, etc.)
   */
  async checkSessionHealth(sessionId: string): Promise<{
    needsAttention: boolean;
    reasons: string[];
    recommendations: string[];
  }> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) {
      return {
        needsAttention: true,
        reasons: ['Session not found'],
        recommendations: ['Create new session'],
      };
    }

    const reasons: string[] = [];
    const recommendations: string[] = [];

    // Check for timeout
    if (isSessionTimedOut(session, this.config.sessionConfig)) {
      reasons.push('Session timed out due to inactivity');
      recommendations.push('Send timeout prompt or end session gracefully');
    }

    // Check for duration limit
    if (isSessionOverDuration(session, this.config.sessionConfig)) {
      reasons.push('Session exceeded maximum duration');
      recommendations.push('Suggest wrapping up the conversation');
    }

    // Check conversation length
    if (session.conversationHistory.length > this.config.summaryThreshold) {
      reasons.push('Long conversation may need summarization');
      recommendations.push('Provide conversation summary and check if user needs more help');
    }

    // Check for repeated errors
    const recentErrors = session.conversationHistory
      .filter(entry => entry.type === 'system' && entry.text.includes('error'))
      .slice(-3);

    if (recentErrors.length >= 2) {
      reasons.push('Multiple recent errors detected');
      recommendations.push('Apologize for technical difficulties and offer alternative assistance');
    }

    return {
      needsAttention: reasons.length > 0,
      reasons,
      recommendations,
    };
  }

  /**
   * Validates AI response before sending to user
   */
  validateAIResponse(response: string, preferences: UserPreferences): {
    isValid: boolean;
    issues: string[];
    suggestions: string[];
  } {
    const issues: string[] = [];
    const suggestions: string[] = [];

    // Check word count
    const wordCount = response.split(/\s+/).length;
    const maxWords = this.config.responseWordLimit;

    if (wordCount > maxWords) {
      issues.push(`Response too long: ${wordCount} words (max: ${maxWords})`);
      suggestions.push('Shorten response or split into multiple parts');
    }

    // Check for phone-inappropriate content
    if (response.includes('click') || response.includes('see') || response.includes('look')) {
      issues.push('Response contains visual references inappropriate for phone calls');
      suggestions.push('Replace visual references with audio-appropriate language');
    }

    // Check response length preference
    const expectedLength = {
      short: 50,
      medium: 100,
      long: 150,
    }[preferences.responseLength];

    if (wordCount > expectedLength * 1.5) {
      issues.push(`Response longer than user preference (${preferences.responseLength})`);
      suggestions.push(`Adjust response to match ${preferences.responseLength} preference`);
    }

    return {
      isValid: issues.length === 0,
      issues,
      suggestions,
    };
  }

  /**
   * Gets conversation statistics for monitoring
   */
  async getConversationStats(sessionId: string): Promise<{
    turnCount: number;
    duration: number;
    averageResponseLength: number;
    topicsDiscussed: string[];
    userEngagement: 'high' | 'medium' | 'low';
  }> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const userMessages = session.conversationHistory.filter(entry => entry.type === 'user');
    const aiMessages = session.conversationHistory.filter(entry => entry.type === 'ai');

    const duration = session.endTime 
      ? session.endTime - session.startTime 
      : Date.now() - session.startTime;

    const averageResponseLength = aiMessages.length > 0
      ? aiMessages.reduce((sum, msg) => sum + msg.text.length, 0) / aiMessages.length
      : 0;

    const topicsDiscussed = this.extractTopics(session.conversationHistory);

    // Simple engagement calculation
    const engagementScore = userMessages.length / Math.max(1, duration / 60000); // messages per minute
    const userEngagement = engagementScore > 2 ? 'high' : engagementScore > 0.5 ? 'medium' : 'low';

    return {
      turnCount: userMessages.length,
      duration: Math.round(duration / 1000), // seconds
      averageResponseLength: Math.round(averageResponseLength),
      topicsDiscussed,
      userEngagement,
    };
  }
}