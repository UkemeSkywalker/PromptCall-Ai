/**
 * Transcription Processor for handling speech-to-text conversion and validation
 */

import { TranscribeService, TranscribeResult } from './transcribe-service';
import { S3Service } from './s3-service';

export interface TranscriptionResult {
  text: string;
  confidence: number;
  jobName: string;
  status: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS';
  isRetry?: boolean;
  originalConfidence?: number;
}

import { LanguageCode, MediaFormat } from '@aws-sdk/client-transcribe';

export interface TranscriptionConfig {
  region?: string;
  languageCode?: LanguageCode;
  mediaFormat?: MediaFormat;
  mediaSampleRateHertz?: number;
  confidenceThreshold?: number;
  maxRetries?: number;
}

export class TranscriptionProcessor {
  private transcribeService: TranscribeService;
  private s3Service: S3Service;
  private config: Required<TranscriptionConfig>;

  constructor(s3Service: S3Service, config: TranscriptionConfig = {}) {
    this.s3Service = s3Service;
    this.config = {
      region: config.region || process.env.AWS_REGION || 'us-east-1',
      languageCode: config.languageCode || LanguageCode.EN_US,
      mediaFormat: config.mediaFormat || MediaFormat.WAV,
      mediaSampleRateHertz: config.mediaSampleRateHertz || 8000,
      confidenceThreshold: config.confidenceThreshold || 0.7,
      maxRetries: config.maxRetries || 2
    };

    this.transcribeService = new TranscribeService({
      region: this.config.region,
      languageCode: this.config.languageCode,
      mediaFormat: this.config.mediaFormat,
      mediaSampleRateHertz: this.config.mediaSampleRateHertz
    });
  }

  /**
   * Process audio from Twilio recording URL
   */
  async processAudioFromUrl(recordingUrl: string, sessionId: string, callSid?: string): Promise<TranscriptionResult> {
    try {
      console.log(`Processing audio from URL for session ${sessionId}: ${recordingUrl}`);
      
      // Upload audio to S3
      const s3Result = await this.s3Service.uploadAudioFromUrl(recordingUrl, sessionId, callSid);
      console.log(`Audio uploaded to S3: ${s3Result.key}`);
      
      // Start transcription
      const s3Uri = this.s3Service.getS3Uri(s3Result.key);
      const transcribeResult = await this.transcribeService.transcribeAudio(s3Uri, sessionId);
      
      // Validate confidence and retry if needed
      return await this.validateAndRetryIfNeeded(transcribeResult, s3Uri, sessionId);
      
    } catch (error) {
      console.error('Error processing audio from URL:', error);
      throw new Error(`Failed to process audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate transcription confidence and retry if needed
   */
  private async validateAndRetryIfNeeded(
    result: TranscribeResult, 
    s3Uri: string, 
    sessionId: string,
    retryCount: number = 0
  ): Promise<TranscriptionResult> {
    const transcriptionResult: TranscriptionResult = {
      text: result.text,
      confidence: result.confidence,
      jobName: result.jobName,
      status: result.status as 'COMPLETED' | 'FAILED' | 'IN_PROGRESS',
      isRetry: retryCount > 0,
      originalConfidence: retryCount > 0 ? result.confidence : undefined
    };

    // Check if confidence meets threshold
    if (this.transcribeService.isConfidenceAcceptable(result.confidence, this.config.confidenceThreshold)) {
      console.log(`Transcription confidence acceptable: ${result.confidence}`);
      return transcriptionResult;
    }

    // Retry if we haven't exceeded max retries
    if (retryCount < this.config.maxRetries) {
      console.log(`Low confidence (${result.confidence}), retrying transcription (attempt ${retryCount + 1}/${this.config.maxRetries})`);
      
      try {
        const retryResult = await this.transcribeService.transcribeAudio(s3Uri, sessionId);
        return await this.validateAndRetryIfNeeded(retryResult, s3Uri, sessionId, retryCount + 1);
      } catch (error) {
        console.error('Retry transcription failed:', error);
        // Return original result if retry fails
        return transcriptionResult;
      }
    }

    // Return result with low confidence warning
    console.warn(`Transcription confidence below threshold: ${result.confidence} < ${this.config.confidenceThreshold}`);
    return transcriptionResult;
  }

  /**
   * Check if transcription result is acceptable
   */
  isTranscriptionAcceptable(result: TranscriptionResult): boolean {
    return result.status === 'COMPLETED' && 
           result.confidence >= this.config.confidenceThreshold &&
           result.text.trim().length > 0;
  }

  /**
   * Get user-friendly message for transcription issues
   */
  getTranscriptionIssueMessage(result: TranscriptionResult): string {
    if (result.status === 'FAILED') {
      return "I'm sorry, I couldn't process your audio. Please try speaking again.";
    }
    
    if (result.confidence < this.config.confidenceThreshold) {
      return "I didn't catch that clearly. Could you please repeat your question more clearly?";
    }
    
    if (result.text.trim().length === 0) {
      return "I didn't hear anything. Please speak your question.";
    }
    
    return "There was an issue processing your speech. Please try again.";
  }

  /**
   * Validate audio quality for transcription
   */
  validateAudioQuality(audioInfo: { url: string; duration?: number }): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];
    
    if (!audioInfo.url) {
      issues.push('No audio URL provided');
    }
    
    // Be more lenient with duration validation - Twilio sometimes reports 0 initially
    // Only reject if duration is explicitly 0 and we're sure it's not a timing issue
    if (audioInfo.duration !== undefined && audioInfo.duration > 300) {
      issues.push('Audio too long for transcription (maximum 5 minutes)');
    }
    
    // Don't reject based on short duration alone - let Transcribe handle it
    // Twilio recordings are usually valid even if duration is reported as 0 initially
    
    return {
      isValid: issues.length === 0,
      issues
    };
  }

  /**
   * Process transcription with full pipeline from S3 URI
   */
  async processTranscription(audioS3Uri: string, sessionId: string): Promise<TranscriptionResult> {
    try {
      const transcribeResult = await this.transcribeService.transcribeAudio(audioS3Uri, sessionId);
      return await this.validateAndRetryIfNeeded(transcribeResult, audioS3Uri, sessionId);
    } catch (error) {
      console.error('Error in transcription pipeline:', error);
      throw new Error(`Transcription pipeline failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get confidence threshold
   */
  getConfidenceThreshold(): number {
    return this.config.confidenceThreshold;
  }

  /**
   * Format transcription result for logging
   */
  formatResultForLogging(result: TranscriptionResult): string {
    return `Text: "${result.text}" | Confidence: ${result.confidence.toFixed(3)} | Status: ${result.status}${result.isRetry ? ' (retry)' : ''}`;
  }
}