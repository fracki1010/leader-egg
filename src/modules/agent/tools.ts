import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../middleware/error-handler.js';
import { hasPermission } from '../auth/permissions.js';
import { getDashboardSummary, getAlerts, getSaldos } from '../dashboard/service.js';
import { getAgingReport, getProfitReport, getRevenueReport } from '../reports/service.js';
import { getOrderById, listOrders } from '../orders/service.js';
import { queryCustomers, getCustomerSummary, listCustomerOrders } from '../customers/service.js';
import { getInventory } from '../inventory/service.js';
import { Product, displayName } from '../products/model.js';
import { toCalendarDateString } from '../../utils/calendar-day.js';
import {
  prepareCustomerAction,
  prepareCustomerArgsSchema,
  prepareOrderAction,
  prepareOrderArgsSchema,
  prepareOrderStatusAction,
  prepareOrderStatusArgsSchema,
  preparePaymentAction,
  preparePaymentArgsSchema,
  type PrepareCustomerArgs,
  type PrepareOrderArgs,
  type PrepareOrderStatusArgs,
  type PreparePaymentArgs
} from './actions.js';
import type { ProviderToolDefinition } from './provider.js';

/**
 * Tool catalog exposed to the assistant.
 *
 * READ tools (Phase 1) only read existing services. PREPARE tools (Phase 2)
 * validate, re-check permission and resolve entities read-only, then store a
 * pending action — they NEVER create anything. A human has to confirm the
 * action through the confirmation API for the write to happen.
 */

export interface AgentToolContext {
  userId: string;
  permissions: string[];
  userName: string;
  /** Conversation of the current turn (pending actions are scoped to it). */
  conversationId: string;
  /** Assistant message of the current turn (reserved before the loop). */
  messageId: string;
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema for the OpenAI-compatible tools payload. */
  parameters: Record<string, unknown>;
  /** Permission required to execute this tool. */
  permission: string;
  /** Human topic used in the denial message: "Sin permiso para consultar <topic>". */
  topic: string;
  /** Label used as the compact tool-call summary on success. */
  label: string;
  /** Runtime validation of the model-supplied args. */
  schema: z.ZodTypeAny;
  execute: (args: unknown, ctx: AgentToolContext) => Promise<unknown>;
}

export interface ToolExecution {
  tool: string;
  ok: boolean;
  /** Serialized result fed back to the model as the `tool` message. */
  content: string;
  /** Compact summary persisted on the assistant message. */
  summary: string;
  /** Internal error detail for the audit trail (never sent to the model). */
  error?: string;
  durationMs: number;
}

const MAX_RESULT_CHARS = 6000;
const BUSINESS_TIMEZONE = 'America/Argentina/Buenos_Aires';

const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Se esperaba una fecha YYYY-MM-DD');

const objectIdSchema = z
  .string()
  .trim()
  .refine((value) => Types.ObjectId.isValid(value), 'Identificador inválido');

