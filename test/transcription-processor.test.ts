import { TranscriptionProcessor, TranscriptionProcessingConfig } from '../src/services/transcription-processor';
import { TranscribeService, TranscriptionResult } from '../src/services/transcribe-service';
import { DynamoSessionManager } from '../src/services/dynamo-session-manager';
import { TranscriptionJobStatus } from '@aws-sdk/client-transcribe';

// Mock the services
jest.mock('../src/services/transcribe-service');
jest.mock('../src/services/dynamo-session-manager');

describe('TranscriptionProcessor', () => {
  let processor: TranscriptionProcessor;
  let mockTranscribeService: jest.Mocked<TranscribeService>;
  let mockSessionManager: jest.Mocked<DynamoSessionManager>;

  beforeEach(() => {
    mockTranscribeService = new TranscribeService() as jest.Mocked<TranscribeService>;
    mockSessionManager = new DynamoSessionManager({ tableName: 'test' }) as jest.Mocked<DynamoSessionManager>;
    
    processor = new TranscriptionProcessor(
      mockTranscribeService,
      mockSessionManager,
      {
        confidenceThreshold: 0.85,
        maxRetryAttempts: 2,
        retryDelayMs: 100, // Faster for testing
        maxTranscriptionTimeMs: 5000, // Shorter for testing
      }
    );

    jest.clearAllMocks();
  });

  describe('Configuration', () => {
    it('should use default configuration when none provided', () => {
      const defaultProcessor = new TranscriptionProcessor(
        mockTranscribeService,
        mockSessionManager
      );

      const stats = defaultProcessor.getProcessingStats();
      expect(stats).toEqual({
        confidenceThreshold: 0.85,
        maxRetryAttempts: 2,
        retryDelayMs: 1000,
        maxTranscriptionTimeMs: 60000,
      });
    });

    it('should accept custom configuration', () => {
      const customConfig: Partial<TranscriptionProcessingConfig> = {
        confidenceThreshold: 0.90,
        maxRetryAttempts: 3,
      };

      const customProcessor = new TranscriptionProcessor(
        mockTranscribeService,
        mockSessionManager,
        customConfig
      );

      const stats = customProcessor.getProcessingStats();
      expect(stats.confidenceThreshold).toBe(0.90);
      expect(stats.maxRetryAttempts).toBe(3);
    });

    it('should allow configuration updates', () => {
      processor.updateConfig({ confidenceThreshold: 0.95 });
      
      const stats = processor.getProcessingStats();
      expect(stats.confidenceThreshold).toBe(0.95);
    });
  });

  describe('processTranscription', () => {
    const testParams = {
      s3AudioUrl: 's3://test-bucket/audio.wav',
      sessionId: 'test-session-123',
      conversationEntryId: 'entry-456',
      callSid: 'call-789',
    };

    it('should successfully process high-confidence transcription on first attempt', async () => {
      const mockResult: TranscriptionResult = {
        text: 'Hello, this is a clear transcription.',
        confidence: 0.95,
        jobName: 'test-job',
        status: TranscriptionJobStatus.COMPLETED,
      };

      mockTranscribeService.transcribeAudio.mockResolvedValue('test-job');
      mockTranscribeService.pollTranscriptionJob.mockResolvedValue(mockResult);
      mockSessionManager.getSession.mockResolvedValue({
        sessionId: testParams.sessionId,
        conversationHistory: [
          { id: testParams.conversationEntryId, timestamp: Date.now() - 1000 }
        ]
      } as any);
      mockSessionManager.addSystemMessage.mockResolvedValue();

      const result = await processor.processTranscription(
        testParams.s3AudioUrl,
        testParams.sessionId,
        testParams.conversationEntryId,
        testParams.callSid
      );

      expect(result.success).toBe(true);
      expect(result.text).toBe('Hello, this is a clear transcription.');
      expect(result.confidence).toBe(0.95);
      expect(result.attempts).toBe(1);
      expect(result.error).toBeUndefined();

      expect(mockTranscribeService.transcribeAudio).toHaveBeenCalledWith(
        testParams.s3AudioUrl,
        testParams.sessionId,
        testParams.callSid
      );
      expect(mockSessionManager.addSystemMessage).toHaveBeenCalledWith(
        testParams.sessionId,
        expect.stringContaining('Transcription completed successfully')
      );
    });

    it('should retry with enhanced transcription for low confidence', async () => {
      const lowConfidenceResult: TranscriptionResult = {
        text: 'unclear speech',
        confidence: 0.70, // Below threshold
        jobName: 'test-job-1',
        status: TranscriptionJobStatus.COMPLETED,
      };

      const enhancedResult: TranscriptionResult = {
        text: 'Hello, this is enhanced transcription.',
        confidence: 0.92,
        jobName: 'test-job-enhanced',
        status: TranscriptionJobStatus.COMPLETED,
      };

      mockTranscribeService.transcribeAudio.mockResolvedValue('test-job-1');
      mockTranscribeService.pollTranscriptionJob.mockResolvedValue(lowConfidenceResult);
      mockTranscribeService.handleLowConfidence.mockResolvedValue(enhancedResult);
      mockSessionManager.getSession.mockResolvedValue({
        sessionId: testParams.sessionId,
        conversationHistory: [
          { id: testParams.conversationEntryId, timestamp: Date.now() - 1000 }
        ]
      } as any);
      mockSessionManager.addSystemMessage.mockResolvedValue();

      const result = await processor.processTranscription(
        testParams.s3AudioUrl,
        testParams.sessionId,
        testParams.conversationEntryId,
        testParams.callSid
      );

      expect(result.success).toBe(true);
      expect(result.text).toBe('Hello, this is enhanced transcription.');
      expect(result.confidence).toBe(0.92);
      expect(result.attempts).toBe(2); // Original + enhanced

      expect(mockTranscribeService.handleLowConfidence).toHaveBeenCalledWith(
        testParams.s3AudioUrl,
        testParams.sessionId,
        0.70,
        testParams.callSid
      );
    });

    it('should fail after maximum retry attempts', async () => {
      const failedResult: TranscriptionResult = {
        text: 'some low quality text',
        confidence: 0.60, // Below threshold
        jobName: 'test-job',
        status: TranscriptionJobStatus.COMPLETED,
      };

      mockTranscribeService.transcribeAudio.mockResolvedValue('test-job');
      mockTranscribeService.pollTranscriptionJob.mockResolvedValue(failedResult);
      mockTranscribeService.handleLowConfidence.mockResolvedValue(failedResult);
      mockSessionManager.addSystemMessage.mockResolvedValue();

      const result = await processor.processTranscription(
        testParams.s3AudioUrl,
        testParams.sessionId,
        testParams.conversationEntryId,
        testParams.callSid
      );

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(2); // Maximum attempts reached
      expect(result.error).toContain('Low confidence');

      expect(mockSessionManager.addSystemMessage).toHaveBeenCalledWith(
        testParams.sessionId,
        expect.stringContaining('Transcription failed after 2 attempts')
      );
    });

    it('should handle transcription service errors', async () => {
      mockTranscribeService.transcribeAudio.mockRejectedValue(new Error('AWS Service Error'));
      mockSessionManager.addSystemMessage.mockResolvedValue();

      const result = await processor.processTranscription(
        testParams.s3AudioUrl,
        testParams.sessionId,
        testParams.conversationEntryId,
        testParams.callSid
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('AWS Service Error');
      expect(result.attempts).toBe(2); // Tried maximum attempts
    });
  });

  describe('validateTranscriptionResult', () => {
    it('should validate successful high-confidence transcription', () => {
      const result: TranscriptionResult = {
        text: 'This is a good transcription.',
        confidence: 0.95,
        jobName: 'test-job',
        status: TranscriptionJobStatus.COMPLETED,
      };

      const validation = (processor as any).validateTranscriptionResult(result);
      expect(validation.isValid).toBe(true);
      expect(validation.reason).toBeUndefined();
    });

    it('should reject low confidence transcription', () => {
      const result: TranscriptionResult = {
        text: 'Unclear speech',
        confidence: 0.70, // Below 0.85 threshold
        jobName: 'test-job',
        status: TranscriptionJobStatus.COMPLETED,
      };

      const validation = (processor as any).validateTranscriptionResult(result);
      expect(validation.isValid).toBe(false);
      expect(validation.reason).toContain('Low confidence');
    });

    it('should reject empty transcription', () => {
      const result: TranscriptionResult = {
        text: '',
        confidence: 0.95,
        jobName: 'test-job',
        status: TranscriptionJobStatus.COMPLETED,
      };

      const validation = (processor as any).validateTranscriptionResult(result);
      expect(validation.isValid).toBe(false);
      expect(validation.reason).toBe('No transcribed text received');
    });

    it('should reject very short transcription', () => {
      const result: TranscriptionResult = {
        text: 'Hi',
        confidence: 0.95,
        jobName: 'test-job',
        status: TranscriptionJobStatus.COMPLETED,
      };

      const validation = (processor as any).validateTranscriptionResult(result);
      expect(validation.isValid).toBe(false);
      expect(validation.reason).toBe('Transcription too short (likely noise)');
    });

    it('should reject transcription with artifacts', () => {
      const result: TranscriptionResult = {
        text: 'Hello [inaudible] world',
        confidence: 0.95,
        jobName: 'test-job',
        status: TranscriptionJobStatus.COMPLETED,
      };

      const validation = (processor as any).validateTranscriptionResult(result);
      expect(validation.isValid).toBe(false);
      expect(validation.reason).toBe('Transcription contains audio artifacts');
    });

    it('should reject failed transcription job', () => {
      const result: TranscriptionResult = {
        text: 'Some text',
        confidence: 0.95,
        jobName: 'test-job',
        status: TranscriptionJobStatus.FAILED,
      };

      const validation = (processor as any).validateTranscriptionResult(result);
      expect(validation.isValid).toBe(false);
      expect(validation.reason).toContain('Transcription job status: FAILED');
    });
  });

  describe('validateAudioQuality', () => {
    it('should validate good quality audio', () => {
      const audioInfo = {
        fileSize: 50000, // 50KB
        duration: 15.5,  // 15.5 seconds
      };

      const validation = processor.validateAudioQuality(audioInfo);
      expect(validation.isValid).toBe(true);
    });

    it('should reject audio file that is too small', () => {
      const audioInfo = {
        fileSize: 500, // 500 bytes - too small
        duration: 15.5,
      };

      const validation = processor.validateAudioQuality(audioInfo);
      expect(validation.isValid).toBe(false);
      expect(validation.reason).toBe('Audio file too small (likely empty)');
    });

    it('should reject audio that is too short', () => {
      const audioInfo = {
        fileSize: 50000,
        duration: 0.2, // 0.2 seconds - too short
      };

      const validation = processor.validateAudioQuality(audioInfo);
      expect(validation.isValid).toBe(false);
      expect(validation.reason).toBe('Audio duration too short (likely no speech)');
    });

    it('should reject audio that is too long', () => {
      const audioInfo = {
        fileSize: 50000,
        duration: 400, // 400 seconds - too long
      };

      const validation = processor.validateAudioQuality(audioInfo);
      expect(validation.isValid).toBe(false);
      expect(validation.reason).toBe('Audio duration too long (exceeds processing limits)');
    });

    it('should handle missing audio metadata', () => {
      const audioInfo = {}; // No metadata

      const validation = processor.validateAudioQuality(audioInfo);
      expect(validation.isValid).toBe(true); // Should pass if no metadata to validate
    });
  });
});