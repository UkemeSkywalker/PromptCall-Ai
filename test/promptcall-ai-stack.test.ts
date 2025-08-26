import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { PromptCallAiStack } from '../src/promptcall-ai-stack';

test('Empty Stack', () => {
  const app = new cdk.App();
  const stack = new PromptCallAiStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  // Basic test to ensure stack can be created
  expect(template.toJSON()).toBeDefined();
});