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
   * Upload audio file to S3 with metadata
   */
  async uploadAudioWithMetadata(
    audioBuffer: Buffer, 
    key: string, 
    metadata: Record<string, string>,
    contentType: string = 'audio/wav'
  ): Promise<S3UploadResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: audioBuffer,
      ContentType: contentType,
      Metadata: metadata
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
    try {
      // Prepare authentication for Twilio URLs
      const headers: Record<string, string> = {};
      
      // Add Twilio authentication if this is a Twilio URL
      if (url.includes('api.twilio.com')) {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        
        if (accountSid && authToken) {
          const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
          headers['Authorization'] = `Basic ${credentials}`;
          console.log('Added Twilio authentication for recording URL');
        } else {
          console.warn('Twilio credentials not found in environment variables');
        }
      }
      
      // Fetch audio data from Twilio URL with authentication
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`Failed to fetch audio from URL: ${response.status} ${response.statusText}`);
      }
      
      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const timestamp = Date.now();
      const key = this.generateAudioKey(sessionId, timestamp, 'input');
      
      // Add metadata to the upload
      const result = await this.uploadAudioWithMetadata(audioBuffer, key, {
        sessionId,
        callSid: callSid || 'unknown',
        sourceUrl: url,
        uploadTimestamp: timestamp.toString(),
        audioType: 'user-input'
      });
      
      console.log(`Successfully uploaded audio from Twilio URL to S3: ${key}`);
      return result;
      
    } catch (error) {
      console.error('Error uploading audio from URL:', error);
      throw new Error(`Failed to upload audio from URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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

  /**
   * Get S3 URI for Transcribe service
   */
  getS3Uri(key: string): string {
    return `s3://${this.bucketName}/${key}`;
  }

  /**
   * Get public HTTPS URL for audio file
   */
  getPublicUrl(key: string): string {
    return `https://${this.bucketName}.s3.amazonaws.com/${key}`;
  }
}