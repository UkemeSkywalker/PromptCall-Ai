import { TranscribeService, TranscriptionResult } from './transcribe-service';
import { DynamoSessionManager } from './dynamo-session-manager';

export interface TranscriptionProcessingConfig {
  confidenceThreshold: number;
  maxRetryAttempts: number;
  retryDelayMs: number;
  maxTranscriptionTimeMs: number;
}

export interface ProcessingResult {
  success: boolean;
  text: string;
  confidence: number;
  attempts: number;
  processingTimeMs: number;
  error?: string;
}

export class TranscriptionProcessor {
  private transcribeService: TranscribeService;
  private sessionManager: DynamoSessionManager;
  private config: TranscriptionProcessingConfig;

  constructor(
    transcribeService: TranscribeService,
    sessionManager: DynamoSessionManager,
    config: Partial<TranscriptionProcessingConfig> = {}
  ) {
    this.transcribeService = transcribeService;
    this.sessionManager = sessionManager;
    
    // Default configuration optimized for telephony
    this.config = {
      confidenceThreshold: config.confidenceThreshold || 0.75, // Realistic for telephony audio
      maxRetryAttempts: config.maxRetryAttempts || 2,
      retryDelayMs: config.retryDelayMs || 1000,
      maxTranscriptionTimeMs: config.maxTranscriptionTimeMs || 60000, // 1 minute
    };
  }

