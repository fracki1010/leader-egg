import { AppError } from '../../middleware/error-handler.js';
import { cancelAction, confirmAction } from '../agent/actions.js';
import { AgentPendingAction } from '../agent/model.js';

/**
 * Yes/no confirmations over WhatsApp, applied to the user's pending action.
 *
 * The rules that make a "sí" safe live in `confirmAction` (expiry, permission,
 * already processed). This module only picks the action and translates errors.
 */

export type Decision = 'yes' | 'no';

export interface DecisionCaller {
  userId: string;
  role: string;
  permissions: string[];
}

/** "sí" or "no", ignoring case, accents and final punctuation. Anything else is not a decision. */
export const parseDecision = (text: string): Decision | null => {
  const normalized = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/, '');
  if (normalized === 'si') return 'yes';
  if (normalized === 'no') return 'no';
  return null;
};

const NOTHING_PENDING_REPLY = 'No hay nada para confirmar.';

/**
 * Applies a decision to the caller's pending action and returns the reply.
 *
 * With nothing pending it says so and confirms nothing. With more than one live
 * pending action it confirms nothing either and lists them.
 */
export const handleDecision = async (caller: DecisionCaller, decision: Decision): Promise<string> => {
  const now = new Date();
  const pending = await AgentPendingAction.find({ userId: caller.userId, status: 'pending' }).sort({
    createdAt: -1
  });
  const live = pending.filter((action) => action.expiresAt > now);
  const candidates = live.length > 0 ? live : pending.slice(0, 1);
  const [only] = candidates;
  if (!only) return NOTHING_PENDING_REPLY;

  if (candidates.length > 1) {
    const list = candidates.map((action) => `- ${action.preview}`).join('\n');
    return `Tenés ${candidates.length} acciones pendientes y no confirmé ninguna. Revisalas en la app:\n${list}`;
  }

  const actionId = String(only._id);
  try {
    if (decision === 'no') {
      await cancelAction(caller.userId, actionId);
      return 'Acción cancelada.';
    }
    const view = await confirmAction(caller.userId, caller.role, caller.permissions, actionId);
    return view.resultSummary ?? 'Acción confirmada.';
  } catch (error) {
    if (error instanceof AppError) return error.message;
    throw error;
  }
};
