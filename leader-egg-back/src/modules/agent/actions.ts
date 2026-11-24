import { randomUUID } from 'node:crypto';
import { currentWhatsappChat } from './channel-context.js';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError, DuplicateRecordError, InsufficientStockError } from '../../middleware/error-handler.js';
import { hasPermission } from '../auth/permissions.js';
import { Customer } from '../customers/model.js';
import { createCustomerSchema } from '../customers/schema.js';
import { createCustomer } from '../customers/service.js';
import { getInventory } from '../inventory/service.js';
import { createOrderSchema } from '../orders/schema.js';
import { createOrder, getOrderById, listOrders, transitionOrderStatus } from '../orders/service.js';
import type { IOrder, OrderStatus } from '../orders/model.js';
import { createPaymentSchema } from '../payments/schema.js';
import { recordPayment } from '../payments/service.js';
import { Product, displayName } from '../products/model.js';
import { getActivePrice } from '../products/service.js';
import { PRODUCT_UNIT_ENUM, type ProductUnit } from '../products/units.js';
import { applyPromoPrice, resolveBestPromo } from '../promotions/service.js';
import {
  AgentMessage,
  AgentPendingAction,
  AgentToolCall,
  type AgentActionResultRef,
  type AgentPendingActionStatus,
  type AgentPendingActionType,
  type IAgentPendingAction
} from './model.js';

/**
 * Prepare → confirm flow for WRITE actions.
 *
 * The assistant can only PREPARE an action: it validates the args, re-checks the
 * caller's permission, resolves the entities read-only and stores a pending
 * action with a server-generated payload. Nothing is written until a human
 * explicitly confirms the action id. The client never sends the payload back.
 */

const ACTION_TTL_MS = 30 * 60 * 1000;
/** Permission re-checked at confirmation time, per action type. */
const ACTION_PERMISSION: Record<AgentPendingActionType, string> = {
  create_order: 'orders.manage',
  register_payment: 'orders.manage',
  create_customer: 'customers.manage',
  change_order_status: 'orders.manage',
  set_customer_location: 'customers.manage'
};

/** Bonus instruction always appended to a prepare response. */
export const PREPARE_INSTRUCTION = 'El usuario tiene que confirmarlo en la tarjeta.';

const round2 = (value: number): number => Math.round(value * 100) / 100;

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

/** ARS money label: $12.345 (no decimals unless the amount has cents). */
export const formatMoney = (value: number): string => `$${moneyFormatter.format(round2(value))}`;

const UNIT_LABELS: Record<ProductUnit, readonly [string, string]> = {
  maple: ['maple', 'maples'],
  medio_cajon: ['medio cajón', 'medios cajones'],
  cajon: ['cajón', 'cajones']
};

const unitLabel = (quantity: number, unit: ProductUnit): string => {
  const [singular, plural] = UNIT_LABELS[unit];
  return quantity === 1 ? singular : plural;
};

const METHOD_LABELS: Record<'cash' | 'transfer' | 'check', string> = {
  cash: 'efectivo',
  transfer: 'transferencia',
  check: 'cheque'
};

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  assigned: 'Asignado',
  in_transit: 'En tránsito',
  delivered: 'Entregado',
  cancelled: 'Cancelado'
};

/** Order statuses reachable through the assistant (forward-only progression). */
export const ORDER_STATUS_TARGET_ENUM = ['assigned', 'in_transit', 'delivered'] as const;
export type OrderStatusTarget = (typeof ORDER_STATUS_TARGET_ENUM)[number];

/**
 * Only the forward progression is exposed: no cancellation, no same-status
 * no-ops and no undoing a delivery. The value is the single legal target from
 * each current status.
 */
const FORWARD_STATUS_TARGET: Partial<Record<OrderStatus, OrderStatusTarget>> = {
  pending: 'assigned',
  assigned: 'in_transit',
  in_transit: 'delivered'
};

/** Forward index used to tell a backwards step from a skipped one. */
const STATUS_STEP: Record<OrderStatus, number> = {
  pending: 0,
  assigned: 1,
  in_transit: 2,
  delivered: 3,
  cancelled: 4
};

const objectIdSchema = z
  .string()
  .trim()
  .refine((value) => Types.ObjectId.isValid(value), 'Identificador inválido');