  /**
   * Process audio transcription with validation and retry logic
   */
  async processTranscription(
    s3AudioUrl: string,
    sessionId: string,
    conversationEntryId: string,
    callSid?: string
  ): Promise<ProcessingResult> {
    const startTime = Date.now();
    let attempts = 0;
    let lastError: string | undefined;

    console.log(`Starting transcription processing for session: ${sessionId}, entry: ${conversationEntryId}`);

    try {
      while (attempts < this.config.maxRetryAttempts) {
        attempts++;
        console.log(`Transcription attempt ${attempts}/${this.config.maxRetryAttempts}`);

        try {
          // Start transcription job
          const jobName = await this.transcribeService.transcribeAudio(s3AudioUrl, sessionId, callSid);
          
          // Poll for completion
          const result = await this.transcribeService.pollTranscriptionJob(
            jobName,
            this.config.maxTranscriptionTimeMs
          );

          // Validate result
          const validationResult = this.validateTranscriptionResult(result);
          
          if (validationResult.isValid) {
            // Success - update session with transcribed text
            await this.updateSessionWithTranscription(
              sessionId,
              conversationEntryId,
              result.text,
              result.confidence,
              attempts
            );

            const processingTime = Date.now() - startTime;
            console.log(`Transcription successful after ${attempts} attempts in ${processingTime}ms`);

            return {
              success: true,
              text: result.text,
              confidence: result.confidence,
              attempts,
              processingTimeMs: processingTime,
            };
          } else {
            // Low confidence - try enhanced transcription if we have retries left
            lastError = validationResult.reason;
            console.log(`Transcription validation failed: ${validationResult.reason}`);

            if (attempts < this.config.maxRetryAttempts) {
              console.log(`Attempting enhanced transcription (retry ${attempts + 1})`);
              
              // Try enhanced transcription
              const enhancedResult = await this.transcribeService.handleLowConfidence(
                s3AudioUrl,
                sessionId,
                result.confidence,
                callSid
              );

              const enhancedValidation = this.validateTranscriptionResult(enhancedResult);
              
              if (enhancedValidation.isValid) {
                // Enhanced transcription succeeded
                await this.updateSessionWithTranscription(
                  sessionId,
                  conversationEntryId,
                  enhancedResult.text,
                  enhancedResult.confidence,
                  attempts + 1
                );

                const processingTime = Date.now() - startTime;
                console.log(`Enhanced transcription successful after ${attempts + 1} attempts in ${processingTime}ms`);

                return {
                  success: true,
                  text: enhancedResult.text,
                  confidence: enhancedResult.confidence,
                  attempts: attempts + 1,
                  processingTimeMs: processingTime,
                };
              } else {
                lastError = enhancedValidation.reason;
                console.log(`Enhanced transcription also failed: ${enhancedValidation.reason}`);
              }
            }
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Unknown transcription error';
          console.error(`Transcription attempt ${attempts} failed:`, error);
          
          if (attempts < this.config.maxRetryAttempts) {
            console.log(`Waiting ${this.config.retryDelayMs}ms before retry...`);
            await this.sleep(this.config.retryDelayMs);
          }
        }
      }

      // All attempts failed
      const processingTime = Date.now() - startTime;
      console.error(`Transcription failed after ${attempts} attempts: ${lastError}`);

      // Update session with failure information
      await this.updateSessionWithTranscriptionFailure(
        sessionId,
        conversationEntryId,
        lastError || 'Transcription failed after maximum retry attempts',
        attempts
      );

      return {
        success: false,
        text: '',
        confidence: 0,
        attempts,
        processingTimeMs: processingTime,
        error: lastError || 'Transcription failed after maximum retry attempts',
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown processing error';
      
      console.error('Critical error in transcription processing:', error);

      await this.updateSessionWithTranscriptionFailure(
        sessionId,
        conversationEntryId,
        errorMessage,
        attempts
      );

      return {
        success: false,
        text: '',
        confidence: 0,
        attempts,
        processingTimeMs: processingTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Validate transcription result quality
   */
  private validateTranscriptionResult(result: TranscriptionResult): { isValid: boolean; reason?: string } {
    // Check if transcription completed successfully
    if (result.status !== 'COMPLETED') {
      return { isValid: false, reason: `Transcription job status: ${result.status}` };
    }

    // Check if we have text
    if (!result.text || result.text.trim().length === 0) {
      return { isValid: false, reason: 'No transcribed text received' };
    }

    // Check confidence threshold
    if (result.confidence < this.config.confidenceThreshold) {
      return { 
        isValid: false, 
        reason: `Low confidence: ${result.confidence.toFixed(3)} < ${this.config.confidenceThreshold}` 
      };
    }

    // Check for very short transcriptions (likely noise)
    if (result.text.trim().length < 3) {
      return { isValid: false, reason: 'Transcription too short (likely noise)' };
    }

    // Check for common transcription artifacts
    const artifacts = ['[inaudible]', '[unclear]', '[noise]', '***'];
    const hasArtifacts = artifacts.some(artifact => 
      result.text.toLowerCase().includes(artifact.toLowerCase())
    );
    
    if (hasArtifacts) {
      return { isValid: false, reason: 'Transcription contains audio artifacts' };
    }

    return { isValid: true };
  }

  /**
   * Update session with successful transcription
   */
  private async updateSessionWithTranscription(
    sessionId: string,
    conversationEntryId: string,
    text: string,
    confidence: number,
    attempts: number
  ): Promise<void> {
    try {
      // Get the session to find the conversation entry
      const session = await this.sessionManager.getSession(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      const entryIndex = session.conversationHistory.findIndex(entry => entry.id === conversationEntryId);
      if (entryIndex === -1) {
        throw new Error(`Conversation entry not found: ${conversationEntryId}`);
      }

      // Update the conversation entry with transcribed text
      const updatedEntry = {
        ...session.conversationHistory[entryIndex],
        text: text.trim(),
        confidence,
        processingDuration: Date.now() - session.conversationHistory[entryIndex].timestamp,
      };

      // Update the session
      session.conversationHistory[entryIndex] = updatedEntry;
      
      // Add system message about transcription success
      await this.sessionManager.addSystemMessage(
        sessionId,
        `Transcription completed successfully (confidence: ${confidence.toFixed(3)}, attempts: ${attempts})`
      );

      console.log(`Updated session ${sessionId} with transcribed text: "${text.substring(0, 50)}..."`);
    } catch (error) {
      console.error('Error updating session with transcription:', error);
      throw error;
    }
  }

  /**
   * Update session with transcription failure
   */
  private async updateSessionWithTranscriptionFailure(
    sessionId: string,
    conversationEntryId: string,
    errorMessage: string,
    attempts: number
  ): Promise<void> {
    try {
      await this.sessionManager.addSystemMessage(
        sessionId,
        `Transcription failed after ${attempts} attempts: ${errorMessage}`
      );

      console.log(`Updated session ${sessionId} with transcription failure`);
    } catch (error) {
      console.error('Error updating session with transcription failure:', error);
    }
  }

  /**
   * Get processing statistics for monitoring
   */
  getProcessingStats(): TranscriptionProcessingConfig {
    return { ...this.config };
  }

  /**
   * Update processing configuration
   */
  updateConfig(newConfig: Partial<TranscriptionProcessingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('Updated transcription processing config:', this.config);
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate audio quality before transcription (basic checks)
   */
  validateAudioQuality(audioFileInfo: { fileSize?: number; duration?: number }): { isValid: boolean; reason?: string } {
    // Check file size (too small likely means no audio)
    if (audioFileInfo.fileSize && audioFileInfo.fileSize < 1000) { // Less than 1KB
      return { isValid: false, reason: 'Audio file too small (likely empty)' };
    }

    // Check duration (too short likely means no speech)
    if (audioFileInfo.duration && audioFileInfo.duration < 0.5) { // Less than 0.5 seconds
      return { isValid: false, reason: 'Audio duration too short (likely no speech)' };
    }

    // Check duration (too long might be problematic)
    if (audioFileInfo.duration && audioFileInfo.duration > 300) { // More than 5 minutes
      return { isValid: false, reason: 'Audio duration too long (exceeds processing limits)' };
    }

    return { isValid: true };
  }
}