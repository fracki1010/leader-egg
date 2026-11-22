import { Types } from 'mongoose';
import { AppError } from '../../middleware/error-handler.js';
import {
  BusinessConfig,
  type IBusinessConfig,
  type OpeningBalancesSetAt
} from './model.js';
import type { SetPuntoCeroInput, UpdateBusinessProfileInput, UpdateOpeningBalancesInput } from './schema.js';
import { Product, displayName, type ProductCaliber, type ProductVariety } from '../products/model.js';import { Customer } from '../customers/model.js';
import { Supplier } from '../suppliers/model.js';
import { Inventory } from '../inventory/model.js';
import { StockTransaction } from '../inventory/transaction-model.js';



// ─── Singleton config ─────────────────────────────────────────────────────────

/**
 * Get-or-create the single BusinessConfig document. The collection starts
 * empty; the first read/write creates the doc with defaults (openingCash 0,
 * unfinalized). This mirrors the "findOne then create if missing" pattern so
 * the singleton survives across restarts without seeding.
 */
export const getOrCreateConfig = async (): Promise<IBusinessConfig> => {
  const existing = await BusinessConfig.findOne();
  if (existing) {
    return existing;
  }
  return BusinessConfig.create({});
};

// ─── Business profile (GET/PATCH /v1/setup/profile) ──────────────────────────

/** Public business identity stored on the singleton config. */
export interface BusinessProfile {
  businessName: string;
  address: string;
  phone: string;
}

/** Current business profile, with empty defaults before the tenant edits it. */
export const getBusinessProfile = async (): Promise<BusinessProfile> => {
  const config = await getOrCreateConfig();
  return {
    businessName: config.businessName ?? '',
    address: config.address ?? '',
    phone: config.phone ?? ''
  };
};

/**
 * Updates the business identity. Only the provided fields are overwritten;
 * every omitted field keeps its current value. `address`/`phone` accept an
 * empty string to clear them, while `businessName` is guaranteed non-empty by
 * the caller's schema.
 */
export const updateBusinessProfile = async (
  input: UpdateBusinessProfileInput
): Promise<BusinessProfile> => {
  const config = await getOrCreateConfig();

  if (input.businessName !== undefined) {
    config.businessName = input.businessName;
  }
  if (input.address !== undefined) {
    config.address = input.address;
  }
  if (input.phone !== undefined) {
    config.phone = input.phone;
  }

  await config.save();

  return {
    businessName: config.businessName ?? '',
    address: config.address ?? '',
    phone: config.phone ?? ''
  };
};

// ─── Opening-balance lock helpers ────────────────────────────────────────────

/** Accounts whose opening balance is loaded once (see `openingBalancesSetAt`). */
type OpeningAccount = 'cash' | 'mp' | 'bank';

const OPENING_ACCOUNTS: readonly OpeningAccount[] = ['cash', 'mp', 'bank'];

const OPENING_ACCOUNT_LABELS: Record<OpeningAccount, string> = {
  cash: 'Efectivo',
  mp: 'Mercado Pago',
  bank: 'Banco'
};

/** Fresh all-null lock state (used for legacy docs missing the field). */
const emptyOpeningSetAt = (): OpeningBalancesSetAt => ({ cash: null, mp: null, bank: null });

/** Reads the persisted lock state defensively (older docs may lack the field). */
const readOpeningSetAt = (config: IBusinessConfig): OpeningBalancesSetAt => ({
  cash: config.openingBalancesSetAt?.cash ?? null,
  mp: config.openingBalancesSetAt?.mp ?? null,
  bank: config.openingBalancesSetAt?.bank ?? null
});