// ─── Prepare argument schemas ───────────────────────────────────────────────

export const prepareOrderArgsSchema = z.object({
  customerId: objectIdSchema,
  items: z
    .array(
      z.object({
        productId: objectIdSchema,
        quantity: z.coerce.number().int().positive('La cantidad debe ser mayor a 0'),
        unit: z.enum(PRODUCT_UNIT_ENUM).optional()
      })
    )
    .min(1, 'Se requiere al menos un ítem')
    .max(20, 'Máximo 20 ítems por pedido'),
  channel: z.enum(['phone', 'whatsapp', 'driver_visit', 'walk_in']).optional(),
  paymentPreference: z.enum(['cash', 'transfer', 'credit', 'cod', 'partial']).optional(),
  deliveryDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Se esperaba una fecha YYYY-MM-DD')
    .optional(),
  notes: z.string().trim().max(1000).optional()
});

export type PrepareOrderArgs = z.infer<typeof prepareOrderArgsSchema>;

export const preparePaymentArgsSchema = z.object({
  orderNumber: z.string().trim().min(1).max(60),
  amount: z.coerce.number().positive('El monto debe ser mayor a 0'),
  method: z.enum(['cash', 'transfer', 'check']).optional(),
  account: z.enum(['cash', 'mp', 'bank']).optional(),
  reference: z.string().trim().max(100).optional()
});

export type PreparePaymentArgs = z.infer<typeof preparePaymentArgsSchema>;

export const prepareCustomerArgsSchema = z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(['B2B', 'B2C']),
  phone: z.string().trim().min(1, 'El teléfono es obligatorio'),
  address: z.string().trim().min(1, 'La dirección es obligatoria'),
  email: z.string().trim().email().optional().or(z.literal('')),
  taxId: z.string().trim().max(30).optional(),
  creditLimit: z.coerce.number().min(0).optional(),
  termDays: z.coerce.number().int().min(0).optional()
});

export type PrepareCustomerArgs = z.infer<typeof prepareCustomerArgsSchema>;

export const prepareOrderStatusArgsSchema = z.object({
  orderNumber: z.string().trim().min(1).max(60),
  status: z.enum(ORDER_STATUS_TARGET_ENUM)
});

export type PrepareOrderStatusArgs = z.infer<typeof prepareOrderStatusArgsSchema>;

/** Payment payload at confirmation time: the payment fields plus its order. */
const preparedPaymentPayloadSchema = createPaymentSchema.extend({ orderId: objectIdSchema });

/** Order-status payload at confirmation time: the order plus its target status. */
const preparedOrderStatusPayloadSchema = z.object({
  orderId: objectIdSchema,
  status: z.enum(ORDER_STATUS_TARGET_ENUM)
});

// ─── Views ──────────────────────────────────────────────────────────────────

export interface AgentActionView {
  id: string;
  messageId: string;
  type: AgentPendingActionType;
  preview: string;
  status: AgentPendingActionStatus;
  resultSummary?: string;
  resultRef?: AgentActionResultRef;
  error?: string;
  createdAt: Date;
  expiresAt: Date;
  resolvedAt?: Date;
}

export const toActionView = (doc: IAgentPendingAction): AgentActionView => ({
  id: String(doc._id),
  messageId: String(doc.messageId),
  type: doc.type,
  preview: doc.preview,
  status: doc.status,
  resultSummary: doc.resultSummary,
  resultRef: doc.resultRef,
  error: doc.error,
  createdAt: doc.createdAt,
  expiresAt: doc.expiresAt,
  resolvedAt: doc.resolvedAt
});

export interface PreparedActionResponse {
  actionId: string;
  preview: string;
  expiresAt: string;
  instruction: string;
}

/** Context the prepare tools need to record the pending action. */
export interface PrepareActionContext {
  userId: string;
  conversationId: string;
  messageId: string;
}

const storePendingAction = async (
  ctx: PrepareActionContext,
  type: AgentPendingActionType,
  payload: Record<string, unknown>,
  preview: string
): Promise<PreparedActionResponse> => {
  const expiresAt = new Date(Date.now() + ACTION_TTL_MS);
  const action = await AgentPendingAction.create({
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    type,
    payload,
    preview,
    channelChatId: currentWhatsappChat(),
    status: 'pending',
    idempotencyKey: randomUUID(),
    expiresAt
  });

  return {
    actionId: String(action._id),
    preview,
    expiresAt: expiresAt.toISOString(),
    instruction: PREPARE_INSTRUCTION
  };
};

