# PromptCall AI MVP

A voice-to-AI conversational platform that enables users to access AI assistance through phone calls.

## Project Structure

```
├── src/
│   ├── app.ts              # CDK app entry point
│   └── promptcall-ai-stack.ts  # Main CDK stack definition
├── test/
│   └── promptcall-ai-stack.test.ts  # Stack tests
├── package.json            # Node.js dependencies and scripts
├── tsconfig.json          # TypeScript configuration
├── cdk.json              # CDK configuration
└── jest.config.js        # Jest testing configuration
```

## Getting Started

### Prerequisites

- Node.js (v18 or later)
- AWS CLI configured with appropriate credentials
- AWS CDK CLI installed globally: `npm install -g aws-cdk`

### Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Synthesize CloudFormation template
npm run synth

# Deploy to AWS
npm run deploy
```

## Development

- `npm run build` - Compile TypeScript to JavaScript
- `npm run watch` - Watch for changes and compile automatically
- `npm test` - Run unit tests
- `npm run cdk` - Run CDK commands
- `npm run synth` - Synthesize CloudFormation template
- `npm run deploy` - Deploy stack to AWS

## Architecture

This project implements a serverless voice-to-AI platform using:

- **AWS Lambda** - Serverless compute for call handling
- **Amazon API Gateway** - REST API for webhooks
- **Amazon DynamoDB** - Session and conversation storage
- **Amazon S3** - Audio file storage
- **Amazon Transcribe** - Speech-to-text conversion
- **Amazon Polly** - Text-to-speech synthesis
- **AWS Bedrock** - AI language model integration
- **Twilio Voice API** - Telephony services