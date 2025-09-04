#!/usr/bin/env node
import 'source-map-support/register';
import * as dotenv from 'dotenv';
import * as cdk from 'aws-cdk-lib';
import { PromptCallAiStack } from './promptcall-ai-stack';

// Load environment variables from .env file
dotenv.config();

const app = new cdk.App();

new PromptCallAiStack(app, 'PromptCallAiStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});