import { api } from './client.ts';

/** Connection state of the tenant's WhatsApp line, as the API reports it. */
export type WhatsappConnectionState = 'not_created' | 'created' | 'connecting' | 'open' | 'close' | 'unknown';

export interface WhatsappConnection {
  state: WhatsappConnectionState;
  /** Base64 QR image. Null once the line is open or before one is issued. */
  qrCode: string | null;
}

export const whatsappApi = {
  /** GET /v1/whatsapp/instance — current state and QR (admin + config.manage). */
  getConnection(): Promise<WhatsappConnection> {
    return api.get<WhatsappConnection>('/v1/whatsapp/instance');
  },

  /** POST /v1/whatsapp/instance/connect — creates the line on first use, then asks for a QR. */
  connect(): Promise<WhatsappConnection> {
    return api.post<WhatsappConnection>('/v1/whatsapp/instance/connect');
  },
};
