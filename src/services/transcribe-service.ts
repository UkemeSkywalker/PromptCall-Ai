import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  TranscriptionJobStatus,
  LanguageCode,
  MediaFormat,
} from '@aws-sdk/client-transcribe';

export interface TranscriptionResult {
  text: string;
  confidence: number;
  jobName: string;
  status: TranscriptionJobStatus;
  duration?: number;
}

export interface TranscribeConfig {
  region?: string;
  languageCode?: LanguageCode;
  mediaFormat?: MediaFormat;
  sampleRateHertz?: number;
  enableSpeakerLabels?: boolean;
  maxSpeakerLabels?: number;
}

export class TranscribeService {
  private client: TranscribeClient;
  private config: Required<TranscribeConfig>;

  constructor(config: TranscribeConfig = {}) {
    this.client = new TranscribeClient({
      region: config.region || process.env.AWS_REGION || 'us-east-1',
    });

    // Default configuration optimized for telephony audio
    this.config = {
      region: config.region || process.env.AWS_REGION || 'us-east-1',
      languageCode: config.languageCode || LanguageCode.EN_US,
      mediaFormat: config.mediaFormat || MediaFormat.WAV,
      sampleRateHertz: config.sampleRateHertz || 8000, // Standard telephony sample rate
      enableSpeakerLabels: config.enableSpeakerLabels ?? false, // Default to false for single caller
      maxSpeakerLabels: config.maxSpeakerLabels || 2, // Minimum required when speaker labels enabled
    };
  }

  /**
   * Start a transcription job for an audio file stored in S3
   */
  async transcribeAudio(
    s3AudioUrl: string,
    sessionId: string,
    callSid?: string
  ): Promise<string> {
    try {
      // Generate unique job name
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const jobName = `transcribe-${sessionId}-${timestamp}`;

      console.log(`Starting transcription job: ${jobName} for audio: ${s3AudioUrl}`);

      const command = new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        LanguageCode: this.config.languageCode,
        MediaFormat: this.config.mediaFormat,
        Media: {
          MediaFileUri: s3AudioUrl,
        },
        MediaSampleRateHertz: this.config.sampleRateHertz,
        Settings: {
          ShowSpeakerLabels: this.config.enableSpeakerLabels,
          // Only set MaxSpeakerLabels if ShowSpeakerLabels is true
          ...(this.config.enableSpeakerLabels && { MaxSpeakerLabels: this.config.maxSpeakerLabels }),
          // Optimize for telephony audio quality
          ChannelIdentification: false,
          ShowAlternatives: true,
          MaxAlternatives: 2,
        },
        // Add metadata for tracking
        Tags: [
          { Key: 'SessionId', Value: sessionId },
          { Key: 'CallSid', Value: callSid || 'unknown' },
          { Key: 'CreatedBy', Value: 'PromptCallAI' },
        ],
      });

      await this.client.send(command);
      console.log(`Transcription job started successfully: ${jobName}`);