/** Human-readable reason for rejecting a non-forward status change. */
const buildStatusTransitionError = (order: IOrder, target: OrderStatusTarget): AppError => {
  const fromLabel = ORDER_STATUS_LABELS[order.status];
  const toLabel = ORDER_STATUS_LABELS[target];
  const prefix = `El pedido ${order.orderNumber}`;

  if (order.status === target) {
    return new AppError(`${prefix} ya está "${fromLabel}".`, 409);
  }

  if (order.status === 'cancelled') {
    return new AppError(`${prefix} está "${fromLabel}"; no se puede cambiar su estado.`, 409);
  }

  const currentStep = STATUS_STEP[order.status];
  const targetStep = STATUS_STEP[target];

  // Backwards step (e.g. en tránsito → asignado, entregado → en tránsito).
  if (targetStep < currentStep) {
    return new AppError(`${prefix} está "${fromLabel}"; no se puede volver a "${toLabel}".`, 409);
  }

  // Skipping one or more steps: name the immediate next step.
  const hint =
    order.status === 'pending'
      ? 'primero hay que asignarlo a un repartidor'
      : order.status === 'assigned'
        ? 'primero hay que ponerlo en tránsito'
        : 'primero hay que entregarlo';

  return new AppError(`${prefix} está "${fromLabel}"; ${hint}.`, 409);
};

/** Maples per product that a delivery would move, grouped from the order lines. */
const deliveryStockPlan = (order: IOrder): Map<string, { name: string; maples: number }> => {
  const plan = new Map<string, { name: string; maples: number }>();

  for (const item of order.items) {
    const key = item.productId.toString();
    const maples = item.mapleQty ?? item.quantity;
    const current = plan.get(key);
    if (current) {
      current.maples += maples;
    } else {
      plan.set(key, { name: item.productName, maples });
    }
  }

  return plan;
};

/**
 * Spanish preview of the stock a delivery will deduct, plus a warning for any
 * product that does not have enough stock (the confirmation would then fail).
 */
const buildDeliveryStockPreview = async (order: IOrder): Promise<string> => {
  const plan = deliveryStockPlan(order);
  if (plan.size === 0) {
    return '';
  }

  const ids = [...plan.keys()].filter((id) => Types.ObjectId.isValid(id));
  const products = await Product.find({ _id: { $in: ids } });
  const productMap = new Map(products.map((product) => [String(product._id), product]));

  // Prefer the current product label; fall back to the order-line snapshot.
  for (const [id, line] of plan) {
    const product = productMap.get(id);
    if (product) {
      line.name = displayName(product);
    }
  }

  const inventory = await getInventory();
  const availableByProduct = new Map<string, number>();
  for (const record of inventory) {
    const productId = record.productId as unknown as Types.ObjectId | { _id?: Types.ObjectId };
    const id = String((productId as { _id?: Types.ObjectId })._id ?? productId);
    availableByProduct.set(id, record.quantity);
  }

  const parts = [...plan.values()].map(
    (line) => `${line.maples} ${line.maples === 1 ? 'maple' : 'maples'} de ${line.name}`
  );
  const impact = `Se descontará stock: ${parts.join(', ')}.`;

  const warnings: string[] = [];
  for (const [id, line] of plan) {
    const available = availableByProduct.get(id) ?? 0;
    if (available < line.maples) {
      warnings.push(
        `⚠️ Stock insuficiente en ${line.name} (hay ${available}, se necesitan ${line.maples}); la confirmación va a fallar.`
      );
    }
  }

  return warnings.length > 0 ? `${impact} ${warnings.join(' ')}` : impact;
};

// ─── Prepare implementations (validate + resolve + preview only) ────────────

