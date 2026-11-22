import { Schema, type Document, type Types } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';

/**
 * WhatsApp channel persistence (tenant-scoped).
 *
 * Phone keys are the canonical digits from `normalizeWhatsappSender`, so the
 * 549/54 variants of one Argentine mobile land on the same row. `replyJid`
 * keeps the delivered digits for outbound replies.
 */

export const WHATSAPP_INBOUND_STATUSES = ['received', 'processed', 'failed', 'ignored'] as const;
export type WhatsappInboundStatus = (typeof WHATSAPP_INBOUND_STATUSES)[number];

/** Dedupe rows are only needed for the provider's redelivery window. */
export const INBOUND_EVENT_TTL_DAYS = 14;

export interface IWhatsappAllowedNumber extends Document {
  phone: string;
  userId: Types.ObjectId;
  createdAt: Date;
}

export interface IWhatsappConversation extends Document {
  phone: string;
  userId: Types.ObjectId;
  replyJid: string;
  draft?: {
    location: { type: 'Point'; coordinates: [number, number] };
    addressDetail?: string;
    createdAt: Date;
  } | null;
  lastInboundAt: Date;
}

export interface IWhatsappMessage extends Document {
  conversationId: Types.ObjectId;
  role: 'user' | 'assistant';
  content: string;
  mediaKind?: 'text' | 'audio' | 'image' | 'location';
  toolCalls?: Array<{ name: string; ok: boolean; summary: string }>;
  createdAt: Date;
}

export interface IWhatsappInboundEvent extends Document {
  /** Provider message id. Unique per tenant: the dedupe key. */
  providerMessageId: string;
  phone: string;
  status: WhatsappInboundStatus;
  expiresAt: Date;
  createdAt: Date;
}

export const allowedNumberSchema = new Schema<IWhatsappAllowedNumber>(
  {
    phone: { type: String, required: true, unique: true, trim: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

export const conversationSchema = new Schema<IWhatsappConversation>({
  phone: { type: String, required: true, unique: true, trim: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  replyJid: { type: String, required: true, trim: true },
  draft: {
    type: new Schema(
      {
        location: {
          type: { type: String, enum: ['Point'], required: true },
          coordinates: { type: [Number], required: true }
        },
        addressDetail: { type: String, trim: true },
        createdAt: { type: Date, required: true }
      },
      { _id: false }
    ),
    default: null
  },
  lastInboundAt: { type: Date, required: true }
});

export const messageSchema = new Schema<IWhatsappMessage>({
  conversationId: { type: Schema.Types.ObjectId, ref: 'WhatsappConversation', required: true },
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  mediaKind: { type: String, enum: ['text', 'audio', 'image', 'location'] },
  toolCalls: {
    type: [{ name: String, ok: Boolean, summary: String, _id: false }],
    default: undefined
  },
  createdAt: { type: Date, default: Date.now }
});
messageSchema.index({ conversationId: 1, createdAt: 1 });

export const inboundEventSchema = new Schema<IWhatsappInboundEvent>({
  providerMessageId: { type: String, required: true, unique: true, trim: true },
  phone: { type: String, required: true, trim: true },
  status: { type: String, enum: WHATSAPP_INBOUND_STATUSES, default: 'received' },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});
inboundEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WhatsappAllowedNumber = createScopedModel<IWhatsappAllowedNumber>(
  'WhatsappAllowedNumber',
  allowedNumberSchema
);
export const WhatsappConversation = createScopedModel<IWhatsappConversation>(
  'WhatsappConversation',
  conversationSchema
);
export const WhatsappMessage = createScopedModel<IWhatsappMessage>('WhatsappMessage', messageSchema);
export const WhatsappInboundEvent = createScopedModel<IWhatsappInboundEvent>(
  'WhatsappInboundEvent',
  inboundEventSchema
);
