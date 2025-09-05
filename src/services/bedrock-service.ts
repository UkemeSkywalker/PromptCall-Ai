import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

/**
 * Configuration for Bedrock service
 */
export interface BedrockConfig {
  region?: string;
  modelId?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Available Bedrock models for PromptCall AI
 */
export const AVAILABLE_MODELS = {
  CLAUDE_HAIKU: 'anthropic.claude-3-haiku-20240307-v1:0',
  CLAUDE_SONNET: 'anthropic.claude-3-sonnet-20240229-v1:0', 
  TITAN_EXPRESS: 'amazon.titan-text-express-v1'
} as const;

/**
 * AI response from Bedrock
 */
export interface AIResponse {
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Service for interacting with AWS Bedrock AI models
 */
export class BedrockService {
  private client: BedrockRuntimeClient;
  private config: Required<BedrockConfig>;

  constructor(config: BedrockConfig = {}) {
    this.config = {
      region: config.region || process.env.AWS_REGION || 'us-east-1',
      modelId: config.modelId || 'anthropic.claude-3-haiku-20240307-v1:0',
      maxTokens: config.maxTokens || 150, // Limit for voice responses (~60 seconds)
      temperature: config.temperature || 0.7
    };

    this.client = new BedrockRuntimeClient({
      region: this.config.region
    });
  }