      return jobName;
    } catch (error) {
      console.error('Error starting transcription job:', error);
      throw new Error(`Failed to start transcription job: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Poll transcription job status until completion
   */
  async pollTranscriptionJob(
    jobName: string,
    maxWaitTimeMs: number = 60000, // 1 minute default
    pollIntervalMs: number = 2000 // 2 seconds default
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTimeMs) {
      try {
        const result = await this.getTranscriptionJob(jobName);

        if (result.status === TranscriptionJobStatus.COMPLETED) {
          console.log(`Transcription job completed: ${jobName}`);
          return result;
        } else if (result.status === TranscriptionJobStatus.FAILED) {
          throw new Error(`Transcription job failed: ${result.jobName}`);
        }

        // Job is still in progress, wait before polling again
        console.log(`Transcription job ${jobName} status: ${result.status}, waiting...`);
        await this.sleep(pollIntervalMs);
      } catch (error) {
        console.error('Error polling transcription job:', error);
        throw error;
      }
    }

    throw new Error(`Transcription job ${jobName} timed out after ${maxWaitTimeMs}ms`);
  }

  /**
   * Get transcription job status and results
   */
  async getTranscriptionJob(jobName: string): Promise<TranscriptionResult> {
    try {
      const command = new GetTranscriptionJobCommand({
        TranscriptionJobName: jobName,
      });

      const response = await this.client.send(command);
      const job = response.TranscriptionJob;

      if (!job) {
        throw new Error(`Transcription job not found: ${jobName}`);
      }

      const result: TranscriptionResult = {
        text: '',
        confidence: 0,
        jobName,
        status: job.TranscriptionJobStatus || TranscriptionJobStatus.FAILED,
        // Duration is not directly available in the job object, will be extracted from transcript if needed
      };

      // If job is completed, extract transcript and confidence
      if (job.TranscriptionJobStatus === TranscriptionJobStatus.COMPLETED && job.Transcript?.TranscriptFileUri) {
        const transcriptData = await this.fetchTranscriptFile(job.Transcript.TranscriptFileUri);
        result.text = transcriptData.text;
        result.confidence = transcriptData.confidence;
      }

      return result;
    } catch (error) {
      console.error('Error getting transcription job:', error);
      throw new Error(`Failed to get transcription job: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch and parse transcript file from S3
   */
  private async fetchTranscriptFile(transcriptUri: string): Promise<{ text: string; confidence: number }> {
    try {
      console.log(`Fetching transcript file: ${transcriptUri}`);
      
      const response = await fetch(transcriptUri);
      if (!response.ok) {
        throw new Error(`Failed to fetch transcript: ${response.status} ${response.statusText}`);
      }

      const transcriptJson = await response.json() as any;
      
      // Extract text and confidence from Transcribe JSON format
      const results = transcriptJson.results;
      if (!results || !results.transcripts || results.transcripts.length === 0) {
        return { text: '', confidence: 0 };
      }

      const transcript = results.transcripts[0].transcript || '';
      
      // Calculate average confidence from all items
      let totalConfidence = 0;
      let itemCount = 0;
      
      if (results.items) {
        for (const item of results.items) {
          if (item.alternatives && item.alternatives.length > 0 && item.alternatives[0].confidence) {
            totalConfidence += parseFloat(item.alternatives[0].confidence);
            itemCount++;
          }
        }
      }
      
      const averageConfidence = itemCount > 0 ? totalConfidence / itemCount : 0;
      
      console.log(`Transcript extracted: "${transcript}" (confidence: ${averageConfidence.toFixed(3)})`);
      
      return {
        text: transcript.trim(),
        confidence: averageConfidence,
      };
    } catch (error) {
      console.error('Error fetching transcript file:', error);
      throw new Error(`Failed to fetch transcript file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Handle low confidence transcription with retry logic
   */
  async handleLowConfidence(
    s3AudioUrl: string,
    sessionId: string,
    originalConfidence: number,
    callSid?: string
  ): Promise<TranscriptionResult> {
    console.log(`Handling low confidence transcription (${originalConfidence.toFixed(3)}) for session: ${sessionId}`);

    try {
      // Create enhanced configuration for retry
      const enhancedConfig: TranscribeConfig = {
        ...this.config,
        // Enable speaker labels for better accuracy with proper configuration
        enableSpeakerLabels: true,
        maxSpeakerLabels: 2, // Set to 2 for caller and system (minimum required)
      };

      // Create temporary enhanced service
      const enhancedService = new TranscribeService(enhancedConfig);
      
      // Retry transcription with enhanced settings
      const jobName = await enhancedService.transcribeAudio(s3AudioUrl, sessionId, callSid);
      const result = await enhancedService.pollTranscriptionJob(jobName);

      console.log(`Enhanced transcription completed with confidence: ${result.confidence.toFixed(3)}`);
      
      return result;
    } catch (error) {
      console.error('Error in enhanced transcription retry:', error);
      throw error;
    }
  }

  /**
   * Validate transcription confidence against threshold
   */
  isConfidenceAcceptable(confidence: number, threshold: number = 0.85): boolean {
    return confidence >= threshold;
  }

  /**
   * Get optimal transcription configuration for telephony audio
   */
  static getTelephonyConfig(): TranscribeConfig {
    return {
      languageCode: LanguageCode.EN_US,
      mediaFormat: MediaFormat.WAV,
      sampleRateHertz: 8000, // Standard telephony
      enableSpeakerLabels: false, // Usually not needed for single caller
      maxSpeakerLabels: 2, // Minimum required when speaker labels are enabled
    };
  }

  /**
   * Sleep utility for polling
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Health check for Transcribe service
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Try to list transcription jobs to test connectivity
      const command = new GetTranscriptionJobCommand({
        TranscriptionJobName: 'non-existent-job-health-check',
      });

      await this.client.send(command);
      return true;
    } catch (error) {
      // We expect this to fail with "not found" - that's a successful health check
      if (error instanceof Error && error.message.includes('not found')) {
        return true;
      }
      console.error('Transcribe health check failed:', error);
      return false;
    }
  }
}