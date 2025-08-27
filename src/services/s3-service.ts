import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface AudioFileMetadata {
  sessionId: string;
  callSid: string;
  recordingUrl: string;
  uploadedAt: number;
  fileSize?: number;
  duration?: number;
}

export class S3Service {
  private s3Client: S3Client;
  private bucketName: string;

  constructor(bucketName: string, region?: string) {
    this.bucketName = bucketName;
    this.s3Client = new S3Client({ 
      region: region || process.env.AWS_REGION || 'us-east-1' 
    });
  }

  /**
   * Download audio file from Twilio and upload to S3
   */
  async uploadAudioFromUrl(
    recordingUrl: string, 
    sessionId: string, 
    callSid: string
  ): Promise<{ s3Key: string; s3Url: string; metadata: AudioFileMetadata }> {
    try {
      // Download audio file from Twilio with authentication
      console.log(`Downloading audio from Twilio: ${recordingUrl}`);
      
      // Create basic auth header for Twilio
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      
      if (!accountSid || !authToken) {
        throw new Error('Missing Twilio credentials: TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
      }
      
      const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      
      const response = await fetch(recordingUrl, {
        headers: {
          'Authorization': authHeader
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to download audio: ${response.status} ${response.statusText}`);
      }

      const audioBuffer = await response.arrayBuffer();
      const audioData = new Uint8Array(audioBuffer);
      
      // Generate S3 key with proper organization
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const s3Key = `audio/${sessionId}/${callSid}-${timestamp}.wav`;
      
      // Prepare metadata
      const metadata: AudioFileMetadata = {
        sessionId,
        callSid,
        recordingUrl,
        uploadedAt: Date.now(),
        fileSize: audioData.length
      };

      // Upload to S3
      const putCommand = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: audioData,
        ContentType: 'audio/wav',
        Metadata: {
          sessionId,
          callSid,
          originalUrl: recordingUrl,
          uploadedAt: metadata.uploadedAt.toString()
        }
      });

      await this.s3Client.send(putCommand);
      
      // Generate S3 URL
      const s3Url = `s3://${this.bucketName}/${s3Key}`;
      
      console.log(`Audio uploaded to S3: ${s3Url}`);
      
      return {
        s3Key,
        s3Url,
        metadata
      };
    } catch (error) {
      console.error('Error uploading audio to S3:', error);
      throw new Error(`Failed to upload audio to S3: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get a presigned URL for accessing an audio file
   */
  async getPresignedUrl(s3Key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key
      });

      const presignedUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
      return presignedUrl;
    } catch (error) {
      console.error('Error generating presigned URL:', error);
      throw new Error(`Failed to generate presigned URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete an audio file from S3
   */
  async deleteAudioFile(s3Key: string): Promise<void> {
    try {
      const deleteCommand = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key
      });

      await this.s3Client.send(deleteCommand);
      console.log(`Deleted audio file from S3: ${s3Key}`);
    } catch (error) {
      console.error('Error deleting audio file from S3:', error);
      throw new Error(`Failed to delete audio file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate S3 key for audio files with proper naming convention
   */
  generateAudioKey(sessionId: string, callSid: string, suffix?: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const suffixPart = suffix ? `-${suffix}` : '';
    return `audio/${sessionId}/${callSid}-${timestamp}${suffixPart}.wav`;
  }
}