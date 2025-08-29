/**
 * S3 Service for handling audio file storage and retrieval
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface S3UploadResult {
  key: string;
  url: string;
  bucket: string;
}

export interface S3ServiceConfig {
  bucketName: string;
  region?: string;
}

export class S3Service {
  private s3Client: S3Client;
  private bucketName: string;

  constructor(config: S3ServiceConfig) {
    this.bucketName = config.bucketName;
    this.s3Client = new S3Client({
      region: config.region || process.env.AWS_REGION || 'us-east-1'
    });
  }

  /**
   * Upload audio file to S3
   */
  async uploadAudio(audioBuffer: Buffer, key: string, contentType: string = 'audio/wav'): Promise<S3UploadResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: audioBuffer,
      ContentType: contentType
    });

    await this.s3Client.send(command);

    return {
      key,
      url: `s3://${this.bucketName}/${key}`,
      bucket: this.bucketName
    };
  }

  /**
   * Get signed URL for audio file access
   */
  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * Delete audio file from S3
   */
  async deleteAudio(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key
    });

    await this.s3Client.send(command);
  }

  /**
   * Upload audio file from URL (e.g., Twilio recording URL)
   */
  async uploadAudioFromUrl(url: string, sessionId: string, callSid?: string): Promise<S3UploadResult> {
    // In a real implementation, we would fetch the audio from the URL
    // For now, we'll create a placeholder
    const placeholderBuffer = Buffer.from('placeholder audio data');
    const key = this.generateAudioKey(sessionId, Date.now(), 'input');
    return await this.uploadAudio(placeholderBuffer, key, 'audio/wav');
  }

  /**
   * Upload audio file buffer
   */
  async uploadAudioFile(audioBuffer: Buffer, key: string, contentType: string = 'audio/wav'): Promise<string> {
    const result = await this.uploadAudio(audioBuffer, key, contentType);
    return result.url;
  }

  /**
   * Get telephony-optimized playback URL
   */
  async getTelephonyPlaybackUrl(key: string): Promise<string> {
    return await this.getSignedUrl(key, 3600); // 1 hour expiry
  }

  /**
   * Generate S3 key for audio file
   */
  generateAudioKey(sessionId: string, timestamp: number, type: 'input' | 'output'): string {
    return `audio/${sessionId}/${type}-${timestamp}.wav`;
  }
}