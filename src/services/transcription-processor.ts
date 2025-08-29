/**
 * Transcription Processor for handling speech-to-text conversion
 */

import { TranscribeClient, StartTranscriptionJobCommand, GetTranscriptionJobCommand, LanguageCode, MediaFormat } from '@aws-sdk/client-transcribe';

export interface TranscriptionResult {
  text: string;
  confidence: number;
  jobName: string;
  status: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS';
}

export interface TranscriptionConfig {
  region?: string;
  languageCode?: LanguageCode;
  mediaFormat?: MediaFormat;
  mediaSampleRateHertz?: number;
}

export class TranscriptionProcessor {
  private transcribeClient: TranscribeClient;
  private config: TranscriptionConfig;

  constructor(config: TranscriptionConfig = {}) {
    this.config = {
      region: config.region || process.env.AWS_REGION || 'us-east-1',
      languageCode: config.languageCode || LanguageCode.EN_US,
      mediaFormat: config.mediaFormat || MediaFormat.WAV,
      mediaSampleRateHertz: config.mediaSampleRateHertz || 8000
    };

    this.transcribeClient = new TranscribeClient({
      region: this.config.region
    });
  }

  /**
   * Start transcription job for audio file
   */
  async startTranscription(audioS3Uri: string, jobName: string): Promise<string> {
    const command = new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: this.config.languageCode,
      MediaFormat: this.config.mediaFormat,
      Media: {
        MediaFileUri: audioS3Uri
      },
      Settings: {
        ShowSpeakerLabels: false,
        MaxSpeakerLabels: 1
      }
    });

    await this.transcribeClient.send(command);
    return jobName;
  }

  /**
   * Get transcription job result
   */
  async getTranscriptionResult(jobName: string): Promise<TranscriptionResult> {
    const command = new GetTranscriptionJobCommand({
      TranscriptionJobName: jobName
    });

    const response = await this.transcribeClient.send(command);
    const job = response.TranscriptionJob;

    if (!job) {
      throw new Error(`Transcription job ${jobName} not found`);
    }

    const result: TranscriptionResult = {
      text: '',
      confidence: 0,
      jobName,
      status: job.TranscriptionJobStatus as 'COMPLETED' | 'FAILED' | 'IN_PROGRESS'
    };

    if (job.TranscriptionJobStatus === 'COMPLETED' && job.Transcript?.TranscriptFileUri) {
      // In a real implementation, we would fetch and parse the transcript file
      // For now, we'll return a placeholder
      result.text = 'Transcription completed - implementation pending';
      result.confidence = 0.95;
    }

    return result;
  }

  /**
   * Poll transcription job until completion
   */
  async pollTranscriptionJob(jobName: string, maxAttempts: number = 30): Promise<TranscriptionResult> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.getTranscriptionResult(jobName);
      
      if (result.status === 'COMPLETED' || result.status === 'FAILED') {
        return result;
      }

      // Wait 2 seconds before next poll
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error(`Transcription job ${jobName} did not complete within ${maxAttempts} attempts`);
  }

  /**
   * Validate audio quality for transcription
   */
  validateAudioQuality(audioInfo: { url: string; duration?: number }): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];
    
    // Basic validation - in real implementation would analyze audio
    if (!audioInfo.url) {
      issues.push('No audio URL provided');
    }
    
    if (audioInfo.duration && audioInfo.duration < 1) {
      issues.push('Audio too short for transcription');
    }
    
    return {
      isValid: issues.length === 0,
      issues
    };
  }

  /**
   * Process transcription with full pipeline
   */
  async processTranscription(audioS3Uri: string, sessionId: string): Promise<TranscriptionResult> {
    const jobName = this.generateJobName(sessionId, Date.now());
    await this.startTranscription(audioS3Uri, jobName);
    return await this.pollTranscriptionJob(jobName);
  }

  /**
   * Generate unique job name
   */
  generateJobName(sessionId: string, timestamp: number): string {
    return `transcribe-${sessionId}-${timestamp}`;
  }
}