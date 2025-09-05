/**
 * DynamoDB Session Manager for PromptCall AI MVP
 * Handles CRUD operations for call sessions with conversation history
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  CallSession,
  ConversationEntry,
  SessionStatus,
  validateCallSession,
  createCallSession,
  createConversationEntry,
  SessionConfig,
  DEFAULT_SESSION_CONFIG,
} from '../types/session';

export interface DynamoSessionManagerConfig {
  tableName: string;
  region?: string;
  sessionConfig?: SessionConfig;
}

export class DynamoSessionManager {
  private client: DynamoDBClient;
  private tableName: string;
  private sessionConfig: SessionConfig;

  constructor(config: DynamoSessionManagerConfig) {
    this.client = new DynamoDBClient({
      region: config.region || process.env.AWS_REGION || 'us-east-1',
    });
    this.tableName = config.tableName;
    this.sessionConfig = config.sessionConfig || DEFAULT_SESSION_CONFIG;
  }

  /**
   * Creates a new call session in DynamoDB
   */
  async createSession(callSid: string, phoneNumber: string): Promise<CallSession> {
    const session = createCallSession(callSid, phoneNumber, this.sessionConfig);

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: marshall(session, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_not_exists(sessionId)', // Prevent overwrites
    });

    try {
      await this.client.send(command);
      console.log(`Created session: ${session.sessionId} for call: ${callSid}`);
      return session;
    } catch (error) {
      console.error('Error creating session:', error);
      throw new Error(`Failed to create session: ${error}`);
    }
  }

  /**
   * Retrieves a session by session ID
   */
  async getSession(sessionId: string): Promise<CallSession | null> {
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: marshall({ sessionId }),
    });

    try {
      const result = await this.client.send(command);

      if (!result.Item) {
        console.log(`Session not found: ${sessionId}`);
        return null;
      }

      const session = unmarshall(result.Item) as CallSession;

      if (!validateCallSession(session)) {
        console.error(`Invalid session data for: ${sessionId}`);
        return null;
      }

      return session;
    } catch (error) {
      console.error('Error retrieving session:', error);
      throw new Error(`Failed to retrieve session: ${error}`);
    }
  }

  /**
   * Retrieves a session by Twilio Call SID
   */
  async getSessionByCallSid(callSid: string): Promise<CallSession | null> {
    // Note: This requires a GSI on callSid for efficient querying
    // For now, we'll use a scan operation (not ideal for production)
    const command = new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'callSid = :callSid',
      ExpressionAttributeValues: marshall({
        ':callSid': callSid,
      }, { removeUndefinedValues: true }),
    });

    try {
      const result = await this.client.send(command);

      if (!result.Items || result.Items.length === 0) {
        console.log(`Session not found for call: ${callSid}`);
        return null;
      }

      const session = unmarshall(result.Items[0]) as CallSession;

      if (!validateCallSession(session)) {
        console.error(`Invalid session data for call: ${callSid}`);
        return null;
      }

      return session;
    } catch (error) {
      console.error('Error retrieving session by call SID:', error);
      throw new Error(`Failed to retrieve session by call SID: ${error}`);
    }
  }

  /**
   * Updates session status and metadata
   */
  async updateSessionStatus(
    sessionId: string,
    status: SessionStatus,
    endTime?: number,
    errorInfo?: { code: string; message: string }
  ): Promise<void> {
    const updateExpression = ['SET #status = :status, lastActivity = :lastActivity'];
    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
    };
    const expressionAttributeValues: Record<string, any> = {
      ':status': status,
      ':lastActivity': Date.now(),
    };

    if (endTime) {
      updateExpression.push('endTime = :endTime');
      expressionAttributeValues[':endTime'] = endTime;
    }

    if (errorInfo) {
      updateExpression.push('errorInfo = :errorInfo');
      expressionAttributeValues[':errorInfo'] = {
        ...errorInfo,
        timestamp: Date.now(),
      };
    }

    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: marshall({ sessionId }),
      UpdateExpression: updateExpression.join(', '),
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: marshall(expressionAttributeValues, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_exists(sessionId)', // Ensure session exists
    });

    try {
      await this.client.send(command);
      console.log(`Updated session status: ${sessionId} -> ${status}`);
    } catch (error) {
      console.error('Error updating session status:', error);
      throw new Error(`Failed to update session status: ${error}`);
    }
  }

  /**
   * Appends a conversation entry to the session history using atomic update
   */
  async appendConversationEntry(
    sessionId: string,
    entry: ConversationEntry
  ): Promise<void> {
    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: marshall({ sessionId }),
      UpdateExpression: 'SET conversationHistory = list_append(if_not_exists(conversationHistory, :empty_list), :new_entry), lastActivity = :lastActivity',
      ExpressionAttributeValues: marshall({
        ':new_entry': [entry],
        ':empty_list': [],
        ':lastActivity': Date.now(),
      }, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_exists(sessionId)', // Ensure session exists
    });

    try {
      await this.client.send(command);
      console.log(`Added conversation entry to session: ${sessionId}, type: ${entry.type}`);
    } catch (error) {
      console.error('Error appending conversation entry:', error);
      throw new Error(`Failed to append conversation entry: ${error}`);
    }
  }

  /**
   * Adds a user message to the conversation
   */
  async addUserMessage(
    sessionId: string,
    text: string,
    audioUrl?: string,
    confidence?: number
  ): Promise<void> {
    const entry = createConversationEntry('user', text, audioUrl, confidence);
    await this.appendConversationEntry(sessionId, entry);
  }

  /**
   * Adds an AI response to the conversation
   */
  async addAiResponse(
    sessionId: string,
    text: string,
    audioUrl?: string,
    processingDuration?: number
  ): Promise<void> {
    const entry = createConversationEntry('ai', text, audioUrl);
    if (processingDuration) {
      entry.processingDuration = processingDuration;
    }
    await this.appendConversationEntry(sessionId, entry);
  }

  /**
   * Updates a conversation entry with audio URL
   */
  async updateConversationEntryWithAudio(
    sessionId: string,
    entryIndex: number,
    audioUrl: string
  ): Promise<void> {
    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: marshall({ sessionId }),
      UpdateExpression: `SET conversationHistory[${entryIndex}].audioUrl = :audioUrl, lastActivity = :lastActivity`,
      ExpressionAttributeValues: marshall({
        ':audioUrl': audioUrl,
        ':lastActivity': Date.now(),
      }, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_exists(sessionId)',
    });

    try {
      await this.client.send(command);
      console.log(`Updated conversation entry ${entryIndex} with audio URL for session: ${sessionId}`);
    } catch (error) {
      console.error('Error updating conversation entry with audio:', error);
      throw new Error(`Failed to update conversation entry with audio: ${error}`);
    }
  }

  /**
   * Adds a system message to the conversation
   */
  async addSystemMessage(sessionId: string, text: string): Promise<void> {
    const entry = createConversationEntry('system', text);
    await this.appendConversationEntry(sessionId, entry);
  }

  /**
   * Updates the total call duration
   */
  async updateCallDuration(sessionId: string, durationSeconds: number): Promise<void> {
    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: marshall({ sessionId }),
      UpdateExpression: 'SET totalDuration = :duration, lastActivity = :lastActivity',
      ExpressionAttributeValues: marshall({
        ':duration': durationSeconds,
        ':lastActivity': Date.now(),
      }, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_exists(sessionId)',
    });

    try {
      await this.client.send(command);
      console.log(`Updated call duration: ${sessionId} -> ${durationSeconds}s`);
    } catch (error) {
      console.error('Error updating call duration:', error);
      throw new Error(`Failed to update call duration: ${error}`);
    }
  }

  /**
   * Deletes a session (for cleanup or testing)
   */
  async deleteSession(sessionId: string): Promise<void> {
    const command = new DeleteItemCommand({
      TableName: this.tableName,
      Key: marshall({ sessionId }),
    });

    try {
      await this.client.send(command);
      console.log(`Deleted session: ${sessionId}`);
    } catch (error) {
      console.error('Error deleting session:', error);
      throw new Error(`Failed to delete session: ${error}`);
    }
  }

  /**
   * Gets all sessions (for monitoring/debugging)
   */
  async getAllSessions(limit: number = 100): Promise<CallSession[]> {
    const command = new ScanCommand({
      TableName: this.tableName,
      Limit: limit,
    });

    try {
      const result = await this.client.send(command);

      if (!result.Items) {
        return [];
      }

      const sessions = result.Items
        .map(item => unmarshall(item) as CallSession)
        .filter(session => validateCallSession(session));

      return sessions;
    } catch (error) {
      console.error('Error getting all sessions:', error);
      throw new Error(`Failed to get all sessions: ${error}`);
    }
  }

  /**
   * Lists active sessions (for monitoring/debugging)
   */
  async listActiveSessions(limit: number = 50): Promise<CallSession[]> {
    const command = new ScanCommand({
      TableName: this.tableName,
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: marshall({
        ':status': 'active',
      }, { removeUndefinedValues: true }),
      Limit: limit,
    });

    try {
      const result = await this.client.send(command);

      if (!result.Items) {
        return [];
      }

      const sessions = result.Items
        .map(item => unmarshall(item) as CallSession)
        .filter(session => validateCallSession(session));

      return sessions;
    } catch (error) {
      console.error('Error listing active sessions:', error);
      throw new Error(`Failed to list active sessions: ${error}`);
    }
  }

  /**
   * Gets conversation history for a session
   */
  async getConversationHistory(sessionId: string): Promise<ConversationEntry[]> {
    const session = await this.getSession(sessionId);
    return session?.conversationHistory || [];
  }

  /**
   * Builds conversation context string for AI processing
   */
  async buildConversationContext(sessionId: string, maxEntries: number = 10): Promise<string> {
    const history = await this.getConversationHistory(sessionId);

    // Get the most recent entries
    const recentHistory = history.slice(-maxEntries);

    // Build context string
    const contextLines = recentHistory.map(entry => {
      const speaker = entry.type === 'user' ? 'User' : entry.type === 'ai' ? 'Assistant' : 'System';
      return `${speaker}: ${entry.text}`;
    });

    return contextLines.join('\n');
  }

  /**
   * Health check method to verify DynamoDB connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Try to scan the table with a limit of 1 to test connectivity
      const command = new ScanCommand({
        TableName: this.tableName,
        Limit: 1,
      });

      await this.client.send(command);
      return true;
    } catch (error) {
      console.error('DynamoDB health check failed:', error);
      return false;
    }
  }
}