  /**
   * Process a user query with full conversation context integration
   */
  async processQueryWithContext(
    userQuery: string, 
    aiContext: {
      conversationContext?: string;
      systemPrompt?: string;
      userPreferences?: {
        responseLength: 'short' | 'medium' | 'long';
        topics: string[];
      };
      conversationSummary?: string;
      lastUserIntent?: string;
    }
  ): Promise<AIResponse> {
    try {
      const prompt = this.buildContextualPrompt(userQuery, aiContext);
      
      const requestBody = this.buildRequestBody(prompt);
      
      const command = new InvokeModelCommand({
        modelId: this.config.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody)
      });

      const response = await this.client.send(command);
      
      if (!response.body) {
        throw new Error('No response body from Bedrock');
      }

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const aiResponse = this.parseResponse(responseBody);
      
      // Optimize response for voice delivery
      aiResponse.text = this.optimizeForVoice(aiResponse.text);
      
      // Validate response length based on user preferences
      const maxWords = this.getMaxWordsForPreference(aiContext.userPreferences?.responseLength);
      if (!this.validateResponseLength(aiResponse.text, maxWords)) {
        console.warn(`Response exceeds ${maxWords} words: ${aiResponse.text.split(/\s+/).length} words`);
      }
      
      return aiResponse;

    } catch (error) {
      console.error('Bedrock API error:', error);
      throw new Error(`Failed to process query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process a user query and generate AI response (legacy method)
   */
  async processQuery(userQuery: string, conversationContext?: string): Promise<AIResponse> {
    try {
      const prompt = this.buildPrompt(userQuery, conversationContext);
      
      const requestBody = this.buildRequestBody(prompt);
      
      const command = new InvokeModelCommand({
        modelId: this.config.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody)
      });

      const response = await this.client.send(command);
      
      if (!response.body) {
        throw new Error('No response body from Bedrock');
      }

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const aiResponse = this.parseResponse(responseBody);
      
      // Optimize response for voice delivery
      aiResponse.text = this.optimizeForVoice(aiResponse.text);
      
      // Validate response length
      if (!this.validateResponseLength(aiResponse.text)) {
        console.warn(`Response exceeds 150 words: ${aiResponse.text.split(/\s+/).length} words`);
      }
      
      return aiResponse;

    } catch (error) {
      console.error('Bedrock API error:', error);
      throw new Error(`Failed to process query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build request body based on model type
   */
  private buildRequestBody(prompt: string): any {
    if (this.config.modelId.startsWith('anthropic.claude')) {
      return {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      };
    } else if (this.config.modelId.startsWith('amazon.titan')) {
      return {
        inputText: prompt,
        textGenerationConfig: {
          maxTokenCount: this.config.maxTokens,
          temperature: this.config.temperature,
          topP: 0.9,
          stopSequences: []
        }
      };
    } else {
      throw new Error(`Unsupported model: ${this.config.modelId}`);
    }
  }

  /**
   * Parse response based on model type
   */
  private parseResponse(responseBody: any): AIResponse {
    if (this.config.modelId.startsWith('anthropic.claude')) {
      return {
        text: responseBody.content[0].text,
        usage: {
          inputTokens: responseBody.usage?.input_tokens || 0,
          outputTokens: responseBody.usage?.output_tokens || 0
        }
      };
    } else if (this.config.modelId.startsWith('amazon.titan')) {
      return {
        text: responseBody.results[0].outputText,
        usage: {
          inputTokens: responseBody.inputTextTokenCount || 0,
          outputTokens: responseBody.results[0].tokenCount || 0
        }
      };
    } else {
      throw new Error(`Unsupported model response format: ${this.config.modelId}`);
    }
  }  /**

   * Build contextual prompt with full AI context integration
   */
  private buildContextualPrompt(
    userQuery: string, 
    aiContext: {
      conversationContext?: string;
      systemPrompt?: string;
      userPreferences?: {
        responseLength: 'short' | 'medium' | 'long';
        topics: string[];
      };
      conversationSummary?: string;
      lastUserIntent?: string;
    }
  ): string {
    const responseLength = aiContext.userPreferences?.responseLength || 'medium';
    const maxWords = this.getMaxWordsForPreference(responseLength);
    
    let prompt = aiContext.systemPrompt || `You are a helpful AI assistant accessed via phone call in regions with limited internet access.`;
    
    prompt += `\n\nCRITICAL VOICE OPTIMIZATION RULES:
- MAXIMUM ${maxWords} words (${Math.ceil(maxWords * 0.4)} seconds of speech) - this is STRICT for call cost management
- Use simple, conversational English suitable for phone calls
- Speak as if you're having a natural phone conversation
- NO bullet points, lists, or complex formatting - speak everything naturally
- Use short sentences and natural pauses
- Avoid technical jargon - explain things simply
- Be warm, friendly, and helpful
- If giving multiple points, use natural transitions like "first", "also", "and finally"
- End with a natural conversation closer when appropriate`;

    if (aiContext.conversationSummary) {
      prompt += `\n\nCONVERSATION SUMMARY:\n${aiContext.conversationSummary}`;
    }

    if (aiContext.conversationContext) {
      prompt += `\n\nRECENT CONVERSATION:\n${aiContext.conversationContext}`;
    }

    if (aiContext.lastUserIntent) {
      prompt += `\n\nUSER'S LIKELY INTENT: ${aiContext.lastUserIntent}`;
    }

    if (aiContext.userPreferences?.topics && aiContext.userPreferences.topics.length > 0) {
      prompt += `\n\nTOPICS DISCUSSED: ${aiContext.userPreferences.topics.join(', ')}`;
    }

    prompt += `\n\nUSER'S CURRENT QUESTION: "${userQuery}"

Respond as if you're speaking directly to them on the phone, maintaining conversation continuity:`;

    return prompt;
  }

  /**
   * Get maximum words based on user preference
   */
  private getMaxWordsForPreference(preference?: 'short' | 'medium' | 'long'): number {
    switch (preference) {
      case 'short': return 50;  // ~20 seconds
      case 'medium': return 100; // ~40 seconds  
      case 'long': return 150;   // ~60 seconds
      default: return 100;
    }
  }

  /**
   * Build optimized prompt for voice interactions (legacy method)
   */
  private buildPrompt(userQuery: string, conversationContext?: string): string {
    const systemPrompt = `You are a helpful AI assistant accessed via phone call in regions with limited internet access. 

CRITICAL VOICE OPTIMIZATION RULES:
- MAXIMUM 150 words (60 seconds of speech) - this is STRICT for call cost management
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
- If the topic is complex, focus on the most important points only

${conversationContext ? `PREVIOUS CONVERSATION:\n${conversationContext}\n` : ''}

USER'S QUESTION: "${userQuery}"

Respond as if you're speaking directly to them on the phone:`;

    return systemPrompt;
  }

  /**
   * Validate response length for voice optimization
   */
  private validateResponseLength(text: string, maxWords: number = 150): boolean {
    const wordCount = text.split(/\s+/).length;
    return wordCount <= maxWords;
  }

  /**
   * Optimize response for voice delivery
   */
  private optimizeForVoice(text: string): string {
    // Remove any markdown formatting that might have slipped through
    let optimized = text.replace(/\*\*(.*?)\*\*/g, '$1'); // Remove bold
    optimized = optimized.replace(/\*(.*?)\*/g, '$1'); // Remove italics
    optimized = optimized.replace(/`(.*?)`/g, '$1'); // Remove code formatting
    optimized = optimized.replace(/#{1,6}\s/g, ''); // Remove headers
    
    // Ensure natural speech patterns
    optimized = optimized.replace(/\n\n/g, ' '); // Replace paragraph breaks with spaces
    optimized = optimized.replace(/\n/g, ' '); // Replace line breaks with spaces
    optimized = optimized.replace(/\s+/g, ' '); // Normalize whitespace
    optimized = optimized.trim();
    
    return optimized;
  }

  /**
   * Test Bedrock connection and authentication
   */
  async testConnection(): Promise<boolean> {
    try {
      const testResponse = await this.processQuery('Hello, can you hear me?');
      return testResponse.text.length > 0;
    } catch (error) {
      console.error('Bedrock connection test failed:', error);
      
      // Check if it's a model access issue
      if (error instanceof Error && error.message.includes('access to the model')) {
        console.log('💡 Model access issue detected. You may need to:');
        console.log('   1. Go to AWS Console > Bedrock > Model access');
        console.log('   2. Request access to the model:', this.config.modelId);
        console.log('   3. Or try a different model that you have access to');
      }
      
      return false;
    }
  }

  /**
   * Try different commonly available models
   */
  async findAvailableModel(): Promise<string | null> {
    const modelsToTry = [
      'amazon.titan-text-express-v1',
      'anthropic.claude-3-haiku-20240307-v1:0',
      'anthropic.claude-instant-v1',
      'ai21.j2-mid-v1',
      'ai21.j2-ultra-v1'
    ];

    for (const modelId of modelsToTry) {
      try {
        console.log(`🔍 Trying model: ${modelId}`);
        const tempService = new BedrockService({ ...this.config, modelId });
        const response = await tempService.processQuery('Test');
        if (response.text.length > 0) {
          console.log(`✅ Model ${modelId} is available`);
          return modelId;
        }
      } catch (error) {
        console.log(`❌ Model ${modelId} not available`);
      }
    }

    return null;
  }

  /**
   * Get current model configuration
   */
  getConfig(): BedrockConfig {
    return { ...this.config };
  }

  /**
   * Get list of available models
   */
  static getAvailableModels() {
    return AVAILABLE_MODELS;
  }

  /**
   * Switch to a different model
   */
  switchModel(modelId: string): void {
    if (!Object.values(AVAILABLE_MODELS).includes(modelId as any)) {
      throw new Error(`Model ${modelId} is not available. Available models: ${Object.values(AVAILABLE_MODELS).join(', ')}`);
    }
    this.config.modelId = modelId;
  }

  /**
   * Get response statistics for monitoring
   */
  getResponseStats(text: string): {
    wordCount: number;
    estimatedSpeechSeconds: number;
    isWithinLimit: boolean;
  } {
    const wordCount = text.split(/\s+/).length;
    const estimatedSpeechSeconds = Math.ceil(wordCount * 0.4); // ~2.5 words per second
    const isWithinLimit = wordCount <= 150;

    return {
      wordCount,
      estimatedSpeechSeconds,
      isWithinLimit
    };
  }
}