import { S3Service } from '../src/services/s3-service';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');

// Mock fetch for testing audio download
global.fetch = jest.fn();

describe('S3Service', () => {
  let s3Service: S3Service;
  const mockBucketName = 'test-audio-bucket';

  beforeEach(() => {
    s3Service = new S3Service(mockBucketName);
    jest.clearAllMocks();
  });

  describe('generateAudioKey', () => {
    it('should generate proper S3 key with session and call ID', () => {
      const sessionId = 'test-session-123';
      const callSid = 'test-call-456';
      
      const key = s3Service.generateAudioKey(sessionId, callSid);
      
      expect(key).toMatch(/^audio\/test-session-123\/test-call-456-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.wav$/);
    });

    it('should generate proper S3 key with suffix', () => {
      const sessionId = 'test-session-123';
      const callSid = 'test-call-456';
      const suffix = 'transcribed';
      
      const key = s3Service.generateAudioKey(sessionId, callSid, suffix);
      
      expect(key).toMatch(/^audio\/test-session-123\/test-call-456-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-transcribed\.wav$/);
    });
  });

  describe('uploadAudioFromUrl', () => {
    it('should download and upload audio file successfully', async () => {
      const mockAudioData = new ArrayBuffer(1024);
      const mockResponse = {
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(mockAudioData)
      };
      
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const recordingUrl = 'https://api.twilio.com/recording/test.wav';
      const sessionId = 'test-session-123';
      const callSid = 'test-call-456';

      const result = await s3Service.uploadAudioFromUrl(recordingUrl, sessionId, callSid);

      expect(result.s3Key).toMatch(/^audio\/test-session-123\/test-call-456-/);
      expect(result.s3Url).toBe(`s3://${mockBucketName}/${result.s3Key}`);
      expect(result.metadata.sessionId).toBe(sessionId);
      expect(result.metadata.callSid).toBe(callSid);
      expect(result.metadata.recordingUrl).toBe(recordingUrl);
      expect(result.metadata.fileSize).toBe(1024);
    });

    it('should handle download failure', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found'
      };
      
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const recordingUrl = 'https://api.twilio.com/recording/test.wav';
      const sessionId = 'test-session-123';
      const callSid = 'test-call-456';

      await expect(s3Service.uploadAudioFromUrl(recordingUrl, sessionId, callSid))
        .rejects.toThrow('Failed to upload audio to S3: Failed to download audio: 404 Not Found');
    });

    it('should handle network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const recordingUrl = 'https://api.twilio.com/recording/test.wav';
      const sessionId = 'test-session-123';
      const callSid = 'test-call-456';

      await expect(s3Service.uploadAudioFromUrl(recordingUrl, sessionId, callSid))
        .rejects.toThrow('Failed to upload audio to S3: Network error');
    });
  });

  describe('Audio file metadata', () => {
    it('should include proper metadata in upload result', async () => {
      const mockAudioData = new ArrayBuffer(2048);
      const mockResponse = {
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(mockAudioData)
      };
      
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const recordingUrl = 'https://api.twilio.com/recording/test.wav';
      const sessionId = 'test-session-123';
      const callSid = 'test-call-456';

      const result = await s3Service.uploadAudioFromUrl(recordingUrl, sessionId, callSid);

      expect(result.metadata).toEqual({
        sessionId,
        callSid,
        recordingUrl,
        uploadedAt: expect.any(Number),
        fileSize: 2048
      });

      // Check that uploadedAt is recent (within last 5 seconds)
      const now = Date.now();
      expect(result.metadata.uploadedAt).toBeGreaterThan(now - 5000);
      expect(result.metadata.uploadedAt).toBeLessThanOrEqual(now);
    });
  });
});