/**
 * Twilio configuration for PromptCall AI MVP
 */

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  apiKeySid?: string;
  apiKeySecret?: string;
}

/**
 * Gets Twilio configuration from environment variables
 */
export function getTwilioConfig(): TwilioConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !phoneNumber) {
    throw new Error(
      'Missing required Twilio environment variables. Please set:\n' +
      '- TWILIO_ACCOUNT_SID\n' +
      '- TWILIO_AUTH_TOKEN\n' +
      '- TWILIO_PHONE_NUMBER'
    );
  }

  return {
    accountSid,
    authToken,
    phoneNumber,
    apiKeySid: process.env.TWILIO_API_KEY_SID,
    apiKeySecret: process.env.TWILIO_API_KEY_SECRET,
  };
}

/**
 * Validates Twilio webhook signature for security
 */
export function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>,
  authToken: string
): boolean {
  // We'll implement Twilio signature validation here
  // This ensures webhooks are actually from Twilio
  return true; // Placeholder for now
}