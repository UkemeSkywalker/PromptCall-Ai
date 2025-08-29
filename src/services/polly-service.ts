/**
 * Amazon Polly Text-to-Speech Service
 * Handles conversion of AI responses to natural speech audio
 */

import { 
  PollyClient, 
  SynthesizeSpeechCommand, 
  SynthesizeSpeechInput,
  OutputFormat,
  VoiceId,
  Engine
} from '@aws-sdk/client-polly';
import { S3Service } from './s3-service';

export interface PollyConfig {
  region: string;
  voiceId: VoiceId;
  engine: Engine;
  outputFormat: OutputFormat;
  sampleRate: string;
}

export interface SpeechSynthesisResult {
  audioUrl: string;
  audioKey: string;
  playbackUrl?: string; // Presigned URL for telephony playback
  duration?: number;
  text: string;
  ssmlText?: string;
}

export interface SSMLOptions {
  speechRate?: 'x-slow' | 'slow' | 'medium' | 'fast' | 'x-fast';
  volume?: 'silent' | 'x-soft' | 'soft' | 'medium' | 'loud' | 'x-loud';
  addPauses?: boolean;
  emphasizeImportant?: boolean;
  telephonyOptimized?: boolean;
}

export class PollyService {
  private pollyClient: PollyClient;
  private s3Service: S3Service;
  private config: PollyConfig;

  constructor(config: PollyConfig, s3Service: S3Service) {
    this.config = config;
    this.s3Service = s3Service;
    this.pollyClient = new PollyClient({ 
      region: config.region 
    });
  }