export const prepareOrderAction = async (
  args: PrepareOrderArgs,
  ctx: PrepareActionContext
): Promise<PreparedActionResponse> => {
  const customer = await Customer.findById(args.customerId);
  if (!customer) {
    throw new AppError('No se encontró el cliente indicado', 404);
  }
  if (customer.status !== 'active') {
    throw new AppError('El cliente está inactivo y no puede recibir pedidos', 409);
  }

  const descriptions: string[] = [];
  let estimatedTotal = 0;

  for (const item of args.items) {
    const product = await Product.findById(item.productId);
    if (!product) {
      throw new AppError('No se encontró uno de los productos indicados', 404);
    }

    const unit = item.unit ?? 'maple';
    const priceEntry = await getActivePrice(item.productId, unit);
    const promo = await resolveBestPromo(item.productId, unit, item.quantity);
    const subtotal = promo
      ? applyPromoPrice(priceEntry.price, promo, item.quantity).subtotal
      : round2(priceEntry.price * item.quantity);

    estimatedTotal += subtotal;
    descriptions.push(`${item.quantity} ${unitLabel(item.quantity, unit)} ${displayName(product)}`);
  }

  estimatedTotal = round2(estimatedTotal);

  const payload: Record<string, unknown> = {
    customerId: args.customerId,
    channel: args.channel ?? 'phone',
    items: args.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unit: item.unit ?? 'maple'
    })),
    ...(args.paymentPreference ? { paymentPreference: args.paymentPreference } : {}),
    ...(args.deliveryDate ? { deliveryDate: args.deliveryDate } : {}),
    ...(args.notes ? { deliveryNotes: args.notes } : {})
  };

  // Guard: only an input the real service accepts is ever stored.
  if (!createOrderSchema.safeParse(payload).success) {
    throw new AppError('Los datos del pedido no son válidos', 400);
  }

  const preview = `Pedido para ${customer.name}: ${descriptions.join(' + ')}. Total estimado ${formatMoney(estimatedTotal)} (puede variar por promociones o stock). Se creará como pendiente de entrega.`;

  return storePendingAction(ctx, 'create_order', payload, preview);
};

export const preparePaymentAction = async (
  args: PreparePaymentArgs,
  ctx: PrepareActionContext
): Promise<PreparedActionResponse> => {
  const found = await listOrders({ search: args.orderNumber, limit: 5 });
  const normalized = args.orderNumber.trim().toLowerCase();
  const match =
    found.items.find((order) => order.orderNumber.toLowerCase() === normalized) ?? found.items[0];

  if (!match) {
    throw new AppError(`No se encontró la orden ${args.orderNumber}`, 404);
  }

  const order = await getOrderById(String(match._id));
  if (order.status === 'cancelled') {
    throw new AppError('No se puede registrar un pago en un pedido cancelado', 409);
  }

  const method = args.method ?? 'cash';
  const remaining = round2(order.balance - args.amount);
  const warning =
    args.amount > order.balance ? ' El monto supera el saldo; la confirmación puede rechazarse.' : '';

  const preview = `Registrar pago de ${formatMoney(args.amount)} en ${METHOD_LABELS[method]} al pedido ${order.orderNumber} de ${order.customerName}. Saldo actual ${formatMoney(order.balance)} → quedará ${formatMoney(remaining)}.${warning}`;

  const payload: Record<string, unknown> = {
    orderId: String(order._id),
    amount: args.amount,
    method,
    ...(args.account ? { account: args.account } : {}),
    ...(args.reference ? { reference: args.reference } : {})
  };

  if (!preparedPaymentPayloadSchema.safeParse(payload).success) {
    throw new AppError('Los datos del pago no son válidos', 400);
  }

  return storePendingAction(ctx, 'register_payment', payload, preview);
};

export const prepareOrderStatusAction = async (
  args: PrepareOrderStatusArgs,
  ctx: PrepareActionContext
): Promise<PreparedActionResponse> => {
  const found = await listOrders({ search: args.orderNumber, limit: 5 });
  const normalized = args.orderNumber.trim().toLowerCase();
  const match =
    found.items.find((order) => order.orderNumber.toLowerCase() === normalized) ?? found.items[0];

  if (!match) {
    throw new AppError(`No se encontró la orden ${args.orderNumber}`, 404);
  }

  const order = await getOrderById(String(match._id));

  // Forward-only: the target must be the ONE legal next step from this status.
  if (FORWARD_STATUS_TARGET[order.status] !== args.status) {
    throw buildStatusTransitionError(order, args.status);
  }

  const fromLabel = ORDER_STATUS_LABELS[order.status];
  const toLabel = ORDER_STATUS_LABELS[args.status];
  let preview = `Cambiar el pedido ${order.orderNumber} de ${order.customerName} de "${fromLabel}" a "${toLabel}".`;

  // Delivering moves stock: show the impact (and any shortage) before the human
  // confirms. The dry-run is read-only; the confirm still re-checks atomically.
  if (args.status === 'delivered') {
    const stockPreview = await buildDeliveryStockPreview(order);
    if (stockPreview) {
      preview += ` ${stockPreview}`;
    }
  }

  const payload: Record<string, unknown> = {
    orderId: String(order._id),
    status: args.status
  };

  if (!preparedOrderStatusPayloadSchema.safeParse(payload).success) {
    throw new AppError('Los datos del cambio de estado no son válidos', 400);
  }

  return storePendingAction(ctx, 'change_order_status', payload, preview);
};

