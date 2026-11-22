import { api } from './client.ts';
import type {
  CreateDailyClosePayload,
  DailyClose,
  DailyCloseChannel,
  DailyClosePreview,
  UpdateDailyClosePayload,
} from '../types/index.ts';

/**
 * Daily close (cierre diario) API — admin/puesto `/v1/daily-closes`.
 *
 * The backend snapshots one local calendar day PER CHANNEL: a close freezes
 * the computed summary + systemCash, stores countedCash and derives
 * `difference`. `channel` = 'reparto' (delivery, default) or 'puesto'
 * (stall) — each channel closes independently, and previews/creates/lists
 * are filtered by it. PATCH is the only correction path and never
 * recomputes the frozen snapshot.
 */
export const dailyClosesApi = {
  /** Computes the day's numbers WITHOUT persisting (date defaults to today). */
  preview(date?: string, channel?: DailyCloseChannel): Promise<DailyClosePreview> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (channel) params.channel = channel;
    return api.get<DailyClosePreview>('/v1/daily-closes/preview', params);
  },

  /** Closes the day for the given channel (409 if that channel already has a close). */
  create(payload: CreateDailyClosePayload): Promise<DailyClose> {
    return api.post<DailyClose>('/v1/daily-closes', payload);
  },

  /** Corrects countedCash/notes and recomputes the difference. */
  update(id: string, payload: UpdateDailyClosePayload): Promise<DailyClose> {
    return api.patch<DailyClose>(`/v1/daily-closes/${id}`, payload);
  },

  /** The close for a local day + channel — 404 when none exists. */
  getByDate(date: string, channel?: DailyCloseChannel): Promise<DailyClose> {
    const params: Record<string, string> = {};
    if (channel) params.channel = channel;
    return api.get<DailyClose>(`/v1/daily-closes/${date}`, params);
  },

  /** Lists closes in the inclusive local-day range (channel-scoped), newest first. */
  list(from?: string, to?: string, channel?: DailyCloseChannel): Promise<DailyClose[]> {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    if (channel) params.channel = channel;
    return api.get<DailyClose[]>('/v1/daily-closes', params);
  },
};