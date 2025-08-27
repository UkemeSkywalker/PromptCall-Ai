import { DynamoSessionManager } from '../../src/services/dynamo-session-manager';
import { S3Service } from '../../src/services/s3-service';
import { createCallSession, createConversationEntry } from '../../src/types/session';

// Mock AWS services for integration testing
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');

// Mock fetch for testing
global.fetch = jest.fn();

describe('Audio Recording Integration', () => {
  let sessionManager: DynamoSessionManager;
  let s3Service: S3Service;

  beforeEach(() => {
    sessionManager = new DynamoSessionManager({
      tableName: 'test-sessions'
    });
    s3Service = new S3Service('test-audio-bucket');
    jest.clearAllMocks();
  });

  describe('Complete audio recording workflow', () => {
    it('should handle complete audio recording and storage workflow', async () => {
      // Mock successful audio download
      const mockAudioData = new ArrayBuffer(2048);
      const mockResponse = {
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(mockAudioData)
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      // Create a test session
      const callSid = 'test-call-123';
      const phoneNumber = '+1234567890';
      const session = createCallSession(callSid, phoneNumber);

      // Mock session manager methods
      const mockGetSessionByCallSid = jest.fn().mockResolvedValue(session);
      const mockAppendConversationEntry = jest.fn().mockResolvedValue(undefined);
      const mockUpdateConversationEntryWithAudio = jest.fn().mockResolvedValue(undefined);

      sessionManager.getSessionByCallSid = mockGetSessionByCallSid;
      sessionManager.appendConversationEntry = mockAppendConversationEntry;
      sessionManager.updateConversationEntryWithAudio = mockUpdateConversationEntryWithAudio;

      // Simulate the audio recording workflow
      const recordingUrl = 'https://api.twilio.com/recording/test.wav';
      const recordingDuration = '15.5';

      // 1. Create conversation entry for user audio
      const userEntry = createConversationEntry(
        'user',
        'Audio recording received - pending transcription',
        recordingUrl
      );

      // 2. Add conversation entry to session
      await sessionManager.appendConversationEntry(session.sessionId, userEntry);

      // 3. Upload audio to S3
      const uploadResult = await s3Service.uploadAudioFromUrl(
        recordingUrl,
        session.sessionId,
        callSid
      );

      // 4. Update conversation entry with audio metadata
      await sessionManager.updateConversationEntryWithAudio(
        session.sessionId,
        userEntry.id,
        {
          originalUrl: recordingUrl,
          s3Key: uploadResult.s3Key,
          s3Url: uploadResult.s3Url,
          fileSize: uploadResult.metadata.fileSize,
          duration: parseFloat(recordingDuration),
          uploadedAt: uploadResult.metadata.uploadedAt
        }
      );

      // Verify the workflow
      expect(mockAppendConversationEntry).toHaveBeenCalledWith(
        session.sessionId,
        expect.objectContaining({
          type: 'user',
          text: 'Audio recording received - pending transcription',
          audioUrl: recordingUrl
        })
      );

      expect(mockUpdateConversationEntryWithAudio).toHaveBeenCalledWith(
        session.sessionId,
        userEntry.id,
        expect.objectContaining({
          originalUrl: recordingUrl,
          s3Key: expect.stringMatching(/^audio\/.*\.wav$/),
          s3Url: expect.stringMatching(/^s3:\/\/test-audio-bucket\/audio\/.*\.wav$/),
          fileSize: 2048,
          duration: 15.5,
          uploadedAt: expect.any(Number)
        })
      );

      expect(uploadResult.s3Key).toMatch(/^audio\/.*\/test-call-123-.*\.wav$/);
      expect(uploadResult.metadata.sessionId).toBe(session.sessionId);
      expect(uploadResult.metadata.callSid).toBe(callSid);
    });

    it('should handle S3 upload failure gracefully', async () => {
      // Mock failed audio download
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const recordingUrl = 'https://api.twilio.com/recording/test.wav';
      const sessionId = 'test-session-123';
      const callSid = 'test-call-456';

      // Verify that S3 upload failure is handled properly
      await expect(s3Service.uploadAudioFromUrl(recordingUrl, sessionId, callSid))
        .rejects.toThrow('Failed to upload audio to S3: Failed to download audio: 500 Internal Server Error');
    });
  });

  describe('Audio file organization', () => {
    it('should organize audio files properly in S3', () => {
      const sessionId = 'session-abc123';
      const callSid = 'call-def456';
      
      const key1 = s3Service.generateAudioKey(sessionId, callSid);
      const key2 = s3Service.generateAudioKey(sessionId, callSid, 'processed');
      
      // Both keys should be under the same session directory
      expect(key1).toMatch(/^audio\/session-abc123\/call-def456-.*\.wav$/);
      expect(key2).toMatch(/^audio\/session-abc123\/call-def456-.*-processed\.wav$/);
      
      // Keys should be different (due to timestamp)
      expect(key1).not.toBe(key2);
    });
  });
});