export const prepareCustomerAction = async (
  args: PrepareCustomerArgs,
  ctx: PrepareActionContext
): Promise<PreparedActionResponse> => {
  const payload: Record<string, unknown> = {
    name: args.name,
    type: args.type,
    phone: args.phone,
    address: args.address,
    ...(args.email ? { email: args.email } : {}),
    ...(args.taxId ? { taxId: args.taxId } : {}),
    ...(args.creditLimit !== undefined || args.termDays !== undefined
      ? { creditConfig: { limit: args.creditLimit ?? 0, termDays: args.termDays ?? 0 } }
      : {})
  };

  const parsed = createCustomerSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError('Los datos del cliente no son válidos', 400);
  }
  const customerInput = parsed.data;
  const creditNote =
    customerInput.creditConfig && customerInput.creditConfig.limit > 0
      ? ` Límite de crédito ${formatMoney(customerInput.creditConfig.limit)}${
          customerInput.creditConfig.termDays > 0
            ? ` a ${customerInput.creditConfig.termDays} días`
            : ''
        }.`
      : '';

  const preview = `Crear cliente ${customerInput.name} (${customerInput.type}) — ${customerInput.phone}, ${customerInput.address}.${creditNote}`;

  return storePendingAction(ctx, 'create_customer', payload, preview);
};

export const prepareCustomerLocationArgsSchema = z.object({
  customerName: z.string().trim().min(2).max(100),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});
export type PrepareCustomerLocationArgs = z.infer<typeof prepareCustomerLocationArgsSchema>;

/** The payload stored by prepareCustomerLocationAction, re-checked before it is written. */
const storedCustomerLocationPayloadSchema = z.object({
  customerId: z.string().regex(/^[a-f0-9]{24}$/),
  location: z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
  })
});

/**
 * Prepares saving a location on an existing customer, found by exact name
 * (case-insensitive) inside the caller's tenant. Nothing is written until the
 * user confirms the card.
 */
export const prepareCustomerLocationAction = async (
  args: PrepareCustomerLocationArgs,
  ctx: PrepareActionContext
): Promise<PreparedActionResponse> => {
  const escaped = args.customerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = await Customer.find({ name: new RegExp(`^${escaped}$`, 'i') })
    .limit(2)
    .select('name');

  if (matches.length > 1) {
    throw new AppError('Hay más de un cliente con ese nombre. Indicá cuál.', 409);
  }
  const customer = matches[0];
  if (!customer) {
    throw new AppError('No encontré un cliente con ese nombre', 404);
  }

  const payload = {
    customerId: String(customer._id),
    customerName: customer.name,
    location: { type: 'Point', coordinates: [args.lng, args.lat] }
  };
  const preview = `Guardar la ubicación de ${customer.name} (${args.lat.toFixed(5)}, ${args.lng.toFixed(5)}).`;

  return storePendingAction(ctx, 'set_customer_location', payload, preview);
};

// ─── Read / confirm / cancel ────────────────────────────────────────────────

export const getAction = async (userId: string, actionId: string): Promise<AgentActionView> => {
  if (!Types.ObjectId.isValid(actionId)) {
    throw new AppError('Acción no encontrada', 404);
  }

  const action = await AgentPendingAction.findOne({ _id: actionId, userId });
  if (!action) {
    throw new AppError('Acción no encontrada', 404);
  }
  return toActionView(action);
};

