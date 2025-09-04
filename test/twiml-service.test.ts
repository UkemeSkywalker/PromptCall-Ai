import { TwiMLService } from '../src/services/twiml-service';

describe('TwiMLService', () => {
  let twimlService: TwiMLService;

  beforeEach(() => {
    twimlService = new TwiMLService();
  });

  describe('createSayResponse', () => {
    it('should create valid TwiML with Say verb', () => {
      const message = 'Hello, welcome to PromptCall AI';
      const twiml = twimlService.createSayResponse(message);
      
      expect(twiml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(twiml).toContain('<Response>');
      expect(twiml).toContain('</Response>');
      expect(twiml).toContain('<Say voice="alice"');
      expect(twiml).toContain(message);
      expect(twimlService.validateTwiML(twiml)).toBe(true);
    });

    it('should escape XML special characters', () => {
      const message = 'Hello & welcome to "PromptCall AI" <test>';
      const twiml = twimlService.createSayResponse(message);
      
      expect(twiml).toContain('&amp;');
      expect(twiml).toContain('&quot;');
      expect(twiml).toContain('&lt;');
      expect(twiml).toContain('&gt;');
      expect(twimlService.validateTwiML(twiml)).toBe(true);
    });
  });

  describe('createWelcomeWithRecording', () => {
    it('should create valid TwiML with Say and Record verbs', () => {
      const welcomeMessage = 'Welcome to PromptCall AI. Please speak your question.';
      const twiml = twimlService.createWelcomeWithRecording(welcomeMessage);
      
      expect(twiml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(twiml).toContain('<Response>');
      expect(twiml).toContain('</Response>');
      expect(twiml).toContain('<Say voice="alice">');
      expect(twiml).toContain('<Record');
      expect(twiml).toContain('action="/webhook/speech"');
      expect(twiml).toContain('method="POST"');
      expect(twiml).toContain(welcomeMessage);
      expect(twimlService.validateTwiML(twiml)).toBe(true);
    });

    it('should use custom record options', () => {
      const welcomeMessage = 'Welcome';
      const twiml = twimlService.createWelcomeWithRecording(welcomeMessage, {
        action: '/custom/speech',
        maxLength: 60,
        timeout: 15
      });
      
      expect(twiml).toContain('action="/custom/speech"');
      expect(twiml).toContain('maxLength="60"');
      expect(twiml).toContain('timeout="15"');
      expect(twimlService.validateTwiML(twiml)).toBe(true);
    });
  });

  describe('createGatherResponse', () => {
    it('should create valid TwiML with Gather verb', () => {
      const prompt = 'Press 1 to submit or 0 to end call';
      const twiml = twimlService.createGatherResponse(prompt);
      
      expect(twiml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(twiml).toContain('<Response>');
      expect(twiml).toContain('</Response>');
      expect(twiml).toContain('<Gather');
      expect(twiml).toContain('action="/webhook/dtmf"');
      expect(twiml).toContain('method="POST"');
      expect(twiml).toContain('<Say voice="alice">');
      expect(twiml).toContain(prompt);
      expect(twimlService.validateTwiML(twiml)).toBe(true);
    });

    it('should use custom gather options', () => {
      const prompt = 'Enter digits';
      const twiml = twimlService.createGatherResponse(prompt, {
        action: '/custom/dtmf',
        numDigits: 3,
        timeout: 20
      });
      
      expect(twiml).toContain('action="/custom/dtmf"');
      expect(twiml).toContain('numDigits="3"');
      expect(twiml).toContain('timeout="20"');
      expect(twimlService.validateTwiML(twiml)).toBe(true);
    });
  });

  describe('createHangupResponse', () => {
    it('should create valid TwiML with Hangup verb', () => {
      const twiml = twimlService.createHangupResponse();
      
      expect(twiml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(twiml).toContain('<Response>');
      expect(twiml).toContain('</Response>');
      expect(twiml).toContain('<Hangup/>');
      expect(twimlService.validateTwiML(twiml)).toBe(true);
    });

    it('should include goodbye message when provided', () => {
      const goodbyeMessage = 'Thank you for using PromptCall AI. Goodbye!';
      const twiml = twimlService.createHangupResponse(goodbyeMessage);
      
      expect(twiml).toContain('<Say voice="alice">');
      expect(twiml).toContain(goodbyeMessage);
      expect(twiml).toContain('<Hangup/>');
      expect(twimlService.validateTwiML(twiml)).toBe(true);
    });
  });

  describe('createComplexResponse', () => {
    it('should create valid TwiML with multiple verbs', () => {
      const verbs = [
        twimlService.createSayVerb('First message'),
        twimlService.createPauseVerb(2),
        twimlService.createSayVerb('Second message'),
        twimlService.createHangupVerb()
      ];
      
      const twiml = twimlService.createComplexResponse(verbs);
      
      expect(twiml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(twiml).toContain('<Response>');
      expect(twiml).toContain('</Response>');
      expect(twiml).toContain('<Say voice="alice">First message</Say>');
      expect(twiml).toContain('<Pause length="2"/>');
      expect(twiml).toContain('<Say voice="alice">Second message</Say>');
      expect(twiml).toContain('<Hangup/>');
      expect(twimlService.validateTwiML(twiml)).toBe(true);
    });
  });

  describe('validateTwiML', () => {
    it('should validate correct TwiML', () => {
      const validTwiML = '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Hello</Say></Response>';
      expect(twimlService.validateTwiML(validTwiML)).toBe(true);
    });

    it('should reject invalid TwiML', () => {
      const invalidTwiML = '<Response><Say>Hello</Say>';
      expect(twimlService.validateTwiML(invalidTwiML)).toBe(false);
    });

    it('should reject TwiML without XML declaration', () => {
      const invalidTwiML = '<Response><Say>Hello</Say></Response>';
      expect(twimlService.validateTwiML(invalidTwiML)).toBe(false);
    });
  });

  describe('parseWebhookParams', () => {
    it('should parse form data correctly', () => {
      const formData = 'CallSid=CA123&From=%2B1234567890&To=%2B0987654321&Digits=1';
      const params = TwiMLService.parseWebhookParams(formData);
      
      expect(params.CallSid).toBe('CA123');
      expect(params.From).toBe('+1234567890');
      expect(params.To).toBe('+0987654321');
      expect(params.Digits).toBe('1');
    });
  });

  describe('extractTwilioParams', () => {
    it('should extract common Twilio parameters', () => {
      const params = {
        CallSid: 'CA123',
        From: '+1234567890',
        To: '+0987654321',
        CallStatus: 'in-progress',
        Direction: 'inbound',
        RecordingUrl: 'https://api.twilio.com/recording.wav',
        Digits: '1'
      };
      
      const extracted = TwiMLService.extractTwilioParams(params);
      
      expect(extracted.callSid).toBe('CA123');
      expect(extracted.from).toBe('+1234567890');
      expect(extracted.to).toBe('+0987654321');
      expect(extracted.callStatus).toBe('in-progress');
      expect(extracted.direction).toBe('inbound');
      expect(extracted.recordingUrl).toBe('https://api.twilio.com/recording.wav');
      expect(extracted.digits).toBe('1');
    });
  });
});