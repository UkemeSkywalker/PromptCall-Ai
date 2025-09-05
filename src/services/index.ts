/**
 * Service exports for PromptCall AI MVP
 */

export { DynamoSessionManager } from './dynamo-session-manager';
export type { DynamoSessionManagerConfig } from './dynamo-session-manager';

export { ConversationContextManager, DEFAULT_CONTEXT_CONFIG } from './conversation-context-manager';
export type { 
  UserPreferences, 
  AIContext, 
  SessionState, 
  ConversationContextConfig 
} from './conversation-context-manager';

export { DTMFService } from './dtmf-service';
export type { DTMFInput, DTMFResponse } from './dtmf-service';

export { TwiMLService } from './twiml-service';
export type { TwiMLOptions, RecordOptions, GatherOptions } from './twiml-service';

export { S3Service } from './s3-service';
export type { S3UploadResult, S3ServiceConfig } from './s3-service';

export { TranscribeService } from './transcribe-service';
export type { TranscribeResult, TranscribeConfig } from './transcribe-service';

export { TranscriptionProcessor } from './transcription-processor';
export type { TranscriptionResult, TranscriptionConfig } from './transcription-processor';

export { BedrockService, AVAILABLE_MODELS } from './bedrock-service';
export type { BedrockConfig, AIResponse } from './bedrock-service';

export { AIConversationService, VoicePromptTemplates } from './ai-conversation-service';
export type { AIConversationConfig } from './ai-conversation-service';