export const cancelAction = async (userId: string, actionId: string): Promise<AgentActionView> => {
  if (!Types.ObjectId.isValid(actionId)) {
    throw new AppError('Acción no encontrada', 404);
  }

  const cancelled = await AgentPendingAction.findOneAndUpdate(
    { _id: actionId, userId, status: 'pending' },
    { $set: { status: 'cancelled', resolvedAt: new Date() } },
    { new: true }
  );

  if (cancelled) {
    return toActionView(cancelled);
  }

  const existing = await AgentPendingAction.findOne({ _id: actionId, userId });
  if (!existing) {
    throw new AppError('Acción no encontrada', 404);
  }
  throw new AppError('La acción ya fue procesada', 409);
};

interface ExecuteActionContext {
  userId: string;
  role: string;
}

interface ExecutionResult {
  resultSummary: string;
  resultRef: AgentActionResultRef;
  message: string;
}

/**
 * Executes an already-claimed action. The payload always comes from the stored
 * document and is re-validated here — the client only ever sent the action id.
 */
const executePendingAction = async (
  action: IAgentPendingAction,
  ctx: ExecuteActionContext
): Promise<ExecutionResult> => {
  switch (action.type) {
    case 'create_order': {
      const parsed = createOrderSchema.safeParse(action.payload);
      if (!parsed.success) {
        throw new AppError('Los datos guardados de la acción ya no son válidos', 400);
      }

      let order: IOrder;
      try {
        order = await createOrder(parsed.data, { userId: ctx.userId, role: ctx.role });
      } catch (error) {
        if (error instanceof DuplicateRecordError) {
          throw new AppError('Ya existe un pedido idéntico reciente', 409);
        }
        throw error;
      }

      return {
        resultSummary: `Pedido ${order.orderNumber} creado por ${formatMoney(order.totalAmount)}`,
        resultRef: { entity: 'order', id: String(order._id), label: order.orderNumber },
        message: `✅ Pedido ${order.orderNumber} creado por ${formatMoney(order.totalAmount)}.`
      };
    }

    case 'register_payment': {
      const parsed = preparedPaymentPayloadSchema.safeParse(action.payload);
      if (!parsed.success) {
        throw new AppError('Los datos guardados de la acción ya no son válidos', 400);
      }

      const { orderId, ...paymentInput } = parsed.data;
      const payment = await recordPayment(orderId, paymentInput);
      const order = await getOrderById(orderId);

      return {
        resultSummary: `Pago de ${formatMoney(payment.amount)} registrado en el pedido ${order.orderNumber}`,
        resultRef: { entity: 'payment', id: String(payment._id), label: order.orderNumber },
        message: `✅ Pago de ${formatMoney(payment.amount)} registrado en el pedido ${order.orderNumber}.`
      };
    }

    case 'change_order_status': {
      const parsed = preparedOrderStatusPayloadSchema.safeParse(action.payload);
      if (!parsed.success) {
        throw new AppError('Los datos guardados de la acción ya no son válidos', 400);
      }

      let order: IOrder;
      try {
        // Reuses the single source of truth for the state machine and all the
        // stock/money side effects — nothing is duplicated here.
        order = await transitionOrderStatus(parsed.data.orderId, parsed.data.status, {
          userId: ctx.userId,
          role: ctx.role
        });
      } catch (error) {
        if (error instanceof InsufficientStockError) {
          const product = await Product.findById(error.productId);
          const name = product ? displayName(product) : 'un producto del pedido';
          throw new AppError(
            `Stock insuficiente en ${name}: hay ${error.available}, se necesitan ${error.required}.`,
            409
          );
        }
        if (
          error instanceof AppError &&
          error.status === 409 &&
          error.message.startsWith('Invalid status transition')
        ) {
          // The order moved between prepare and confirm: report it in Spanish.
          throw new AppError('El pedido cambió de estado y ya no se puede aplicar esta acción.', 409);
        }
        throw error;
      }

      const toLabel = ORDER_STATUS_LABELS[order.status];

      return {
        resultSummary: `Pedido ${order.orderNumber} ahora está ${toLabel}`,
        resultRef: { entity: 'order', id: String(order._id), label: order.orderNumber },
        message: `✅ Pedido ${order.orderNumber} ahora está ${toLabel}.`
      };
    }

    case 'create_customer': {
      const parsed = createCustomerSchema.safeParse(action.payload);
      if (!parsed.success) {
        throw new AppError('Los datos guardados de la acción ya no son válidos', 400);
      }

      const customer = await createCustomer(parsed.data);
      return {
        resultSummary: `Cliente ${customer.name} creado`,
        resultRef: { entity: 'customer', id: String(customer._id), label: customer.name },
        message: `✅ Cliente ${customer.name} creado.`
      };
    }
    case 'set_customer_location': {
      const parsed = storedCustomerLocationPayloadSchema.safeParse(action.payload);
      if (!parsed.success) {
        throw new AppError('Los datos guardados de la acción ya no son válidos', 400);
      }
      const { customerId, location } = parsed.data;
      const customer = await Customer.findByIdAndUpdate(
        customerId,
        { $set: { location } },
        { new: true }
      );
      if (!customer) {
        throw new AppError('El cliente ya no existe', 404);
      }
      return {
        resultSummary: `Ubicación de ${customer.name} guardada`,
        resultRef: { entity: 'customer', id: String(customer._id), label: customer.name },
        message: `✅ Ubicación de ${customer.name} guardada.`
      };
    }
  }
};

