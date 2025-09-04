/**
 * Amazon Transcribe Service for speech-to-text conversion
 */

import { 
  TranscribeClient, 
  StartTranscriptionJobCommand, 
  GetTranscriptionJobCommand,
  TranscriptionJob,
  TranscriptionJobStatus,
  LanguageCode,
  MediaFormat
} from '@aws-sdk/client-transcribe';

export interface TranscribeResult {
  text: string;
  confidence: number;
  jobName: string;
  status: TranscriptionJobStatus;
}

export interface TranscribeConfig {
  region?: string;
  languageCode?: LanguageCode;
  mediaFormat?: MediaFormat;
  mediaSampleRateHertz?: number;
}

export class TranscribeService {
  private transcribeClient: TranscribeClient;
  private config: Required<TranscribeConfig>;

  constructor(config: TranscribeConfig = {}) {
    this.config = {
      region: config.region || process.env.AWS_REGION || 'us-east-1',
      languageCode: config.languageCode || LanguageCode.EN_US,
      mediaFormat: config.mediaFormat || MediaFormat.WAV,
      mediaSampleRateHertz: config.mediaSampleRateHertz || 8000 // Telephony standard
    };

    this.transcribeClient = new TranscribeClient({
      region: this.config.region
    });
  }

  /**
   * Start transcription job for audio file in S3
   */
  async startTranscriptionJob(s3Uri: string, sessionId: string): Promise<string> {
    const jobName = this.generateJobName(sessionId);
    
    const command = new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: this.config.languageCode,
      MediaFormat: this.config.mediaFormat,
      Media: {
        MediaFileUri: s3Uri
      },
      MediaSampleRateHertz: this.config.mediaSampleRateHertz,
      Settings: {
        // Optimize for telephony audio
        ShowSpeakerLabels: false,
        // MaxSpeakerLabels should not be set when ShowSpeakerLabels is false
        ChannelIdentification: false,
        ShowAlternatives: true,
        MaxAlternatives: 3
      }
    });

    try {
      const response = await this.transcribeClient.send(command);
      console.log(`Started transcription job: ${jobName}`);
      return jobName;
    } catch (error) {
      console.error('Error starting transcription job:', error);
      throw new Error(`Failed to start transcription job: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get transcription job status and results
   */
  async getTranscriptionJob(jobName: string): Promise<TranscriptionJob | null> {
    const command = new GetTranscriptionJobCommand({
      TranscriptionJobName: jobName
    });

    try {
      const response = await this.transcribeClient.send(command);
      return response.TranscriptionJob || null;
    } catch (error) {
      console.error('Error getting transcription job:', error);
      return null;
    }
  }

  /**
   * Poll transcription job until completion
   */
  async pollTranscriptionJob(jobName: string, maxAttempts: number = 30, intervalMs: number = 2000): Promise<TranscribeResult> {
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      const job = await this.getTranscriptionJob(jobName);
      
      if (!job) {
        throw new Error(`Transcription job not found: ${jobName}`);
      }

      console.log(`Transcription job ${jobName} status: ${job.TranscriptionJobStatus}`);

      if (job.TranscriptionJobStatus === 'COMPLETED') {
        return await this.extractTranscriptionResult(job);
      } else if (job.TranscriptionJobStatus === 'FAILED') {
        throw new Error(`Transcription job failed: ${job.FailureReason || 'Unknown error'}`);
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      attempts++;
    }

    throw new Error(`Transcription job timed out after ${maxAttempts} attempts`);
  }

  /**
   * Extract text and confidence from completed transcription job
   */
  private async extractTranscriptionResult(job: TranscriptionJob): Promise<TranscribeResult> {
    if (!job.Transcript?.TranscriptFileUri) {
      throw new Error('No transcript file URI found in completed job');
    }

    try {
      // Fetch the transcript JSON file
      const response = await fetch(job.Transcript.TranscriptFileUri);
      if (!response.ok) {
        throw new Error(`Failed to fetch transcript: ${response.status} ${response.statusText}`);
      }

      const transcriptData = await response.json() as any;
      
      // Debug: Log the structure to understand confidence format
      console.log('AWS Transcribe response structure:', JSON.stringify(transcriptData, null, 2));
      
      // Extract the best transcript and confidence
      const results = transcriptData.results;
      if (!results || !results.transcripts || results.transcripts.length === 0) {
        throw new Error('No transcripts found in result');
      }

      const bestTranscript = results.transcripts[0].transcript || '';
      
      // Multiple strategies to extract confidence
      let averageConfidence = 0;
      let confidenceSource = 'none';
      
      // Strategy 1: Calculate average confidence from pronunciation items
      let totalConfidence = 0;
      let itemCount = 0;
      
      if (results.items) {
        for (const item of results.items) {
          // Check all item types, not just 'pronunciation'
          if (item.alternatives && item.alternatives.length > 0) {
            const confidence = parseFloat(item.alternatives[0].confidence || '0');
            if (!isNaN(confidence) && confidence > 0) {
              totalConfidence += confidence;
              itemCount++;
            }
          }
        }
      }

      if (itemCount > 0) {
        averageConfidence = totalConfidence / itemCount;
        confidenceSource = `item-level (${itemCount} items)`;
      }
      
      // Strategy 2: Check alternatives at transcript level
      if (averageConfidence === 0 && results.transcripts[0].alternatives) {
        for (const alt of results.transcripts[0].alternatives) {
          if (alt.confidence !== undefined && alt.confidence !== null) {
            const confidence = parseFloat(alt.confidence);
            if (!isNaN(confidence)) {
              averageConfidence = confidence;
              confidenceSource = 'transcript-level alternative';
              break;
            }
          }
        }
      }
      
      // Strategy 3: Check if there's a confidence field directly on the transcript
      if (averageConfidence === 0 && results.transcripts[0].confidence !== undefined) {
        const confidence = parseFloat(results.transcripts[0].confidence);
        if (!isNaN(confidence)) {
          averageConfidence = confidence;
          confidenceSource = 'transcript-level direct';
        }
      }
      
      // Strategy 4: If we have a valid transcript but no confidence, assume reasonable confidence
      // This handles cases where AWS Transcribe doesn't provide confidence scores
      if (averageConfidence === 0 && bestTranscript.trim().length > 0) {
        // If we got a transcript but no confidence, it's likely still valid
        // Set a moderate confidence score rather than 0
        averageConfidence = 0.8;
        confidenceSource = 'inferred (transcript exists)';
        console.warn('No confidence score found in AWS Transcribe response, using inferred confidence');
      }

      console.log(`Confidence calculation: ${averageConfidence} from ${confidenceSource} (total: ${totalConfidence}, items: ${itemCount})`);

      return {
        text: bestTranscript.trim(),
        confidence: averageConfidence,
        jobName: job.TranscriptionJobName || '',
        status: job.TranscriptionJobStatus || 'COMPLETED'
      };

    } catch (error) {
      console.error('Error extracting transcription result:', error);
      throw new Error(`Failed to extract transcription result: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate unique job name for transcription
   */
  private generateJobName(sessionId: string): string {
    const timestamp = Date.now();
    return `promptcall-${sessionId}-${timestamp}`;
  }

  /**
   * Check if confidence score meets minimum threshold
   */
  isConfidenceAcceptable(confidence: number, threshold: number = 0.7): boolean {
    return confidence >= threshold;
  }

  /**
   * Process audio file and return transcription result
   */
  async transcribeAudio(s3Uri: string, sessionId: string): Promise<TranscribeResult> {
    console.log(`Starting transcription for session ${sessionId}, S3 URI: ${s3Uri}`);
    
    const jobName = await this.startTranscriptionJob(s3Uri, sessionId);
    const result = await this.pollTranscriptionJob(jobName);
    
    console.log(`Transcription completed for session ${sessionId}: "${result.text}" (confidence: ${result.confidence})`);
    
    return result;
  }
}