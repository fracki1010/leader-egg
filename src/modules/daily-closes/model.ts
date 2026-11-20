import { Schema, type Document } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';

export interface IDailyCloseSummary {
  ventasHoy: number;
  efectivo: number;
  transferencia: number;
  fiado: number;
  gastos: number;
  maplesVendidos: number;
  resultado: number;
  /** Cash paid to suppliers that day (empty/legacy snapshots read 0). */
  pagosProveedor: number;
}

export type DailyCloseChannel = 'reparto' | 'puesto';

export interface IDailyClose extends Document {
  /** Local midnight of the closed day — unique per channel, so one close per (local day, channel). */
  date: Date;
  /** Sales channel being closed: 'reparto' (default, delivery/other) or 'puesto' (stall). */
  channel: DailyCloseChannel;
  /** Expected cash in the drawer at close time (frozen snapshot). */
  systemCash: number;
  /** Cash physically counted by the admin. */
  countedCash: number;
  /** countedCash − systemCash (recomputed on PATCH from the frozen systemCash). */
  difference: number;
  notes?: string;
  summary: IDailyCloseSummary;
  /** Admin userId that created the close. */
  closedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const dailyCloseSummarySchema = new Schema<IDailyCloseSummary>(
  {
    ventasHoy: { type: Number, required: true, default: 0 },
    efectivo: { type: Number, required: true, default: 0 },
    transferencia: { type: Number, required: true, default: 0 },
    fiado: { type: Number, required: true, default: 0 },
    gastos: { type: Number, required: true, default: 0 },
    maplesVendidos: { type: Number, required: true, default: 0 },
    resultado: { type: Number, required: true, default: 0 },
    pagosProveedor: { type: Number, required: true, default: 0 }
  },
  { _id: false }
);

export const dailyCloseSchema = new Schema<IDailyClose>(
  {
    date: { type: Date, required: true },
    channel: { type: String, enum: ['reparto', 'puesto'], default: 'reparto' },
    systemCash: { type: Number, required: true, default: 0 },
    countedCash: { type: Number, required: true, min: 0 },
    difference: { type: Number, required: true, default: 0 },
    notes: { type: String, trim: true, maxlength: 500 },
    summary: { type: dailyCloseSummarySchema, required: true },
    closedBy: { type: String, required: true }
  },
  { timestamps: true }
);

// One close per (local day, channel): a reparto close and a stall close can
// coexist on the same day, but a second close of the same channel is rejected
// by this unique index (and pre-checked for a clean 409).
dailyCloseSchema.index({ date: 1, channel: 1 }, { unique: true });

export const DailyClose = createScopedModel<IDailyClose>('DailyClose', dailyCloseSchema);