/**
 * Confirms and executes a pending action EXACTLY once.
 *
 * The action is atomically claimed (`pending` → `executing`) before anything
 * runs, so two concurrent confirms can never both execute. Every attempt is
 * audited in `AgentToolCall` as `confirm_action`.
 */
export const confirmAction = async (
  userId: string,
  role: string,
  permissions: string[],
  actionId: string
): Promise<AgentActionView> => {
  const startedAt = Date.now();
  let action: IAgentPendingAction | null = null;

  const audit = async (ok: boolean, error?: string): Promise<void> => {
    try {
      await AgentToolCall.create({
        userId,
        messageId: action?.messageId,
        tool: 'confirm_action',
        args: { actionId, type: action?.type ?? 'unknown' },
        ok,
        error,
        durationMs: Date.now() - startedAt
      });
    } catch {
      // Auditing must never mask the real outcome.
    }
  };

  try {
    if (!Types.ObjectId.isValid(actionId)) {
      throw new AppError('Acción no encontrada', 404);
    }

    const now = new Date();
    action = await AgentPendingAction.findOneAndUpdate(
      { _id: actionId, userId, status: 'pending', expiresAt: { $gt: now } },
      { $set: { status: 'executing' } },
      { new: true }
    );

    if (!action) {
      const existing = await AgentPendingAction.findOne({ _id: actionId, userId });
      if (!existing) {
        throw new AppError('Acción no encontrada', 404);
      }
      // Keep the type available for the audit trail on non-executable actions.
      action = existing;
      if (existing.status === 'pending' && existing.expiresAt.getTime() <= now.getTime()) {
        await AgentPendingAction.updateOne(
          { _id: existing._id, status: 'pending' },
          { $set: { status: 'expired', resolvedAt: new Date() } }
        );
        throw new AppError('La acción expiró', 410);
      }
      throw new AppError('La acción ya fue procesada', 409);
    }

    if (!hasPermission(permissions, ACTION_PERMISSION[action.type])) {
      throw new AppError('Sin permiso para ejecutar esta acción', 403);
    }

    const execution = await executePendingAction(action, { userId, role });
    const resolvedAt = new Date();

    await AgentPendingAction.updateOne(
      { _id: action._id, status: 'executing' },
      {
        $set: {
          status: 'confirmed',
          resolvedAt,
          resultSummary: execution.resultSummary,
          resultRef: execution.resultRef
        }
      }
    );

    // Append the result to the conversation so the next turn has context.
    await AgentMessage.create({
      conversationId: action.conversationId,
      userId: action.userId,
      role: 'assistant',
      content: execution.message
    });

    const confirmed = await AgentPendingAction.findById(action._id);
    await audit(true);
    return toActionView(confirmed ?? action);
  } catch (error) {
    const isAppError = error instanceof AppError;
    const message = isAppError ? error.message : 'La acción no se pudo ejecutar';
    const status = isAppError ? error.status : 500;

    if (action) {
      await AgentPendingAction.updateOne(
        { _id: action._id, status: 'executing' },
        { $set: { status: 'failed', error: message, resolvedAt: new Date() } }
      );
    }

    await audit(false, message);
    throw isAppError ? error : new AppError(message, status);
  }
};