/** DD/MM/YYYY for user-facing lock messages. */
const formatLockDate = (date: Date): string => {
  const value = new Date(date);
  const day = String(value.getDate()).padStart(2, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${value.getFullYear()}`;
};

/** 409 message shown to the tenant when a locked opening balance is changed. */
const openingLockedMessage = (account: OpeningAccount, lockedAt: Date): string =>
  `El saldo inicial de ${OPENING_ACCOUNT_LABELS[account]} ya fue cargado el ${formatLockDate(
    lockedAt
  )} y no se puede modificar`;

/** ISO string or null for the API response. */
const toIsoOrNull = (date: Date | null | undefined): string | null =>
  date ? new Date(date).toISOString() : null;

// ─── Read setup state (GET /v1/setup/punto-cero) ─────────────────────────────

export interface PuntoCeroDebtEntry {
  customerId: string;
  name: string;
  amount: number;
}

export interface PuntoCeroSupplierDebtEntry {
  supplierId: string;
  name: string;
  amount: number;
}

export interface PuntoCeroStockEntry {
  productId: string;
  name: string;
  quantity: number;
}

export interface PuntoCeroState {
  finalized: boolean;
  openingCash: number;
  openingBalances: { cash: number; mp: number; bank: number };
  /** Per-account one-time load timestamp (ISO) or null when still editable. */
  openingBalancesSetAt: { cash: string | null; mp: string | null; bank: string | null };
  clientDebts: PuntoCeroDebtEntry[];
  supplierDebts: PuntoCeroSupplierDebtEntry[];
  stock: PuntoCeroStockEntry[];
}

/**
 * Current setup state, defaulting to unfinalized / openingCash 0 before any
 * POST. Debts and stock are joined with names so the wizard can prefill.
 */
export const getPuntoCero = async (): Promise<PuntoCeroState> => {
  const config = await getOrCreateConfig();

  const [clientDebts, supplierDebts, stockRows] = await Promise.all([
    Customer.aggregate<PuntoCeroDebtEntry>([
      { $match: { openingDebt: { $gt: 0 } } },
      {
        $project: {
          _id: 0,
          customerId: { $toString: '$_id' },
          name: 1,
          amount: '$openingDebt'
        }
      },
      { $sort: { name: 1 } }
    ]),
    Supplier.aggregate<PuntoCeroSupplierDebtEntry>([
      { $match: { openingDebt: { $gt: 0 } } },
      {
        $project: {
          _id: 0,
          supplierId: { $toString: '$_id' },
          name: 1,
          amount: '$openingDebt'
        }
      },
      { $sort: { name: 1 } }
    ]),
    Inventory.aggregate<{
      productId: string;
      variety: ProductVariety;
      caliber: ProductCaliber;
      quantity: number;
    }>([
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $project: {
          _id: 0,
          productId: { $toString: '$productId' },
          variety: '$product.variety',
          caliber: '$product.caliber',
          quantity: 1
        }
      },
      { $sort: { variety: 1, caliber: 1 } }
    ])
  ]);

  const stock: PuntoCeroStockEntry[] = stockRows
    .map((row) => ({
      productId: row.productId,
      name: displayName({ variety: row.variety, caliber: row.caliber }),
      quantity: row.quantity
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const setAt = readOpeningSetAt(config);

  return {
    finalized: config.puntoCeroFinalized,
    openingCash: config.openingCash,
    openingBalances: {
      cash: config.openingBalances?.cash ?? config.openingCash ?? 0,
      mp: config.openingBalances?.mp ?? 0,
      bank: config.openingBalances?.bank ?? 0
    },
    openingBalancesSetAt: {
      cash: toIsoOrNull(setAt.cash),
      mp: toIsoOrNull(setAt.mp),
      bank: toIsoOrNull(setAt.bank)
    },
    clientDebts,
    supplierDebts,
    stock
  };
};

// ─── Opening-balance correction (PATCH /v1/setup/opening-balances) ───────────

/**
 * Loads the INITIAL per-account opening balances ("Cuentas de la Empresa").
 *
 * The opening balance is a one-time starting configuration, NOT a money
 * movement: day-to-day money corrections belong to the append-only
 * cash-adjustment ledger (`/v1/cash-adjustments`, POST).
 *
 * Each account becomes read-only the first time it is saved with a value > 0
 * (its `openingBalancesSetAt` timestamp is set). Re-saving the same value is
 * idempotent; changing a locked account fails with 409. Saving 0 does NOT lock
 * the account, so it can be filled later. Only a platform reset clears locks.
 *
 * Only the provided accounts are overwritten; every omitted account keeps its
 * current value. `openingCash` mirrors `openingBalances.cash` (legacy alias),
 * so it is updated whenever `cash` is provided.
 *
 * DELIBERATE DECISION: allowed EVEN when `puntoCeroFinalized` is true. The
 * one-time finalize gate blocks re-running setup (POST /punto-cero), but an
 * admin filling a still-unlocked account is not a new setup run. This endpoint
 * therefore neither throws nor flips/clears the finalized flag.
 */
export const updateOpeningBalances = async (
  input: UpdateOpeningBalancesInput
): Promise<PuntoCeroState> => {
  const config = await getOrCreateConfig();

  const current = config.openingBalances ?? { cash: 0, mp: 0, bank: 0 };
  const currentSetAt = readOpeningSetAt(config);
  const now = new Date();

  for (const account of OPENING_ACCOUNTS) {
    const incoming = input[account];
    if (incoming === undefined) continue;

    const lockedAt = currentSetAt[account];
    const persisted = current[account] ?? 0;
    if (lockedAt && incoming !== persisted) {
      throw new AppError(openingLockedMessage(account, lockedAt), 409);
    }
  }

  // Start from the persisted values and overwrite ONLY the provided accounts.
  const nextBalances = {
    cash: input.cash ?? current.cash ?? 0,
    mp: input.mp ?? current.mp ?? 0,
    bank: input.bank ?? current.bank ?? 0
  };
  config.openingBalances = nextBalances;

  // Lock every provided account loaded with a positive value (0 stays editable).
  const nextSetAt: OpeningBalancesSetAt = { ...currentSetAt };
  for (const account of OPENING_ACCOUNTS) {
    const incoming = input[account];
    if (incoming !== undefined && incoming > 0 && !nextSetAt[account]) {
      nextSetAt[account] = now;
    }
  }
  config.openingBalancesSetAt = nextSetAt;

  // Keep the legacy cash alias in sync when cash is edited.
  if (input.cash !== undefined) {
    config.openingCash = input.cash;
  }

  await config.save();

  return getPuntoCero();
};

// ─── One-time finalize (POST /v1/setup/punto-cero) ───────────────────────────

/** True when the id parses as a Mongo ObjectId. Invalid ids = not found (404). */
const isValidObjectId = (id: string): boolean => Types.ObjectId.isValid(id);

/** Options for {@link setPuntoCero}. */
export interface SetPuntoCeroOptions {
  /**
   * Explicit reset/correction: proceed EVEN when the setup is already finalized.
   *
   * The tenant-facing `POST /v1/setup/punto-cero` never sets this — punto cero
   * stays one-time for tenants. Only the platform (super admin) endpoints pass
   * `force: true`, and doing so OVERWRITES the opening balances with the
   * provided values, OVERWRITES the opening stock quantities via inventory
   * upserts, and OVERWRITES the customer/supplier opening debts. It also
   * APPENDS one more `opening` StockTransaction per stock item (the ledger is
   * append-only, so a forced re-run leaves the previous opening rows in place).
   */
  force?: boolean;
}

/**
 * Punto cero setup — sequential best-effort writes, `finalized` marked LAST
 * so a partial failure leaves the setup unfinalized and re-runnable.
 *
 * Order: (0) reject re-runs with 409 unless `options.force` · (1) enforce the
 * one-time opening-balance lock for accounts already loaded · (2) validate
 * every referenced product/customer/supplier EXISTS before writing anything ·
 * (3) upsert inventory + log one 'opening' transaction per stock item ·
 * (4) persist opening balances and lock every positive account · (5) set
 * customer openingDebt · (6) set supplier openingDebt · (7) mark finalized =
 * true + puntoCeroFinalizedAt = now.
 */
export const setPuntoCero = async (
  input: SetPuntoCeroInput,
  userId: string,
  options: SetPuntoCeroOptions = {}
): Promise<PuntoCeroState> => {
  const config = await getOrCreateConfig();

  if (config.puntoCeroFinalized && !options.force) {
    throw new AppError('Punto cero ya fue finalizado', 409);
  }

  const {
    stock = [],
    openingCash,
    clientDebts = [],
    supplierDebts = [],
    openingBalances
  } = input;

  // Resolve the final balances up front. Per-account values win over the
  // legacy openingCash alias; openingCash alone still sets cash.
  const persisted = config.openingBalances ?? { cash: 0, mp: 0, bank: 0 };
  const persistedSetAt = readOpeningSetAt(config);
  const cash = openingBalances?.cash ?? openingCash ?? persisted.cash ?? 0;
  const mp = openingBalances?.mp ?? persisted.mp ?? 0;
  const bank = openingBalances?.bank ?? persisted.bank ?? 0;
  const nextBalances = { cash, mp, bank };

  // 1. One-time lock: a locked account cannot be changed without `force`.
  // Checked BEFORE any write so a 409 leaves the setup untouched.
  if (!options.force) {
    for (const account of OPENING_ACCOUNTS) {
      const lockedAt = persistedSetAt[account];
      if (lockedAt && nextBalances[account] !== (persisted[account] ?? 0)) {
        throw new AppError(openingLockedMessage(account, lockedAt), 409);
      }
    }
  }

  // 2. Validate everything BEFORE writing — a 404 must leave nothing persisted.
  await validateReferences(stock, clientDebts, supplierDebts);

  // 3. Inventory upserts + 'opening' transactions (one per stock item).
  for (const item of stock) {
    const productId = item.productId;
    await Inventory.findOneAndUpdate(
      { productId },
      { productId: new Types.ObjectId(productId), quantity: item.quantity, lastUpdated: new Date() },
      { upsert: true, new: true }
    );

    await StockTransaction.create({
      productId: new Types.ObjectId(productId),
      type: 'opening',
      quantity: item.quantity,
      notes: 'Punto cero',
      createdBy: userId
    });
  }

  // 4. Opening balances on the singleton config. `openingCash` stays in sync as
  // the cash alias. Every positive account gets locked (force re-locks).
  config.openingBalances = nextBalances;
  config.openingCash = cash;

  const now = new Date();
  const nextSetAt: OpeningBalancesSetAt = { ...persistedSetAt };
  for (const account of OPENING_ACCOUNTS) {
    if (nextBalances[account] > 0) {
      if (options.force || !nextSetAt[account]) {
        nextSetAt[account] = now;
      }
    } else if (options.force) {
      // Forced reset with 0 leaves nothing to protect → editable again.
      nextSetAt[account] = null;
    }
  }
  config.openingBalancesSetAt = nextSetAt;
  await config.save();

  // 5. Client opening debts.
  for (const debt of clientDebts) {
    await Customer.updateOne({ _id: debt.customerId }, { openingDebt: debt.amount });
  }

  // 6. Supplier opening debts.
  for (const debt of supplierDebts) {
    await Supplier.updateOne({ _id: debt.supplierId }, { openingDebt: debt.amount });
  }

  // 7. Mark finalized LAST — partial failures above keep the setup re-runnable.
  config.puntoCeroFinalized = true;
  config.puntoCeroFinalizedAt = new Date();
  await config.save();

  return getPuntoCero();
};

/** Validates that every referenced product/customer/supplier exists. */
const validateReferences = async (
  stock: SetPuntoCeroInput['stock'],
  clientDebts: SetPuntoCeroInput['clientDebts'],
  supplierDebts: SetPuntoCeroInput['supplierDebts']
): Promise<void> => {
  const productIds = (stock ?? []).map((item) => item.productId);
  const customerIds = (clientDebts ?? []).map((debt) => debt.customerId);
  const supplierIds = (supplierDebts ?? []).map((debt) => debt.supplierId);

  if (productIds.length > 0) {
    const valid = productIds.filter(isValidObjectId);
    const found = await Product.countDocuments({ _id: { $in: valid } });
    if (found !== valid.length) {
      throw new AppError('Product not found', 404);
    }
  }

  if (customerIds.length > 0) {
    const valid = customerIds.filter(isValidObjectId);
    const found = await Customer.countDocuments({ _id: { $in: valid } });
    if (found !== valid.length) {
      throw new AppError('Customer not found', 404);
    }
  }

  if (supplierIds.length > 0) {
    const valid = supplierIds.filter(isValidObjectId);
    const found = await Supplier.countDocuments({ _id: { $in: valid } });
    if (found !== valid.length) {
      throw new AppError('Supplier not found', 404);
    }
  }
};