  /**
   * Convert text to speech using Amazon Polly with optional SSML formatting
   */
  async synthesizeSpeech(
    text: string, 
    sessionId: string,
    options?: Partial<PollyConfig>,
    ssmlOptions?: SSMLOptions
  ): Promise<SpeechSynthesisResult> {
    try {
      // Merge options with default config
      const synthesisConfig = { ...this.config, ...options };
      
      // Apply SSML formatting if requested
      let processedText = text;
      let textType: 'text' | 'ssml' = 'text';
      
      if (ssmlOptions) {
        processedText = this.formatWithSSML(text, ssmlOptions);
        textType = 'ssml';
      }
      
      // Prepare Polly synthesis parameters
      const params: SynthesizeSpeechInput = {
        Text: processedText,
        TextType: textType,
        VoiceId: synthesisConfig.voiceId,
        OutputFormat: synthesisConfig.outputFormat,
        Engine: synthesisConfig.engine,
        SampleRate: synthesisConfig.sampleRate
      };

      console.log('Synthesizing speech with Polly:', {
        textLength: text.length,
        voiceId: synthesisConfig.voiceId,
        outputFormat: synthesisConfig.outputFormat
      });

      // Call Polly API
      const command = new SynthesizeSpeechCommand(params);
      const response = await this.pollyClient.send(command);

      if (!response.AudioStream) {
        throw new Error('No audio stream received from Polly');
      }

      // Convert audio stream to buffer
      const audioBuffer = await this.streamToBuffer(response.AudioStream);
      
      // Generate unique key for audio file
      const timestamp = Date.now();
      const audioKey = `speech/${sessionId}/${timestamp}.${this.getFileExtension(synthesisConfig.outputFormat)}`;
      
      // Upload to S3
      const audioUrl = await this.s3Service.uploadAudioFile(
        audioBuffer,
        audioKey
      );

      // Generate presigned URL for telephony playback
      const playbackUrl = await this.s3Service.getTelephonyPlaybackUrl(audioKey);

      console.log('Speech synthesis completed:', {
        audioKey,
        audioUrl,
        playbackUrl,
        audioSize: audioBuffer.length
      });

      return {
        audioUrl,
        audioKey,
        playbackUrl,
        text,
        ssmlText: textType === 'ssml' ? processedText : undefined,
        duration: this.estimateDuration(text)
      };

    } catch (error) {
      console.error('Error synthesizing speech:', error);
      throw new Error(`Speech synthesis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Format text with SSML tags for enhanced speech synthesis
   */
  formatWithSSML(text: string, options: SSMLOptions): string {
    let ssmlText = text;
    
    // Apply telephony optimization if requested
    if (options.telephonyOptimized) {
      const telephonyOptions = this.getTelephonySSMLOptions();
      options = { ...telephonyOptions, ...options };
    }
    
    // Add emphasis to important words (words in caps or with exclamation)
    if (options.emphasizeImportant) {
      ssmlText = ssmlText.replace(/\b[A-Z]{2,}\b/g, '<emphasis level="strong">$&</emphasis>');
      ssmlText = ssmlText.replace(/(\w+)!/g, '<emphasis level="moderate">$1</emphasis>!');
    }
    
    // Add pauses for better comprehension
    if (options.addPauses) {
      ssmlText = ssmlText.replace(/\. /g, '. <break time="500ms"/>');
      ssmlText = ssmlText.replace(/\? /g, '? <break time="500ms"/>');
      ssmlText = ssmlText.replace(/! /g, '! <break time="300ms"/>');
      ssmlText = ssmlText.replace(/,/g, ',<break time="200ms"/>');
    }
    
    // Wrap in prosody tags for speech rate and volume
    if (options.speechRate || options.volume) {
      const prosodyAttrs = [];
      if (options.speechRate) prosodyAttrs.push(`rate="${options.speechRate}"`);
      if (options.volume) prosodyAttrs.push(`volume="${options.volume}"`);
      
      ssmlText = `<prosody ${prosodyAttrs.join(' ')}>${ssmlText}</prosody>`;
    }
    
    // Wrap in SSML speak tags
    ssmlText = `<speak>${ssmlText}</speak>`;
    
    return ssmlText;
  }

  /**
   * Get SSML options optimized for telephony
   */
  getTelephonySSMLOptions(): SSMLOptions {
    return {
      speechRate: 'medium',
      volume: 'loud',
      addPauses: true,
      emphasizeImportant: false, // Keep it simple for phone calls
      telephonyOptimized: true
    };
  }

  /**
   * Optimize text for phone call clarity (pre-SSML processing)
   */
  optimizeForTelephony(text: string): string {
    let optimized = text;
    
    // Replace common abbreviations with full words
    optimized = optimized.replace(/\bDr\./g, 'Doctor');
    optimized = optimized.replace(/\bMr\./g, 'Mister');
    optimized = optimized.replace(/\bMrs\./g, 'Missus');
    optimized = optimized.replace(/\bMs\./g, 'Miss');
    optimized = optimized.replace(/\betc\./g, 'etcetera');
    optimized = optimized.replace(/\be\.g\./g, 'for example');
    optimized = optimized.replace(/\bi\.e\./g, 'that is');
    
    // Replace numbers with words for better pronunciation
    optimized = optimized.replace(/\b(\d{1,2})\b/g, (match, num) => {
      const numbers = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
                      'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
      const n = parseInt(num);
      return n < 20 ? numbers[n] : match;
    });
    
    // Add pronunciation hints for common technical terms
    optimized = optimized.replace(/\bAPI\b/g, '<phoneme alphabet="ipa" ph="eɪ.pi.aɪ">API</phoneme>');
    optimized = optimized.replace(/\bURL\b/g, '<phoneme alphabet="ipa" ph="jʊ.ɑr.ɛl">URL</phoneme>');
    optimized = optimized.replace(/\bAI\b/g, '<phoneme alphabet="ipa" ph="eɪ.aɪ">AI</phoneme>');
    
    return optimized;
  }

  /**
   * Get optimal voice for telephony
   */
  getOptimalVoice(): VoiceId {
    // Joanna and Matthew are optimized for telephony
    return VoiceId.Joanna;
  }

  /**
   * Get telephony-optimized configuration
   */
  getTelephonyConfig(): Partial<PollyConfig> {
    return {
      voiceId: VoiceId.Joanna,
      engine: Engine.NEURAL,
      outputFormat: OutputFormat.MP3,
      sampleRate: '8000' // 8kHz is standard for telephony
    };
  }

  /**
   * Estimate speech duration based on text length
   * Average speaking rate is ~150 words per minute
   */
  private estimateDuration(text: string): number {
    const wordCount = text.split(/\s+/).length;
    const wordsPerMinute = 150;
    return Math.ceil((wordCount / wordsPerMinute) * 60); // Duration in seconds
  }

  /**
   * Get file extension for output format
   */
  private getFileExtension(format: OutputFormat): string {
    switch (format) {
      case OutputFormat.MP3:
        return 'mp3';
      case OutputFormat.OGG_VORBIS:
        return 'ogg';
      case OutputFormat.PCM:
        return 'pcm';
      default:
        return 'mp3';
    }
  }

  /**
   * Clean up old speech synthesis files for a session
   */
  async cleanupSessionAudio(sessionId: string): Promise<void> {
    try {
      // This would typically be handled by S3 lifecycle policies
      // But we can implement manual cleanup if needed
      console.log(`Audio cleanup for session ${sessionId} handled by S3 lifecycle policies`);
    } catch (error) {
      console.error('Error cleaning up session audio:', error);
      // Don't throw - cleanup failures shouldn't break the main flow
    }
  }

  /**
   * Get audio file metadata
   */
  async getAudioMetadata(audioKey: string): Promise<any> {
    try {
      // This could be extended to get file metadata from S3
      return {
        key: audioKey,
        type: 'speech_synthesis',
        createdAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting audio metadata:', error);
      throw new Error(`Failed to get audio metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Convert readable stream to buffer
   */
  private async streamToBuffer(stream: any): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }
}

/**
 * Default Polly configuration optimized for telephony
 */
export const DEFAULT_POLLY_CONFIG: PollyConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  voiceId: VoiceId.Joanna,
  engine: Engine.NEURAL,
  outputFormat: OutputFormat.MP3,
  sampleRate: '8000'
};