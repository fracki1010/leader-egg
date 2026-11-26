import { AppError } from '../../middleware/error-handler.js';
import { User } from '../auth/model.js';
import { WhatsappAllowedNumber } from './model.js';
import { canonicalPhoneKey } from './phone.js';

const DUPLICATE_KEY = 11000;

const INVALID_PHONE = 'Ingresá un número de WhatsApp válido, con código de país';
const TAKEN_PHONE = 'Ese número ya está vinculado a otro usuario del negocio';

/**
 * Sets (or clears, with null) the WhatsApp number that the assistant answers as this user.
 * The new link is stored first: the unique phone index decides races, and a failed store
 * leaves the previous link untouched. Only then is the user's older link removed.
 */
export const setUserWhatsappPhone = async (userId: string, phone: string | null): Promise<string | null> => {
  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found', 404);

  if (phone === null) {
    await WhatsappAllowedNumber.deleteMany({ userId: user._id });
    return null;
  }

  const key = canonicalPhoneKey(phone);
  if (!key) throw new AppError(INVALID_PHONE, 400);

  const holder = await WhatsappAllowedNumber.findOne({ phone: key });
  if (holder && String(holder.userId) !== String(user._id)) {
    throw new AppError(TAKEN_PHONE, 409);
  }

  try {
    await WhatsappAllowedNumber.updateOne(
      { phone: key },
      { $set: { userId: user._id } },
      { upsert: true }
    );
  } catch (error) {
    // Another request linked the same number between the check and the store.
    if ((error as { code?: number }).code === DUPLICATE_KEY) throw new AppError(TAKEN_PHONE, 409);
    throw error;
  }

  await WhatsappAllowedNumber.deleteMany({ userId: user._id, phone: { $ne: key } });
  return key;
};

/** Linked number per user id, read in one query for the whole tenant (no per-user lookups). */
export const whatsappPhonesByUser = async (): Promise<Map<string, string>> => {
  const links = await WhatsappAllowedNumber.find({}, { phone: 1, userId: 1 }).lean();
  return new Map(links.map((link) => [String(link.userId), link.phone]));
};

/** Removes every number linked to a user. Used when the user is deleted. */
export const removeUserWhatsappLinks = async (userId: string): Promise<void> => {
  await WhatsappAllowedNumber.deleteMany({ userId });
};
