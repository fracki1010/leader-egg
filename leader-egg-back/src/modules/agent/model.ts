import { Schema, type Document, type Types } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';

/**
 * In-app AI assistant persistence.
 *
 * Every collection is tenant-scoped (`createScopedModel`) so a conversation is
 * physically isolated in the tenant database. The provider API key is NEVER
 * stored here — only conversation text, compact tool summaries and the audit
 * trail of executed (read-only) tool calls.
 */

export type AgentRole = 'user' | 'assistant';

/** Compact summary of a tool execution attached to an assistant message. */
export interface IAgentToolCallSummary {
  name: string;
  ok: boolean;
  summary: string;
}

export interface IAgentConversation extends Document {
  userId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAgentMessage extends Document {
  conversationId: Types.ObjectId;
  userId: Types.ObjectId;
  role: AgentRole;
  content: string;
  toolCalls?: IAgentToolCallSummary[];
  createdAt: Date;
}

export interface IAgentToolCall extends Document {
  userId: Types.ObjectId;
  messageId?: Types.ObjectId;
  tool: string;
  args: unknown;
  ok: boolean;
  error?: string;
  durationMs: number;
  createdAt: Date;
}

// ─── Pending write actions (prepare → human confirm) ────────────────────────

export type AgentPendingActionType =
  | 'create_order'
  | 'register_payment'
  | 'create_customer'
  | 'change_order_status'
  | 'set_customer_location';

export type AgentPendingActionStatus =
  | 'pending'
  | 'executing'
  | 'confirmed'
  | 'cancelled'
  | 'failed'
  | 'expired';

export interface AgentActionResultRef {
  entity: 'order' | 'payment' | 'customer';
  id: string;
  label?: string;
}

export interface IAgentPendingAction extends Document {
  userId: Types.ObjectId;
  conversationId: Types.ObjectId;
  /** The assistant message of the turn that prepared this action. */
  messageId: Types.ObjectId;
  type: AgentPendingActionType;
  /** Server-generated payload — the client NEVER sends it back. */
  payload: Record<string, unknown>;
  /** Spanish, human-readable summary of what the user is approving. */
  preview: string;
  status: AgentPendingActionStatus;
  idempotencyKey: string;
  resultSummary?: string;
  resultRef?: AgentActionResultRef;
  error?: string;
  createdAt: Date;
  expiresAt: Date;
  resolvedAt?: Date;
}

// ─── Conversation (one per user) ────────────────────────────────────────────

const agentConversationSchema = new Schema<IAgentConversation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

// ONE conversation per user: the upsert in getOrCreateConversation relies on it.
agentConversationSchema.index({ userId: 1 }, { unique: true });

export const AgentConversation = createScopedModel<IAgentConversation>(
  'AgentConversation',
  agentConversationSchema
);

// ─── Message (user/assistant transcript) ────────────────────────────────────

const agentToolCallSummarySchema = new Schema<IAgentToolCallSummary>(
  {
    name: { type: String, required: true, trim: true },
    ok: { type: Boolean, required: true },
    summary: { type: String, required: true, default: '' }
  },
  { _id: false }
);

const agentMessageSchema = new Schema<IAgentMessage>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'AgentConversation', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, required: true, enum: ['user', 'assistant'] },
    content: { type: String, required: true, default: '' },
    toolCalls: { type: [agentToolCallSummarySchema], default: undefined }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

agentMessageSchema.index({ conversationId: 1, createdAt: 1 });
agentMessageSchema.index({ userId: 1, createdAt: -1 });

export const AgentMessage = createScopedModel<IAgentMessage>('AgentMessage', agentMessageSchema);

// ─── Tool-call audit trail (never deleted by clearChat) ─────────────────────

const agentToolCallSchema = new Schema<IAgentToolCall>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    messageId: { type: Schema.Types.ObjectId, ref: 'AgentMessage', default: undefined },
    tool: { type: String, required: true, trim: true },
    args: { type: Schema.Types.Mixed, default: {} },
    ok: { type: Boolean, required: true },
    error: { type: String, default: undefined },
    durationMs: { type: Number, required: true, default: 0, min: 0 }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

agentToolCallSchema.index({ createdAt: -1 });

export const AgentToolCall = createScopedModel<IAgentToolCall>('AgentToolCall', agentToolCallSchema);

// ─── Pending action (prepare-only writes awaiting explicit confirmation) ────

const agentActionResultRefSchema = new Schema<AgentActionResultRef>(
  {
    entity: { type: String, required: true, enum: ['order', 'payment', 'customer'] },
    id: { type: String, required: true },
    label: { type: String, trim: true }
  },
  { _id: false }
);

const agentPendingActionSchema = new Schema<IAgentPendingAction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'AgentConversation', required: true },
    messageId: { type: Schema.Types.ObjectId, ref: 'AgentMessage', required: true },
    type: {
      type: String,
      required: true,
      enum: [
        'create_order',
        'register_payment',
        'create_customer',
        'change_order_status',
        'set_customer_location'
      ]
    },
    payload: { type: Schema.Types.Mixed, required: true },
    preview: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'executing', 'confirmed', 'cancelled', 'failed', 'expired'],
      default: 'pending'
    },
    idempotencyKey: { type: String, required: true },
    resultSummary: { type: String, default: undefined },
    resultRef: { type: agentActionResultRefSchema, default: undefined },
    error: { type: String, default: undefined },
    expiresAt: { type: Date, required: true },
    resolvedAt: { type: Date, default: undefined }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

agentPendingActionSchema.index({ userId: 1, status: 1, createdAt: -1 });
agentPendingActionSchema.index({ conversationId: 1, createdAt: -1 });

export const AgentPendingAction = createScopedModel<IAgentPendingAction>(
  'AgentPendingAction',
  agentPendingActionSchema
);

/**
 * Returns the calling user's single conversation, creating it on first use.
 *
 * The unique `userId` index makes the upsert safe under concurrent requests;
 * when two requests race, the loser catches the duplicate-key error and reads
 * the winner's document instead of failing.
 */
export const getOrCreateConversation = async (userId: string): Promise<IAgentConversation> => {
  try {
    const conversation = await AgentConversation.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId } },
      { new: true, upsert: true }
    );

    if (conversation) {
      return conversation;
    }
  } catch (error) {
    // Duplicate key on a concurrent upsert — fall through to the read below.
    const existing = await AgentConversation.findOne({ userId });
    if (existing) {
      return existing;
    }
    throw error;
  }

  const fallback = await AgentConversation.findOne({ userId });
  if (!fallback) {
    throw new Error('Could not create agent conversation');
  }
  return fallback;
};