/** Today's calendar date (YYYY-MM-DD) in the business timezone. */
const businessToday = (): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${pick('year')}-${pick('month')}-${pick('day')}`;
};

/** Resolves an optional start/end pair to concrete date-only strings. */
const resolveDateRange = (args: { startDate?: string; endDate?: string }): { start: string; end: string } => {
  const today = businessToday();
  const start = args.startDate ?? today;
  const end = args.endDate ?? args.startDate ?? today;
  return { start, end };
};

/** Date-only string for a stored business date (falls back to createdAt). */
const orderDateString = (order: { orderDate?: Date | null; createdAt?: Date | null }): string | null => {
  const value = order.orderDate ?? order.createdAt ?? null;
  return value ? toCalendarDateString(value) : null;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

// ─── Tool implementations ───────────────────────────────────────────────────

const getDashboardOverview: AgentTool = {
  name: 'get_dashboard_overview',
  description:
    'Devuelve el resumen general del negocio (caja, ventas y cobros de hoy, deuda por cobrar, entregas y stock) y las alertas activas.',
  permission: 'reports.view',
  topic: 'el resumen general',
  label: 'Resumen general consultado',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  schema: z.object({}),
  execute: async () => {
    const [summary, alerts] = await Promise.all([getDashboardSummary(), getAlerts()]);
    return {
      caja: summary.caja,
      cajaHoy: summary.cajaHoy,
      saldos: summary.saldos,
      ventasHoy: summary.ventasHoy,
      cobradoHoy: summary.cobradoHoy,
      porCobrar: summary.porCobrar,
      clientesDeudores: summary.clientesDeudores,
      vencidas: summary.vencidas,
      entregasHoy: summary.entregasHoy,
      pendientesHoy: summary.pendientesHoy,
      totalStockValue: summary.totalStockValue,
      topDeudores: summary.deudas.slice(0, 10),
      alerts
    };
  }
};

const getSalesReport: AgentTool = {
  name: 'get_sales_report',
  description:
    'Reporte de ventas de un período (facturación de órdenes entregadas, con desglose por producto, cliente y medio de pago). Si no se pasan fechas, usa el día de hoy.',
  permission: 'reports.view',
  topic: 'las ventas',
  label: 'Reporte de ventas consultado',
  parameters: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: 'Fecha inicial YYYY-MM-DD (opcional)' },
      endDate: { type: 'string', description: 'Fecha final YYYY-MM-DD (opcional)' }
    },
    additionalProperties: false
  },
  schema: z.object({ startDate: dateOnlySchema.optional(), endDate: dateOnlySchema.optional() }),
  execute: async (rawArgs) => {
    const args = rawArgs as { startDate?: string; endDate?: string };
    const { start, end } = resolveDateRange(args);
    const report = await getRevenueReport(start, end);
    return {
      startDate: report.startDate,
      endDate: report.endDate,
      totalRevenue: round2(report.totalRevenue),
      orderCount: report.orderCount,
      byProduct: report.breakdown.byProduct.slice(0, 10),
      byCustomer: report.breakdown.byCustomer.slice(0, 5),
      byPaymentMethod: report.breakdown.byPaymentMethod
    };
  }
};

const getProfitReportTool: AgentTool = {
  name: 'get_profit_report',
  description:
    'Reporte de rentabilidad de un período: ingresos, cobrado, pendiente, costo de mercadería, gastos, ganancia y margen, más el detalle diario. Si no se pasan fechas, usa el día de hoy.',
  permission: 'reports.view',
  topic: 'la rentabilidad',
  label: 'Reporte de rentabilidad consultado',
  parameters: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: 'Fecha inicial YYYY-MM-DD (opcional)' },
      endDate: { type: 'string', description: 'Fecha final YYYY-MM-DD (opcional)' }
    },
    additionalProperties: false
  },
  schema: z.object({ startDate: dateOnlySchema.optional(), endDate: dateOnlySchema.optional() }),
  execute: async (rawArgs) => {
    const args = rawArgs as { startDate?: string; endDate?: string };
    const { start, end } = resolveDateRange(args);
    const report = await getProfitReport(start, end);
    return {
      startDate: start,
      endDate: end,
      revenue: round2(report.revenue),
      collected: round2(report.collected),
      pendingCollection: round2(report.pendingCollection),
      cogs: round2(report.cogs),
      expenses: round2(report.expenses),
      profit: round2(report.profit),
      margin: report.margin,
      partialCOGS: report.partialCOGS,
      receivable: report.receivable,
      byDay: report.byDay.slice(-31)
    };
  }
};

const getReceivables: AgentTool = {
  name: 'get_receivables',
  description: 'Antigüedad de la deuda VENCIDA por tramos (1-30, 31-60, 61-90, 90+ días) y total vencido. NO es la deuda total: para "cuánto me deben" o "quién debe más" usá get_debtors.',
  permission: 'reports.view',
  topic: 'las cuentas por cobrar',
  label: 'Cuentas por cobrar consultadas',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  schema: z.object({}),
  execute: async () => {
    const report = await getAgingReport();
    return {
      buckets: report.buckets.map((bucket) => ({
        label: bucket.label,
        count: bucket.count,
        totalAmount: round2(bucket.totalAmount)
      })),
      totalOverdue: round2(report.totalOverdue)
    };
  }
};

const getDebtors: AgentTool = {
  name: 'get_debtors',
  description:
    'Deuda TOTAL por cobrar (no solo vencida): monto total, cantidad de clientes deudores, top 10 deudores y total vencido. Usala para "cuánto me deben" o "quién debe más".',
  permission: 'reports.view',
  topic: 'los deudores',
  label: 'Deudores consultados',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  schema: z.object({}),
  execute: async () => {
    const summary = await getDashboardSummary();
    return {
      totalOutstanding: round2(summary.porCobrar),
      debtorCount: summary.clientesDeudores,
      overdue: {
        count: summary.vencidas.count,
        totalAmount: round2(summary.vencidas.total)
      },
      topDebtors: summary.deudas.slice(0, 10)
    };
  }
};

const listOrdersTool: AgentTool = {
  name: 'list_orders',
  description:
    'Lista órdenes con filtros opcionales por estado, rango de fechas y cliente. Devuelve campos compactos (número, fecha, cliente, estado, total y saldo).',
  permission: 'orders.view',
  topic: 'las órdenes',
  label: 'Órdenes consultadas',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['pending', 'assigned', 'in_transit', 'delivered', 'cancelled'],
        description: 'Estado de la orden (opcional)'
      },
      startDate: { type: 'string', description: 'Fecha inicial YYYY-MM-DD (opcional)' },
      endDate: { type: 'string', description: 'Fecha final YYYY-MM-DD (opcional)' },
      customerId: { type: 'string', description: 'Identificador del cliente (opcional)' },
      limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Máximo de órdenes (por defecto 10)' }
    },
    additionalProperties: false
  },
  schema: z.object({
    status: z.enum(['pending', 'assigned', 'in_transit', 'delivered', 'cancelled']).optional(),
    startDate: dateOnlySchema.optional(),
    endDate: dateOnlySchema.optional(),
    customerId: objectIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(20).default(10)
  }),
  execute: async (rawArgs) => {
    const args = rawArgs as {
      status?: 'pending' | 'assigned' | 'in_transit' | 'delivered' | 'cancelled';
      startDate?: string;
      endDate?: string;
      customerId?: string;
      limit: number;
    };

    const result = await listOrders({
      status: args.status,
      customerId: args.customerId,
      from: args.startDate ? new Date(args.startDate) : undefined,
      to: args.endDate ? new Date(args.endDate) : undefined,
      limit: args.limit
    });

    return {
      total: result.total,
      orders: result.items.map((order) => ({
        id: String(order._id),
        orderNumber: order.orderNumber,
        date: orderDateString(order),
        customerName: order.customerName,
        status: order.status,
        paymentStatus: order.paymentStatus,
        totalAmount: round2(order.totalAmount),
        balance: round2(order.balance)
      }))
    };
  }
};

const getOrderTool: AgentTool = {
  name: 'get_order',
  description: 'Devuelve el detalle de una orden por su número (ej. "ORD-00042"), incluyendo ítems, totales y saldo.',
  permission: 'orders.view',
  topic: 'las órdenes',
  label: 'Orden consultada',
  parameters: {
    type: 'object',
    properties: {
      orderNumber: { type: 'string', description: 'Número de orden exacto o parcial' }
    },
    required: ['orderNumber'],
    additionalProperties: false
  },
  schema: z.object({ orderNumber: z.string().trim().min(1).max(60) }),
  execute: async (rawArgs) => {
    const { orderNumber } = rawArgs as { orderNumber: string };
    const found = await listOrders({ search: orderNumber, limit: 5 });
    const normalized = orderNumber.trim().toLowerCase();
    const match =
      found.items.find((order) => order.orderNumber.toLowerCase() === normalized) ?? found.items[0];

    if (!match) {
      return { error: `No se encontró la orden ${orderNumber}` };
    }

    const order = await getOrderById(String(match._id));
    return {
      id: String(order._id),
      orderNumber: order.orderNumber,
      date: orderDateString(order),
      customerName: order.customerName,
      status: order.status,
      paymentStatus: order.paymentStatus,
      totalAmount: round2(order.totalAmount),
      paidAmount: round2(order.paidAmount),
      balance: round2(order.balance),
      dueDate: order.dueDate ? toCalendarDateString(order.dueDate) : null,
      items: order.items.slice(0, 30).map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: round2(item.unitPrice),
        subtotal: round2(item.subtotal)
      }))
    };
  }
};

const listStockTool: AgentTool = {
  name: 'list_stock',
  description:
    'Lista el stock por producto. La cantidad SIEMPRE está en MAPLES (quantityMaples); maplesPerCajon permite convertir. Con lowOnly=true devuelve sólo los productos bajo el umbral.',
  permission: 'stock.view',
  topic: 'el stock',
  label: 'Stock consultado',
  parameters: {
    type: 'object',
    properties: {
      lowOnly: { type: 'boolean', description: 'Sólo productos bajo el umbral (opcional)' },
      limit: { type: 'integer', minimum: 1, maximum: 40, description: 'Máximo de productos (por defecto 20)' }
    },
    additionalProperties: false
  },
  schema: z.object({
    lowOnly: z.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(40).default(20)
  }),
  execute: async (rawArgs) => {
    const args = rawArgs as { lowOnly?: boolean; limit: number };
    const inventory = await getInventory();

    const productIds = inventory.map((record) => {
      const productId = record.productId as unknown as Types.ObjectId | { _id?: Types.ObjectId };
      return String((productId as { _id?: Types.ObjectId })._id ?? productId);
    });

    const products = await Product.find({
      _id: { $in: productIds.filter((id) => Types.ObjectId.isValid(id)) }
    });
    const productMap = new Map(products.map((product) => [String(product._id), product]));

    const rows = inventory.map((record) => {
      const productId = record.productId as unknown as Types.ObjectId | { _id?: Types.ObjectId };
      const id = String((productId as { _id?: Types.ObjectId })._id ?? productId);
      const product = productMap.get(id);
      const threshold = product?.lowStockThreshold ?? 0;

      return {
        productId: id,
        name: product ? displayName(product) : 'Producto',
        unit: 'maples',
        quantityMaples: record.quantity,
        maplesPerCajon: product?.maplesPerCajon ?? null,
        lowStockThreshold: threshold,
        isLow: record.quantity < threshold
      };
    });

    const filtered = args.lowOnly ? rows.filter((row) => row.isLow) : rows;
    return { count: filtered.length, products: filtered.slice(0, args.limit) };
  }
};

const findCustomersTool: AgentTool = {
  name: 'find_customers',
  description: 'Busca clientes por nombre, teléfono o CUIT. Devuelve datos de contacto compactos.',
  permission: 'customers.view',
  topic: 'los clientes',
  label: 'Clientes consultados',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Texto a buscar (nombre, teléfono o CUIT)' },
      limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Máximo de resultados (por defecto 10)' }
    },
    required: ['query'],
    additionalProperties: false
  },
  schema: z.object({
    query: z.string().trim().min(1).max(120),
    limit: z.coerce.number().int().min(1).max(20).default(10)
  }),
  execute: async (rawArgs) => {
    const args = rawArgs as { query: string; limit: number };
    const result = await queryCustomers({
      search: args.query,
      includeInactive: true,
      page: 1,
      limit: args.limit
    });

    return {
      total: result.total,
      customers: result.items.map((customer) => ({
        id: String(customer._id),
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        active: customer.status === 'active'
      }))
    };
  }
};

const getCustomerAccountTool: AgentTool = {
  name: 'get_customer_account',
  description: 'Devuelve la cuenta de un cliente: saldo pendiente, total gastado, cantidad de órdenes y últimas órdenes.',
  permission: 'customers.view',
  topic: 'la cuenta del cliente',
  label: 'Cuenta del cliente consultada',
  parameters: {
    type: 'object',
    properties: {
      customerId: { type: 'string', description: 'Identificador del cliente' }
    },
    required: ['customerId'],
    additionalProperties: false
  },
  schema: z.object({ customerId: objectIdSchema }),
  execute: async (rawArgs) => {
    const { customerId } = rawArgs as { customerId: string };
    const [summary, orders] = await Promise.all([
      getCustomerSummary(customerId),
      listCustomerOrders(customerId, { limit: 5, page: 1 })
    ]);

    return {
      customer: {
        id: String(summary.customer._id),
        name: summary.customer.name,
        phone: summary.customer.phone,
        address: summary.customer.address,
        active: summary.customer.status === 'active'
      },
      outstandingBalance: round2(summary.outstandingBalance),
      totalSpent: round2(summary.totalSpent),
      orderCount: summary.orderCount,
      lastOrderDate: summary.lastOrderDate ? summary.lastOrderDate.toISOString() : null,
      hasPendingOrders: summary.hasPendingOrders,
      lastOrders: orders.items.map((order) => ({
        orderNumber: order.orderNumber,
        date: orderDateString(order),
        status: order.status,
        totalAmount: round2(order.totalAmount),
        balance: round2(order.balance)
      }))
    };
  }
};

const getCompanyAccountsTool: AgentTool = {
  name: 'get_company_accounts',
  description: 'Saldos actuales de las cuentas de dinero de la empresa: efectivo, Mercado Pago, banco y total.',
  permission: 'accounts.view',
  topic: 'las cuentas de la empresa',
  label: 'Saldos de cuentas consultados',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  schema: z.object({}),
  execute: async () => {
    const saldos = await getSaldos();
    return {
      efectivo: round2(saldos.efectivo),
      mercadopago: round2(saldos.mercadopago),
      banco: round2(saldos.banco),
      total: round2(saldos.total)
    };
  }
};

// ─── Prepare-only write tools (Phase 2) ─────────────────────────────────────

const prepareOrderTool: AgentTool = {
  name: 'prepare_order',
  description:
    'PREPARA un pedido nuevo (no lo crea). Valida cliente, productos y precios, y devuelve una tarjeta de confirmación para el usuario. El pedido recién se crea cuando el usuario confirma la tarjeta. NO la llames si el producto, la cantidad o la unidad no están claros en el pedido del usuario: preguntá primero y no prepares nada.',
  permission: 'orders.manage',
  topic: 'los pedidos',
  label: 'Pedido preparado',
  parameters: {
    type: 'object',
    properties: {
      customerId: { type: 'string', description: 'Identificador del cliente' },
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        description: 'Ítems del pedido',
        items: {
          type: 'object',
          properties: {
            productId: { type: 'string', description: 'Identificador del producto' },
            quantity: { type: 'integer', minimum: 1, description: 'Cantidad en la unidad indicada' },
            unit: {
              type: 'string',
              enum: ['maple', 'medio_cajon', 'cajon'],
              description: 'Unidad (por defecto maple)'
            }
          },
          required: ['productId', 'quantity'],
          additionalProperties: false
        }
      },
      channel: {
        type: 'string',
        enum: ['phone', 'whatsapp', 'driver_visit', 'walk_in'],
        description: 'Canal del pedido (opcional)'
      },
      paymentPreference: {
        type: 'string',
        enum: ['cash', 'transfer', 'credit', 'cod', 'partial'],
        description: 'Preferencia de pago (opcional)'
      },
      deliveryDate: { type: 'string', description: 'Fecha de entrega YYYY-MM-DD (opcional)' },
      notes: { type: 'string', description: 'Notas de entrega (opcional)' }
    },
    required: ['customerId', 'items'],
    additionalProperties: false
  },
  schema: prepareOrderArgsSchema,
  execute: async (rawArgs, ctx) =>
    prepareOrderAction(rawArgs as PrepareOrderArgs, ctx)
};

const preparePaymentTool: AgentTool = {
  name: 'prepare_payment',
  description:
    'PREPARA el registro de un pago (no lo registra). Resuelve el pedido y muestra el saldo antes/después. El pago recién se registra cuando el usuario confirma la tarjeta.',
  permission: 'orders.manage',
  topic: 'los pagos',
  label: 'Pago preparado',
  parameters: {
    type: 'object',
    properties: {
      orderNumber: { type: 'string', description: 'Número de orden exacto o parcial (ej. "ORD-00042")' },
      amount: { type: 'number', exclusiveMinimum: 0, description: 'Monto a registrar' },
      method: {
        type: 'string',
        enum: ['cash', 'transfer', 'check'],
        description: 'Medio de pago (por defecto cash)'
      },
      account: {
        type: 'string',
        enum: ['cash', 'mp', 'bank'],
        description: 'Cuenta de dinero (opcional; por defecto se deriva del medio)'
      },
      reference: { type: 'string', description: 'Referencia del pago (opcional)' }
    },
    required: ['orderNumber', 'amount'],
    additionalProperties: false
  },
  schema: preparePaymentArgsSchema,
  execute: async (rawArgs, ctx) =>
    preparePaymentAction(rawArgs as PreparePaymentArgs, ctx)
};

const prepareOrderStatusTool: AgentTool = {
  name: 'prepare_order_status',
  description:
    'PREPARA un cambio de estado de un pedido (no lo ejecuta): pendiente → asignado → en tránsito → entregado. Al entregar descuenta stock. Requiere número de orden y estado destino; no la uses si falta el número o el estado.',
  permission: 'orders.manage',
  topic: 'los pedidos',
  label: 'Cambio de estado preparado',
  parameters: {
    type: 'object',
    properties: {
      orderNumber: { type: 'string', description: 'Número de orden exacto o parcial (ej. "ORD-00042")' },
      status: {
        type: 'string',
        enum: ['assigned', 'in_transit', 'delivered'],
        description: 'Estado destino del pedido'
      }
    },
    required: ['orderNumber', 'status'],
    additionalProperties: false
  },
  schema: prepareOrderStatusArgsSchema,
  execute: async (rawArgs, ctx) =>
    prepareOrderStatusAction(rawArgs as PrepareOrderStatusArgs, ctx)
};

const prepareCustomerTool: AgentTool = {
  name: 'prepare_customer',
  description:
    'PREPARA un cliente nuevo (no lo crea). Valida los datos y devuelve una tarjeta de confirmación. El cliente recién se crea cuando el usuario confirma la tarjeta.',
  permission: 'customers.manage',
  topic: 'los clientes',
  label: 'Cliente preparado',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nombre del cliente (2 a 100 caracteres)' },
      type: { type: 'string', enum: ['B2B', 'B2C'], description: 'Tipo de cliente' },
      phone: { type: 'string', description: 'Teléfono' },
      address: { type: 'string', description: 'Dirección' },
      email: { type: 'string', description: 'Email (opcional)' },
      taxId: { type: 'string', description: 'CUIT/CUIL (opcional)' },
      creditLimit: { type: 'number', minimum: 0, description: 'Límite de crédito (opcional)' },
      termDays: { type: 'integer', minimum: 0, description: 'Días de plazo (opcional)' }
    },
    required: ['name', 'type', 'phone', 'address'],
    additionalProperties: false
  },
  schema: prepareCustomerArgsSchema,
  execute: async (rawArgs, ctx) =>
    prepareCustomerAction(rawArgs as PrepareCustomerArgs, ctx)
};

export const AGENT_TOOLS: AgentTool[] = [
  getDashboardOverview,
  getSalesReport,
  getProfitReportTool,
  getReceivables,
  getDebtors,
  listOrdersTool,
  getOrderTool,
  listStockTool,
  findCustomersTool,
  getCustomerAccountTool,
  getCompanyAccountsTool,
  prepareOrderTool,
  preparePaymentTool,
  prepareOrderStatusTool,
  prepareCustomerTool
];

export const findTool = (name: string): AgentTool | undefined =>
  AGENT_TOOLS.find((tool) => tool.name === name);

/** OpenAI-compatible tools payload. */
export const toProviderTools = (): ProviderToolDefinition[] =>
  AGENT_TOOLS.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));

/** Serializes a tool result, capping the payload fed back to the model. */
export const serializeToolResult = (value: unknown): string => {
  let json: string;
  try {
    json = JSON.stringify(value) ?? 'null';
  } catch {
    json = JSON.stringify({ error: 'Resultado no serializable' });
  }

  if (json.length <= MAX_RESULT_CHARS) {
    return json;
  }

  return `${json.slice(0, MAX_RESULT_CHARS)}\n...[truncated]`;
};

const fail = (tool: string, message: string, startedAt: number, internalError?: string): ToolExecution => ({
  tool,
  ok: false,
  content: serializeToolResult({ error: message }),
  summary: message,
  error: internalError ?? message,
  durationMs: Date.now() - startedAt
});

/**
 * Validates, permission-checks and runs one tool call.
 *
 * Never throws: tool failures are converted into an `{ error }` payload so the
 * model can explain the situation and the request never 500s.
 */
export const executeTool = async (
  name: string,
  rawArgs: unknown,
  ctx: AgentToolContext
): Promise<ToolExecution> => {
  const startedAt = Date.now();
  const tool = findTool(name);

  if (!tool) {
    return fail(name || 'desconocida', 'Herramienta desconocida', startedAt);
  }

  if (!hasPermission(ctx.permissions, tool.permission)) {
    return fail(tool.name, `Sin permiso para consultar ${tool.topic}`, startedAt);
  }

  const parsed = tool.schema.safeParse(rawArgs);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'args'}: ${issue.message}`)
      .join('; ');
    return fail(tool.name, `Parámetros inválidos: ${details}`, startedAt);
  }

  try {
    const result = await tool.execute(parsed.data, ctx);
    return {
      tool: tool.name,
      ok: true,
      content: serializeToolResult(result),
      summary: tool.label,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    // Controlled AppError messages are safe (and useful) to show the model;
    // anything else is masked so internal details never leak.
    if (error instanceof AppError) {
      return fail(tool.name, error.message, startedAt);
    }
    const detail = error instanceof Error ? error.message : 'Error desconocido';
    return fail(tool.name, 'La consulta falló', startedAt, detail);
  }
};
