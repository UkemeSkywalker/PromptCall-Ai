/**
 * AI Conversation Service for handling AI interactions via AWS Bedrock
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export interface AIResponse {
  text: string;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AIConversationConfig {
  region?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export class AIConversationService {
  private bedrockClient: BedrockRuntimeClient;
  private config: AIConversationConfig;

  constructor(config: AIConversationConfig = {}) {
    this.config = {
      region: config.region || process.env.AWS_REGION || 'us-east-1',
      model: config.model || 'anthropic.claude-3-haiku-20240307-v1:0',
      maxTokens: config.maxTokens || 150, // Limit for voice responses
      temperature: config.temperature || 0.7
    };

    this.bedrockClient = new BedrockRuntimeClient({
      region: this.config.region
    });
  }

  /**
   * Generate AI response for user query
   */
  async generateResponse(userQuery: string, conversationHistory: string[] = []): Promise<AIResponse> {
    const systemPrompt = this.buildSystemPrompt();
    const contextPrompt = this.buildContextPrompt(conversationHistory);
    
    const fullPrompt = `${systemPrompt}\n\n${contextPrompt}\n\nUser: ${userQuery}\n\nAssistant:`;

    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      messages: [
        {
          role: "user",
          content: fullPrompt
        }
      ]
    };

    const command = new InvokeModelCommand({
      modelId: this.config.model,
      body: JSON.stringify(payload),
      contentType: 'application/json'
    });

    const response = await this.bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    return {
      text: responseBody.content[0].text,
      model: this.config.model!,
      usage: {
        inputTokens: responseBody.usage?.input_tokens || 0,
        outputTokens: responseBody.usage?.output_tokens || 0
      }
    };
  }

  /**
   * Build system prompt optimized for voice interactions
   */
  private buildSystemPrompt(): string {
    return `You are an AI assistant for PromptCall AI, a voice-based AI service accessed via phone calls. 

Key guidelines:
- Keep responses concise (under 60 seconds of speech, approximately 150 words)
- Use clear, simple language suitable for phone conversations
- Be helpful and direct
- Avoid complex formatting or lists that don't work well in speech
- If you need to provide multiple points, use natural speech patterns
- Always end with a clear conclusion or next step`;
  }

  /**
   * Build context prompt from conversation history
   */
  private buildContextPrompt(conversationHistory: string[]): string {
    if (conversationHistory.length === 0) {
      return 'This is the start of a new conversation.';
    }

    return `Previous conversation context:\n${conversationHistory.join('\n')}`;
  }

  /**
   * Process user message with full conversation context
   */
  async processUserMessage(userQuery: string, sessionId: string, conversationHistory: string[] = []): Promise<AIResponse> {
    const response = await this.generateResponse(userQuery, conversationHistory);
    response.text = this.optimizeForVoice(response.text);
    return response;
  }

  /**
   * Optimize response for voice delivery
   */
  optimizeForVoice(text: string): string {
    // Remove markdown formatting
    let optimized = text.replace(/[*_`]/g, '');
    
    // Replace bullet points with natural speech
    optimized = optimized.replace(/^[-*]\s+/gm, 'First, ');
    optimized = optimized.replace(/\n[-*]\s+/g, '. Next, ');
    
    // Ensure proper sentence endings
    if (!optimized.endsWith('.') && !optimized.endsWith('!') && !optimized.endsWith('?')) {
      optimized += '.';
    }

    return optimized;
  }
}