import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class PromptCallAiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB table for session management with TTL
    const sessionTable = new dynamodb.Table(this, 'SessionTable', {
      tableName: 'promptcall-sessions',
      partitionKey: {
        name: 'sessionId',
        type: dynamodb.AttributeType.STRING
      },
      timeToLiveAttribute: 'ttl',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development
    });

    // S3 bucket for audio file storage with lifecycle policies
    const audioBucket = new s3.Bucket(this, 'AudioBucket', {
      bucketName: `promptcall-audio-${this.account}-${this.region}`,
      lifecycleRules: [
        {
          id: 'DeleteOldAudioFiles',
          expiration: cdk.Duration.days(7), // Delete audio files after 7 days
          enabled: true,
        }
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        }
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development
      autoDeleteObjects: true, // For development
    });

    // IAM role for Lambda execution with AWS service permissions
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:Query',
                'dynamodb:Scan'
              ],
              resources: [sessionTable.tableArn]
            })
          ]
        }),
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject'
              ],
              resources: [`${audioBucket.bucketArn}/*`]
            })
          ]
        }),
        TranscribeAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'transcribe:StartTranscriptionJob',
                'transcribe:GetTranscriptionJob',
                'transcribe:ListTranscriptionJobs'
              ],
              resources: ['*']
            })
          ]
        }),
        PollyAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'polly:SynthesizeSpeech'
              ],
              resources: ['*']
            })
          ]
        }),
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream'
              ],
              resources: ['*']
            })
          ]
        })
      }
    });

    // Lambda function for handling Twilio webhooks
    const webhookHandler = new lambda.Function(this, 'WebhookHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'webhook-handler.handler',
      code: lambda.Code.fromAsset('dist/lambda'),
      role: lambdaRole,
      environment: {
        SESSION_TABLE_NAME: sessionTable.tableName,
        AUDIO_BUCKET_NAME: audioBucket.bucketName,
      },
      timeout: cdk.Duration.seconds(30),
    });

    // API Gateway with CORS settings for Twilio webhooks
    const api = new apigateway.RestApi(this, 'PromptCallApi', {
      restApiName: 'PromptCall AI API',
      description: 'API for handling Twilio webhooks and voice interactions',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // Webhook endpoints
    const webhookResource = api.root.addResource('webhook');

    // Voice webhook endpoint
    const voiceResource = webhookResource.addResource('voice');
    voiceResource.addMethod('POST', new apigateway.LambdaIntegration(webhookHandler));

    // Speech processing webhook endpoint
    const speechResource = webhookResource.addResource('speech');
    speechResource.addMethod('POST', new apigateway.LambdaIntegration(webhookHandler));

    // DTMF processing webhook endpoint
    const dtmfResource = webhookResource.addResource('dtmf');
    dtmfResource.addMethod('POST', new apigateway.LambdaIntegration(webhookHandler));

    // Events webhook endpoint
    const eventsResource = webhookResource.addResource('events');
    eventsResource.addMethod('POST', new apigateway.LambdaIntegration(webhookHandler));

    // Output important values
    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      description: 'API Gateway URL for Twilio webhooks'
    });

    new cdk.CfnOutput(this, 'SessionTableName', {
      value: sessionTable.tableName,
      description: 'DynamoDB table name for session management'
    });

    new cdk.CfnOutput(this, 'AudioBucketName', {
      value: audioBucket.bucketName,
      description: 'S3 bucket name for audio file storage'
    });
  }
}