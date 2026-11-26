import type { ProductUnit } from '../lib/units.ts';

// Customer types
export type CustomerType = 'B2B' | 'B2C';
export type CustomerStatus = 'active' | 'inactive';

export interface CreditConfig {
  limit: number;
  termDays: number;
}

/** Structured address fields. `Customer.address` remains the composed display string. */
export interface AddressDetail {
  street?: string; // calle
  number?: string; // número
  floor?: string; // piso/depto
  neighborhood?: string; // barrio
  city?: string; // ciudad
  province?: string; // provincia
  postalCode?: string; // código postal
  reference?: string; // referencias (cerca de...)
}

export interface Customer {
  _id: string;
  name: string;
  type: CustomerType;
  phone: string;
  address: string;
  addressDetail?: AddressDetail;
  email?: string;
  taxId?: string;
  creditConfig: CreditConfig;
  /** Debt brought into the business at punto cero (initial balance). */
  openingDebt: number;
  status: CustomerStatus;
  /** GeoJSON Point stored by the backend: coordinates = [lng, lat]. */
  location?: GeoPoint;
  createdAt: string;
  updatedAt: string;
}

// Map / geocoding types
export interface LatLng {
  lat: number;
  lng: number;
}

/** GeoJSON Point as persisted on Customer — coordinates order is [lng, lat]. */
export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number];
}

/** Result of POST /v1/geocode. */
export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName?: string;
}

/** Structured address resolved from coordinates (POST /v1/geocode/reverse). */
export interface ReverseGeocodeResult {
  displayName?: string;
  street?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  province?: string;
  postalCode?: string;
}

// Product types
/** Unit a quantity/price is expressed in: 'maple', 'medio_cajon' or 'cajon'. */
export type PriceUnit = ProductUnit;

/** Egg color type. */
export type ProductVariety = 'blanco' | 'castaño';
/** Egg size class within a variety — `surtido` = unclassified for that variety. */
export type ProductCaliber = 'chico' | 'mediano' | 'grande' | 'extragrande' | 'surtido';

export const PRODUCT_VARIETIES: ProductVariety[] = ['blanco', 'castaño'];
export const PRODUCT_CALIBERS: ProductCaliber[] = ['chico', 'mediano', 'grande', 'extragrande', 'surtido'];

export const VARIETY_LABELS: Record<ProductVariety, string> = {
  blanco: 'Blanco',
  castaño: 'Castaño',
};

export const CALIBER_LABELS: Record<ProductCaliber, string> = {
  chico: 'Chico',
  mediano: 'Mediano',
  grande: 'Grande',
  extragrande: 'Extra Grande',
  surtido: 'Surtido',
};

/** Derived display name: "Blanco Chico", "Castaño Extra Grande", "Blanco Surtido". */
export const productDisplayName = (p: { variety: ProductVariety; caliber: ProductCaliber }): string =>
  `${VARIETY_LABELS[p.variety]} ${CALIBER_LABELS[p.caliber]}`;

export interface Product {
  _id: string;
  /** Egg color type. */
  variety: ProductVariety;
  /** Size class — `surtido` = unclassified within the variety. */
  caliber: ProductCaliber;
  /** Derived label — "Blanco Chico". */
  displayName: string;
  eggsPerMaple: number;
  /** How many maples fit in one cajón (box). Default 12, min 1. */
  maplesPerCajon?: number;
  costPrice?: number | null;
  lowStockThreshold?: number;
  createdAt: string;
  updatedAt: string;
}

/** One variety×caliber combination in the catalog. */
export interface ProductOptionCombo {
  variety: ProductVariety;
  caliber: ProductCaliber;
  displayName: string;
}

/** GET /v1/products/options — catalog for the create form (labels + combos). */
export interface ProductOptions {
  varieties: { value: ProductVariety; label: string }[];
  calibers: { value: ProductCaliber; label: string }[];
  combos: ProductOptionCombo[];
}

// Inventory types
export interface InventoryItem {
  _id: string;
  /** GET /v1/inventory populates `productId` with the product doc
   *  ({ _id, variety, caliber, lowStockThreshold }); it can also arrive as a raw
   *  ObjectId string when the backend does not populate it. */
  productId:
    | string
    | { _id: string; variety: ProductVariety; caliber: ProductCaliber; lowStockThreshold: number };
  /** Snapshot product name — only present when the backend returns a
   *  denormalized copy (the populated shape carries it under productId). */
  productName?: string;
  quantity: number;
  lowStockThreshold: number;
  lastUpdated: string;
}

export type TransactionType = 'sale' | 'purchase' | 'adjustment' | 'delivery' | 'opening' | 'classification' | 'return';

export interface StockTransaction {
  _id: string;
  productId: string;
  type: TransactionType;
  quantity: number;
  orderId?: string;
  /** Source purchase id — present only on transactions created by a purchase delivery. */
  purchaseId?: string | null;
  /** Shared link for grouped transactions (e.g. one classify action → `classify-{uuid}`). */
  referenceId?: string;
  notes: string;
  createdBy: string;
  createdAt: string;
}

export interface PriceEntry {
  _id: string;
  productId: string;
  price: number;
  /** Which unit the price applies to: 'maple' (default), 'medio_cajon' or 'cajon'. */
  unit?: PriceUnit;
  effectiveFrom: string;
  effectiveTo?: string;
  createdAt: string;
}

// Route types
export type RouteStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';
export type StopStatus = 'pending' | 'in_transit' | 'delivered' | 'skipped';

export interface RouteStop {
  _id: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerAddress: string;
  customerPhone: string;
  sequence: number;
  status: StopStatus;
  deliveredAt: string | null;
  notes: string;
  /** Display snapshot of the delivery coordinates (from order/customer). */
  location?: LatLng;
  /** Payment preference snapshot — the driver knows what to collect. */
  paymentPreference?: PaymentPreference;
  /** Order balance at stop creation — amount the driver should collect. */
  balanceToCollect?: number;
}

export interface Route {
  _id: string;
  routeNumber: string;
  driverId: string;
  driverName: string;
  /** Optional vehicle assignment (ref Vehicle) — snapshot pattern mirrors driverName. */
  vehicleId: string | null;
  /** vehicleName snapshot taken at creation; '' when no vehicle assigned. */
  vehicleName: string;
  /** Km travelled on completion; null until the route is completed with a value. */
  kmTravelled: number | null;
  plannedDate: string;
  status: RouteStatus;
  stops: RouteStop[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Order types
export type OrderStatus = 'pending' | 'assigned' | 'in_transit' | 'delivered' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export type OrderChannel = 'phone' | 'whatsapp' | 'driver_visit' | 'walk_in';
export type PaymentPreference = 'cash' | 'transfer' | 'credit' | 'cod' | 'partial';
/** Where the sale was made (delivery route, market stall, WhatsApp, other). Default 'reparto'. */
export type SalesChannel = 'reparto' | 'puesto' | 'whatsapp' | 'otro';
/** Order-level bonification: a fixed money amount or a percentage of the subtotal. */
export type BonificationType = 'amount' | 'percent';
/** Order-level surcharge: a fixed money amount or a percentage of the subtotal. */
export type SurchargeType = 'amount' | 'percent';
/** What happens to money already collected when an order is cancelled. */
export type CancelMoneyAction = 'refund_cash' | 'refund_transfer' | 'customer_credit' | 'none';

export interface OrderBonification {
  type: BonificationType;
  /** Raw value entered by the user ($ for 'amount', 0-100 for 'percent'). */
  value: number;
  /** Computed money discount persisted by the server. */
  amount: number;
}

export interface OrderSurcharge {
  type: SurchargeType;
  /** Raw value entered by the user ($ for 'amount', 0-100 for 'percent'). */
  value: number;
  /** Computed money surcharge persisted by the server. */
  amount: number;
}

export interface OrderItem {
  productId: string;
  productName: string;
  /** Quantity in the item's own unit ('maple', 'medio_cajon' or 'cajon'). */
  quantity: number;
  /** 'maple' (default), 'medio_cajon' or 'cajon'. */
  unit?: PriceUnit;
  /** Quantity converted to maples (unit-aware, via product.maplesPerCajon). */
  mapleQty?: number;
  unitPrice: number;
  /** Base (non-promo) unit price — present only when a promo was applied. */
  originalUnitPrice?: number;
  /** Snapshot of the promotion that priced this line — present only when a promo was applied. */
  promo?: OrderItemPromo;
  subtotal: number;
}

export interface AuditEntry {
  adminUserId: string;
  customerId: string;
  orderId: string;
  overageAmount: number;
  timestamp: string;
}

export interface Order {
  _id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  channel: OrderChannel;
  deliveryAddress: string;
  deliveryNotes?: string;
  /** Coordinates resolved for the delivery address (display snapshot). */
  deliveryLocation?: LatLng;
  items: OrderItem[];
  /** Order-level sum of item subtotals, before any bonification. Absent on
   *  legacy orders → fall back to totalAmount. */
  subtotal?: number;
  /** Order-level discount applied on top of `subtotal` (null/absent = none). */
  bonification?: OrderBonification | null;
  /** Order-level surcharge added on top of the discounted total (null/absent = none). */
  surcharge?: OrderSurcharge | null;
  /** Final amount to collect: max(0, subtotal − bonification.amount + surcharge.amount). */
  totalAmount: number;
  status: OrderStatus;
  /** Backend inventory flag: true once a delivery deducted stock from the
   *  warehouse. Drives restock-on-cancel and restock-on-undo. Absent on
   *  legacy orders → treated as false. */
  stockDeducted?: boolean;
  /** How the customer intends to pay (cash/transfer at delivery, credit,
   *  cod = pays previous balance next delivery, partial = upfront payment).
   *  Absent on legacy orders → default 'cash'. */
  paymentPreference?: PaymentPreference;
  /** Where the sale was made — absent on legacy orders → default 'reparto'. */
  salesChannel?: SalesChannel;
  paymentStatus: PaymentStatus;
  paidAmount: number;
  balance: number;
  /** Accumulated value of returns — invariant: totalAmount − returnedAmount = paidAmount + balance. */
  returnedAmount: number;
  dueDate: string | null;
  /**
   * Business/sale date — when the sale actually happened. Editable, and the
   * single source of truth for every date-based view. `createdAt` is the
   * immutable capture timestamp (audit only). Absent on legacy orders that
   * predate the field → fall back to `createdAt`.
   */
  orderDate?: string;
  /** Date the customer wants the delivery (distinct from dueDate = credit term). */
  deliveryDate?: string | null;
  routeId: string | null;
  routeStopId: string | null;
  auditLog: AuditEntry[];
  createdAt: string;
  updatedAt: string;
}

// ─── Supplier types ──────────────────────────────────────────────────────────

export interface Supplier {
  _id: string;
  name: string;
  contact: string;
  phone: string;
  /** Debt owed TO this supplier at punto cero (initial balance). */
  openingDebt: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Vehicle types ───────────────────────────────────────────────────────────

export type FuelType = 'nafta' | 'diesel' | 'gas';

export interface Vehicle {
  _id: string;
  name: string;
  model?: string;
  plate: string;
  fuelType: FuelType;
  km?: number;
  consumptionKmPerL?: number;
  /** Reference-only static values — real costs come from tagged expenses. */
  insuranceCost?: number;
  maintenanceCost?: number;
  /** Raw driver user id (not populated); join names via usersApi.listDrivers. */
  driverId?: string | null;
  active: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Σ tagged expenses per cost category (salary/supplies/other excluded). */
export interface CostByCategory {
  fuel: number;
  repair: number;
  insurance: number;
  maintenance: number;
}

export interface DeliveryStats {
  routesCount: number;
  deliveredStops: number;
  /** Σ tagged expenses ÷ deliveredStops; 0 when no delivered stops. */
  costPerDelivery: number;
}

/** GET /v1/vehicles/:id — vehicle + aggregated detail. */
export interface VehicleDetail extends Vehicle {
  costsByCategory: CostByCategory;
  deliveryStats: DeliveryStats;
  recentRoutes: Route[];
}

// ─── Purchase types ──────────────────────────────────────────────────────────

export type PurchaseStatus = 'pending' | 'delivered' | 'cancelled';
export type PurchasePaymentMethod = 'cash' | 'transfer' | 'check';
export type PurchasePaymentStatus = 'unpaid' | 'partial' | 'paid';

/** A payment line as SENT to the API (account is optional → derived server-side from method). */
export interface PurchasePaymentLine {
  method: PurchasePaymentMethod;
  account?: MoneyAccount;
  amount: number;
  /** Optional external reference (e.g. an MP transaction id). */
  reference?: string;
}

/** A recorded payment line as RETURNED by the API (account resolved, plus date/groupId). */
export interface PurchasePayment {
  method: PurchasePaymentMethod;
  account: MoneyAccount;
  amount: number;
  date: string;
  /** Shared by all lines recorded in the same "pago" action. */
  groupId: string;
  reference?: string;
}

export interface PurchaseItem {
  productId: string;
  productName: string;
  /** Unit the item was bought in: 'maple' (default), 'medio_cajon' or 'cajon'. Absent on legacy items. */
  unit?: PriceUnit;
  /** Quantity as entered, in the item's own unit. Absent on legacy items. */
  quantity?: number;
  /** Quantity converted to maples (unit-aware, via product.maplesPerCajon). */
  quantityMaples: number;
  /** Unit cost as entered — per maple, per medio cajón or per cajón. */
  unitCost: number;
  /** Cost per maple (unit cost ÷ unit maples). Absent on legacy items. */
  unitCostPerMaple?: number;
  subtotal: number;
}

/** Purchase item as returned by GET /v1/purchases/:id (detail with margin). */
export interface PurchaseItemDetail extends PurchaseItem {
  /** activePrice (maple) − unitCostPerMaple; null when the product has no active price. */
  margin: number | null;
}

export interface Purchase {
  _id: string;
  purchaseNumber: string;
  /** Raw supplier id, or the populated supplier doc in list responses. */
  supplierId: string | { _id: string; name: string; contact?: string; phone?: string };
  date: string;
  items: PurchaseItem[];
  totalCost: number;
  notes: string;
  /** Lifecycle: pending (default) → delivered | cancelled. */
  status: PurchaseStatus;
  /** Set when the purchase is marked delivered (stock enters). */
  deliveredAt: string | null;
  /** How the purchase was paid (null = not paid yet). */
  paymentMethod: PurchasePaymentMethod | null;
  /** Money account the payment landed in; null → legacy/unpaid (derived from paymentMethod on read). */
  account?: MoneyAccount | null;
  /** unpaid | partial | paid — derived from paidAmount vs totalCost. */
  paymentStatus: PurchasePaymentStatus;
  /** Accumulated payments. */
  paidAmount: number;
  /** Itemised payment history (empty for legacy records). */
  payments?: PurchasePayment[];
  /** totalCost − paidAmount (list items compute it; detail returns it). */
  balance?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Shape returned by GET /v1/purchases/:id — flattened supplier + item margins. */
export interface PurchaseDetail {
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  date: string;
  items: PurchaseItemDetail[];
  totalCost: number;
  notes: string;
  status: PurchaseStatus;
  deliveredAt: string | null;
  paymentMethod: PurchasePaymentMethod | null;
  /** Money account the payment landed in; null → legacy/unpaid (derived from paymentMethod on read). */
  account?: MoneyAccount | null;
  paymentStatus: PurchasePaymentStatus;
  paidAmount: number;
  /** Itemised payment history (one line per method, grouped by groupId). */
  payments?: PurchasePayment[];
  balance: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Promotion types ─────────────────────────────────────────────────────────

export type PromotionType = 'fixed_price' | 'discount_percent' | 'buy_x_get_y';
export type PromotionStatus = 'active' | 'inactive';

/** Snapshot of the promotion that priced an order line (immutable at creation). */
export interface OrderItemPromo {
  promotionId: string;
  name: string;
  type: PromotionType;
  value: number;
  /** null = unlimited — only stock-limited promos book soldQuantity. */
  stockLimit?: number | null;
}

export interface Promotion {
  _id: string;
  name: string;
  productId: string;
  description?: string;
  /** fixed_price → group price (see minQuantity for the group size); discount_percent → % off; buy_x_get_y → buy X get Y total. */
  type: PromotionType;
  value: number;
  /** buy_x_get_y → total units per group ("pagás X llevás Y"); null = legacy (value + 1). */
  getQuantity?: number | null;
  /** Which unit the promo applies to: 'maple' (default), 'medio_cajon' or 'cajon'. */
  unit: PriceUnit;
  /**
   * Lower bound of the order-line quantity for the promo to apply (null = no
   * minimum). For fixed_price it doubles as the group size N.
   */
  minQuantity?: number | null;
  maxQuantity?: number | null;
  /** null = unlimited. */
  stockLimit?: number | null;
  soldQuantity: number;
  /** null = no date limit. */
  expiresAt?: string | null;
  status: PromotionStatus;
  createdAt: string;
  updatedAt: string;
}

// ─── Aging report types ──────────────────────────────────────────────────────
export type AgingBucketLabel = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export interface AgingBucket {
  label: AgingBucketLabel;
  count: number;
  totalAmount: number;
}

export interface AgingReport {
  buckets: AgingBucket[];
  totalOverdue: number;
}

export interface CustomerAgingReport extends AgingReport {
  customerId: string;
  oldestDueDate: string | null;
}

// Customer outstanding
export interface CustomerOutstanding {
  customerId: string;
  outstandingBalance: number;
  orderCount: number;
}

// ─── Customer charges (manual debt / credit — cuenta corriente) ──────────────

/** 'charge' increases the debt, 'credit' reduces it (forgiveness / discount). */
export type CustomerChargeType = 'charge' | 'credit';

export type CustomerChargeReason = 'manual_debt' | 'adjustment' | 'forgiveness' | 'other';

/** Spanish labels for the charge reason select / ledger chips. */
export const CUSTOMER_CHARGE_REASON_LABELS: Record<CustomerChargeReason, string> = {
  manual_debt: 'Deuda manual',
  adjustment: 'Ajuste',
  forgiveness: 'Condonación',
  other: 'Otro',
};

export interface CustomerCharge {
  _id: string;
  customerId: string;
  type: CustomerChargeType;
  /** Always positive; the sign of the effect comes from `type`. */
  amount: number;
  reason: CustomerChargeReason;
  note?: string;
  date: string;
  source: 'manual';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerChargeRequest {
  type: CustomerChargeType;
  amount: number;
  reason: CustomerChargeReason;
  note?: string;
  /** ISO date (YYYY-MM-DD or full timestamp); omitted defaults to now. */
  date?: string;
}

// Payment types
export type PaymentMethod = 'cash' | 'transfer' | 'check';

/** Money account a movement is attributed to (Efectivo / Mercado Pago / Banco). */
export type MoneyAccount = 'cash' | 'mp' | 'bank';

/**
 * A payment line as SENT to the API. Shared by purchases and sales order
 * creation — both accept the same shape. `account` is optional and derived
 * server-side from the method when omitted.
 */
export interface PaymentLinePayload {
  method: PaymentMethod;
  account?: MoneyAccount;
  amount: number;
  /** Optional external reference (e.g. an MP transaction id). */
  reference?: string;
}

export interface Payment {
  _id: string;
  orderId: string;
  amount: number;
  method: PaymentMethod;
  /** Money account this payment landed in; null → legacy (derived from method on read). */
  account?: MoneyAccount | null;
  reference?: string;
  date: string;
  createdAt: string;
}

export interface Receipt {
  orderNumber: string;
  customerName: string;
  items: OrderItem[];
  totalAmount: number;
  paidAmount: number;
  balance: number;
  paymentDate: string;
}

// ─── Customer-level payments (auto-allocated FIFO) ─────────────────────────

/** One order covered by a customer-level payment (oldest-first allocation). */
export interface CustomerPaymentAllocation {
  orderId: string;
  orderNumber: string;
  /** Order creation date (the FIFO ordering key), ISO-8601. */
  date: string;
  applied: number;
  balanceBefore: number;
  balanceAfter: number;
}

/** Result of POST /v1/customers/:id/payments. */
export interface CustomerPaymentResult {
  applied: number;
  /** Always 0 under the strict policy (amounts above the total debt are rejected). */
  unapplied: number;
  allocations: CustomerPaymentAllocation[];
  /** Portion applied to debt not tied to an order (opening debt + manual debt). */
  nonOrderApplied: number;
}

export interface CreateCustomerPaymentRequest {
  amount: number;
  method: PaymentMethod;
  /** Optional money-account override — derived server-side from the method. */
  account?: MoneyAccount;
  reference?: string;
  /** ISO date; omitted defaults to now. */
  date?: string;
}

// ─── Return (devolución) types ──────────────────────────────────────────────
export type ReturnReason = 'broken' | 'difference' | 'product_change' | 'other';
export type ReturnEffect = 'refund_cash' | 'refund_transfer' | 'reduce_debt' | 'no_refund';

export interface ReturnItem {
  productId: string;
  productName: string;
  /** Returned quantity in the item's own unit ('maple', 'medio_cajon' or 'cajon'). */
  quantity: number;
  unit: PriceUnit;
  /** Quantity converted to maples (unit-aware) — stock restore uses this. */
  mapleQty?: number;
  /** Unit-price snapshot from the order item (per-unit in the item's unit). */
  unitPrice: number;
  subtotal: number;
}

export interface OrderReturn {
  _id: string;
  orderId: string;
  customerId: string;
  date: string;
  items: ReturnItem[];
  /** Effective value of the returned goods (line subtotals × order discount factor). */
  returnedAmount: number;
  /** Explicit alias of `returnedAmount` — effective, discount-adjusted value. */
  returnedValue?: number;
  /** Portion of the effective value that cancelled unpaid order debt. */
  debtCancelled?: number;
  /** Paid portion turned into store credit (saldo a favor) instead of cash. */
  creditIssued?: number;
  /** Money actually refunded (only for refund_cash / refund_transfer effects). */
  refundAmount: number;
  reason: ReturnReason;
  effect: ReturnEffect;
  /** Money account the refund left from; null → derived from effect on read. */
  refundAccount?: MoneyAccount | null;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// Auth types
export type UserRole = 'superadmin' | 'admin' | 'driver' | 'viewer' | 'puesto';

export interface AuthPayload {
  userId: string;
  role: UserRole;
}

export interface AuthUser {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  /** Per-module permissions (`<module>.<level>`). Optional so sessions cached
   *  before the permission system still type-check; consumers use `?? []`. */
  permissions?: string[];
}

export interface LoginRequest {
  email: string;
  password: string;
}

/** Company (tenant) the signed-in user belongs to — additive on POST /v1/auth/login. */
export interface Tenant {
  id: string;
  name: string;
  slug: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
  /** Company the user signed into. Optional for backward compatibility with
   *  sessions cached before multi-tenancy (older persisted state has no tenant). */
  tenant?: Tenant;
}

// ─── Platform (multi-tenant) admin types ─────────────────────────────────────

/** Platform super-admin identity — POST /v1/platform/auth/login. */
export interface PlatformAdmin {
  id: string;
  name: string;
  email: string;
}

export interface PlatformLoginRequest {
  email: string;
  password: string;
}

export interface PlatformLoginResponse {
  token: string;
  admin: PlatformAdmin;
}

/** Tenant row returned by GET /v1/platform/tenants (platform admin only). */
export interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  /** Physical database name backing the tenant. */
  dbName: string;
  active: boolean;
  createdAt: string;
  /** Number of users in the tenant; absent in some responses. */
  userCount?: number;
}

/** POST /v1/platform/tenants — provision a new company + its first admin. */
export interface CreateTenantRequest {
  name: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  /** Optional plan tier. */
  plan?: string;
}

/** PATCH /v1/platform/tenants/:id — partial update (rename / toggle active). */
export interface UpdateTenantRequest {
  name?: string;
  active?: boolean;
}

// ─── Platform punto cero (super-admin running a tenant's setup) ──────────────

/** Tenant identity inside the platform punto-cero payload. */
export interface PlatformPuntoCeroTenant {
  id: string;
  name: string;
  slug: string;
}

/** Tenant setup state as exposed to the platform admin. */
export interface PlatformPuntoCeroState {
  finalized: boolean;
  finalizedAt: string | null;
  openingBalances: OpeningBalances;
  /** Per-account one-time load timestamp (ISO) or null when still editable. */
  openingBalancesSetAt: OpeningBalancesSetAt;
}

export interface PlatformPuntoCeroProduct {
  id: string;
  name: string;
  maplesPerCajon: number;
  stock: number;
}

export interface PlatformPuntoCeroCustomer {
  id: string;
  name: string;
  openingDebt: number;
}

export interface PlatformPuntoCeroSupplier {
  id: string;
  name: string;
  openingDebt: number;
}

/** GET /v1/platform/tenants/:id/punto-cero — everything needed to run the wizard. */
export interface PlatformPuntoCero {
  tenant: PlatformPuntoCeroTenant;
  state: PlatformPuntoCeroState;
  products: PlatformPuntoCeroProduct[];
  customers: PlatformPuntoCeroCustomer[];
  suppliers: PlatformPuntoCeroSupplier[];
}

/** POST /v1/platform/tenants/:id/punto-cero — only non-zero sections are sent. */
export interface SetPlatformPuntoCeroPayload {
  stock?: { productId: string; quantity: number }[];
  openingCash?: number;
  openingBalances?: { cash?: number; mp?: number; bank?: number };
  clientDebts?: { customerId: string; amount: number }[];
  supplierDebts?: { supplierId: string; amount: number }[];
  /** Overwrite an already-finalized setup (requires typing the tenant slug). */
  force?: boolean;
}

/** Alias kept for call-site readability. */
export type PlatformPuntoCeroPayload = SetPlatformPuntoCeroPayload;

/** POST /v1/platform/tenants/:id/reset — destructive tenant-data reset result. */
export interface PlatformTenantResetResult {
  tenant: PlatformPuntoCeroTenant;
  /** Collection name → deleted document count (only existing collections). */
  deleted: Record<string, number>;
  /** Collection name → remaining document count (only existing collections). */
  kept: Record<string, number>;
  /** Inventory documents whose quantity was set to 0. */
  inventoryZeroed: number;
  customerDebtsZeroed: boolean;
  /** True only when an existing business-config doc was reset. */
  configReset: boolean;
}

/** A tenant user as seen by the platform admin (GET /v1/platform/users). */
export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  createdAt: string;
  /** Per-module permissions (admins only). */
  permissions?: string[];
}

/** POST /v1/platform/users — create a user inside a specific company. */
export interface CreatePlatformUserRequest {
  tenantId: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  /** Optional; backend defaults admins to the full set. */
  permissions?: string[];
}

/** PATCH /v1/platform/users/:id — `tenantId` is required (owns the user). */
export interface UpdatePlatformUserRequest {
  tenantId: string;
  name?: string;
  role?: UserRole;
  permissions?: string[];
}

/** PATCH /v1/platform/me/password — self-service password change. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** POST /v1/auth/change-password — a fresh token replaces the invalidated one. */
export interface ChangePasswordResponse {
  token: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  /** Optional; the backend defaults admins to the full set. */
  permissions?: string[];
}

/** User record returned by the admin users list (GET /v1/users). */
export interface AppUser {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
  /** Per-module permissions (admins only). */
  permissions?: string[];
  /** Canonical WhatsApp number the assistant answers as this user, or null. */
  whatsappPhone?: string | null;
}

/** Body for PATCH /v1/users/:id — role and/or permissions (admin). */
export interface UpdateUserRequest {
  role?: UserRole;
  permissions?: string[];
}

// Driver types
export interface Driver {
  _id: string;
  name: string;
  email: string;
}

// ─── Expense types ───────────────────────────────────────────────────────────

export type ExpenseCategory = 'fuel' | 'salary' | 'maintenance' | 'supplies' | 'other' | 'repair' | 'insurance';

export interface Expense {
  _id: string;
  amount: number;
  category: ExpenseCategory;
  date: string;
  description: string;
  reference?: string;
  /** Money account the expense came out of — legacy docs default to 'cash'. */
  account?: MoneyAccount;
  /** Optional vehicle tag (ref Vehicle) — powers vehicle detail aggregation. */
  vehicleId?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExpensePayload {
  amount: number;
  category: ExpenseCategory;
  date: string;
  description: string;
  reference?: string;
  /** Money account — omitted defaults to 'cash' server-side. */
  account?: MoneyAccount;
  vehicleId?: string;
}

export interface ExpenseTotals {
  total: number;
  count: number;
  breakdown: Record<ExpenseCategory, number>;
  weekStart?: string;
  weekEnd?: string;
}

// ─── Cash adjustment types (manual caja movements) ──────────────────────────

export type CashAdjustmentReason = 'correction' | 'cash_count' | 'missing' | 'found' | 'other';
export type CashAdjustmentChannel = 'reparto' | 'puesto';

/** Spanish labels for the adjustment reason select / history chips. */
export const CASH_ADJUSTMENT_REASON_LABELS: Record<CashAdjustmentReason, string> = {
  correction: 'Corrección',
  cash_count: 'Arqueo de caja',
  missing: 'Faltante',
  found: 'Sobrante',
  other: 'Otro',
};

export interface CashAdjustment {
  _id: string;
  date: string;
  account: MoneyAccount;
  /** SIGNED amount: positive adds money, negative removes it. */
  amount: number;
  reason: CashAdjustmentReason;
  note?: string;
  channel: CashAdjustmentChannel;
  createdBy: string;
  /** Creator's display name, joined server-side (null when the user is gone). */
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCashAdjustmentRequest {
  account: MoneyAccount;
  /** SIGNED amount: positive adds money, negative removes it. */
  amount: number;
  reason: CashAdjustmentReason;
  note?: string;
  channel?: CashAdjustmentChannel;
  date?: string;
}

export interface CashAdjustmentSummary {
  cash: number;
  mp: number;
  bank: number;
  total: number;
}

export interface CashAdjustmentsResponse {
  adjustments: CashAdjustment[];
  total: number;
  page: number;
  limit: number;
  summary: CashAdjustmentSummary;
}

// ─── Unified cash ledger (GET /v1/cash/movements + /v1/cash/summary) ─────────

/** Kind of money movement in the unified ledger. */
export type CashMovementType =
  | 'payment'
  | 'expense'
  | 'adjustment'
  | 'purchase_payment'
  | 'refund';

/** A single row of the unified cash ledger. `amount` is SIGNED: + money in, − money out. */
export interface CashMovement {
  id: string;
  date: string;
  type: CashMovementType;
  account: MoneyAccount;
  /** Signed amount: positive adds money, negative removes it. */
  amount: number;
  description: string;
  reference?: string;
}

/** In / out / net aggregate over a set of movements. */
export interface CashTotals {
  in: number;
  out: number;
  net: number;
}

export interface CashMovementsResponse {
  movements: CashMovement[];
  total: number;
  page: number;
  limit: number;
  totals: CashTotals;
}

/** GET /v1/cash/summary — per-account balances + today's movement totals. */
export interface CashSummary {
  accounts: {
    cash: number;
    mp: number;
    bank: number;
    total: number;
  };
  today: CashTotals;
}

// ─── Report types ────────────────────────────────────────────────────────────

export interface RevenueBreakdownByProduct {
  productId: string;
  productName: string;
  total: number;
  quantity: number;
}

export interface RevenueBreakdownByCustomer {
  customerId: string;
  customerName: string;
  total: number;
  orderCount: number;
}

export interface RevenueBreakdownByPaymentMethod {
  method: string;
  total: number;
}

export interface RevenueBreakdownByChannel {
  canal: string;
  monto: number;
  ordenes: number;
}

export interface RevenueReport {
  totalRevenue: number;
  orderCount: number;
  startDate: string;
  endDate: string;
  breakdown: {
    byProduct: RevenueBreakdownByProduct[];
    byCustomer: RevenueBreakdownByCustomer[];
    byPaymentMethod: RevenueBreakdownByPaymentMethod[];
    byChannel: RevenueBreakdownByChannel[];
  };
}

export interface ProfitByDay {
  /** 'YYYY-MM-DD' in America/Argentina/Buenos_Aires */
  date: string;
  revenue: number;
  /** Money already collected that day (Σ paidAmount). */
  collected: number;
  /** Money still owed that day (Σ balance). */
  pendingCollection: number;
  cogs: number;
  expenses: number;
  profit: number;
  margin: number;
  orderCount: number;
}

export interface CashBasisByDay {
  /** 'YYYY-MM-DD' in America/Argentina/Buenos_Aires */
  date: string;
  /** Σ Payment.amount received that day. */
  collected: number;
  /** Σ cash refunds that day. */
  refunded: number;
  /** Proportional cost of the net collected amount. */
  cogs: number;
  /** collected − refunded − cogs. */
  profit: number;
  margin: number;
}

export interface CashBasisReport {
  collected: number;
  refunded: number;
  cogs: number;
  profit: number;
  margin: number;
  /** Descending by date; days with no cash movement omitted. */
  byDay: CashBasisByDay[];
}

/** Global receivable position — not scoped to the report period. */
export interface ReceivableSummary {
  total: number;
  overdue: number;
  upcoming: number;
  customerCount: number;
}

export interface ProfitReport {
  /** Accrual revenue: Σ totalAmount of delivered orders, paid or not. */
  revenue: number;
  /** Money already collected on those orders (Σ paidAmount). */
  collected: number;
  /** Money still owed on those orders (Σ balance). */
  pendingCollection: number;
  cogs: number;
  expenses: number;
  profit: number;
  margin: number;
  partialCOGS: boolean;
  disclaimer?: string;
  byDay: ProfitByDay[];
  /** Cash-basis result for the same period, driven by movement dates. */
  cashBasis: CashBasisReport;
  /** How much is still to be collected, globally. */
  receivable: ReceivableSummary;
}

// ─── Customer analytics types ────────────────────────────────────────────────

export interface CustomerHistoryOrder {
  _id: string;
  orderNumber: string;
  totalAmount: number;
  status: string;
  paymentStatus: string;
  createdAt: string;
  /** Business/sale date (backend falls back to createdAt on legacy docs). */
  orderDate?: string;
}

export interface CustomerHistory {
  customerId: string;
  customerName: string;
  orders: CustomerHistoryOrder[];
  totalSpent: number;
  orderCount: number;
  avgOrderValue: number;
  lastPurchaseDate: string | null;
}

export interface FrequencyPeriod {
  period: string;
  count: number;
}

export interface CustomerFrequency {
  customerId: string;
  period: 'weekly' | 'monthly';
  periods: FrequencyPeriod[];
}

export interface TopCustomer {
  customerId: string;
  customerName: string;
  totalRevenue: number;
  orderCount: number;
}

// ─── Customer dashboard / pagination types ───────────────────────────────────

export interface CustomerSummary {
  customer: Customer;
  outstandingBalance: number;
  totalSpent: number;
  orderCount: number;
  lastOrderDate: string | null;
  hasPendingOrders: boolean;
}

export interface CustomerListResult {
  items: Customer[];
  total: number;
  page: number;
  limit: number;
}

export interface CustomerOrdersResult {
  items: Order[];
  total: number;
  page: number;
  limit: number;
}

// ─── Dashboard alert types ───────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface LowStockProduct {
  name: string;
  currentStock: number;
  threshold: number;
}

export interface Alert {
  type: 'overdue_debts' | 'low_stock' | 'pending_orders';
  severity: AlertSeverity;
  count: number;
  totalAmount?: number;
  products?: LowStockProduct[];
}

// ─── Daily close (cierre diario) types ───────────────────────────────────────

/** Which close channel a daily close belongs to — reparto (default) or stall. */
export type DailyCloseChannel = 'reparto' | 'puesto';

/** Aggregates for one local calendar day (shared by preview and close snapshot). */
export interface DaySummary {
  /** Local calendar day as YYYY-MM-DD. */
  date: string;
  /** Σ totalAmount of the day's non-cancelled orders. */
  ventasHoy: number;
  /** Σ payments attributed to the cash account that day. */
  efectivo: number;
  /** Σ payments attributed to the MP/bank accounts that day. */
  transferencia: number;
  /** Σ balance of the day's non-cancelled orders. */
  fiado: number;
  /** Σ Expense that day whose account is cash. */
  gastos: number;
  /** Σ item.mapleQty of the day's non-cancelled orders. */
  maplesVendidos: number;
  /** ventasHoy − gastos. */
  resultado: number;
  /**
   * Σ cash purchase payments that day (money paid to suppliers from the
   * drawer). Optional: legacy snapshots and older payloads read 0/undefined.
   */
  pagosProveedor?: number;
}

/** GET /v1/daily-closes/preview — DaySummary + expected drawer cash. */
export interface DailyClosePreview extends DaySummary {
  /** efectivo − gastos − refundsCash + adjustmentsCash − pagosProveedor. */
  systemCash: number;
}

/** Frozen summary subdocument stored on a DailyClose. */
export type DailyCloseSummary = Omit<DaySummary, 'date'>;

/** A saved daily close (POST / PATCH / GET responses). */
export interface DailyClose {
  _id: string;
  /** Local midnight of the closed day (ISO timestamp). */
  date: string;
  /** 'reparto' (delivery) or 'puesto' (stall) — legacy closes read as 'reparto'. */
  channel: DailyCloseChannel;
  /** Frozen expected drawer cash at close time. */
  systemCash: number;
  /** Cash physically counted by the admin. */
  countedCash: number;
  /** countedCash − systemCash (recomputed on PATCH from the frozen systemCash). */
  difference: number;
  notes?: string;
  summary: DailyCloseSummary;
  /** Admin userId that created the close. */
  closedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Body for POST /v1/daily-closes — date defaults to today. */
export interface CreateDailyClosePayload {
  date?: string;
  /** 'reparto' (default) or 'puesto'. */
  channel?: DailyCloseChannel;
  countedCash: number;
  notes?: string;
}

/** Body for PATCH /v1/daily-closes/:id — correction path only. */
export interface UpdateDailyClosePayload {
  countedCash?: number;
  notes?: string;
}

// ─── Dashboard summary types (GET /v1/dashboard/summary) ─────────────────────

export interface OverdueSummary {
  count: number;
  total: number;
}

export interface StockSummaryItem {
  productId: string;
  name: string;
  variety?: ProductVariety;
  caliber?: ProductCaliber;
  /** null when the product has no inventory record yet. */
  quantity: number | null;
  /** null when the product has no lowStockThreshold configured. */
  threshold: number | null;
  costPrice: number | null;
  stockValue: number;
}

/** A single customer's outstanding debt group (Cuentas por cobrar). */
export interface DebtRow {
  customerId: string;
  customerName: string;
  totalDebt: number;
  ordersCount: number;
  maxDaysOverdue: number;
}

/** Whether today's cash close exists on the dashboard summary. */
export interface CierreHoy {
  closed: boolean;
  /** Local calendar day as YYYY-MM-DD (today). */
  date: string;
  /** Present only when closed. */
  difference?: number;
}

export interface DashboardSummary {
  /** Grand total of all money accounts — equals saldos.total (includes purchase payments). */
  caja: number;
  /** Payments received today minus expenses today. */
  cajaHoy: number;
  /** Per-account balances: opening balance + payments − expenses − refunds − purchase payments. */
  saldos: {
    efectivo: number;
    mercadopago: number;
    banco: number;
    total: number;
  };
  /** Sum of totalAmount of orders created today (not cancelled) — BILLED today. */
  ventasHoy: number;
  /**
   * GROSS money actually collected today = Σ Payment.amount dated today.
   * Unlike cajaHoy (NET movements), this is the raw collections total.
   */
  cobradoHoy: number;
  /** Today's sales split by channel (legacy docs group as 'reparto'). Σ monto == ventasHoy. */
  ventasPorCanal: Array<{ canal: string; monto: number; ordenes: number }>;
  /** Sum of non-cancelled order balances + customer openingDebt. */
  porCobrar: number;
  /** Count of distinct customers with (order balance + openingDebt) > 0. */
  clientesDeudores: number;
  /** Whether the business setup (punto cero) has been finalized. */
  puntoCeroFinalized: boolean;
  /** Overdue orders (dueDate < now, not paid). */
  vencidas: OverdueSummary;
  /** Inventory joined with product name/threshold/cost, stockValue = quantity × costPrice. */
  stock: StockSummaryItem[];
  totalStockValue: number;
  /** Orders delivered today. */
  entregasHoy: number;
  /** Orders pending/assigned today. */
  pendientesHoy: number;
  /** Top 20 debtor customers, sorted by totalDebt desc. */
  deudas: DebtRow[];
  /** Whether today's cash close exists, plus its difference when closed. */
  cierreHoy: CierreHoy;
}

// ─── Punto cero / setup types (GET+POST /v1/setup/punto-cero) ────────────────

/** Opening stock entry as returned by the setup state. */
export interface PuntoCeroStockEntry {
  productId: string;
  name: string;
  quantity: number;
}

/** Client opening debt entry as returned by the setup state. */
export interface PuntoCeroClientDebt {
  customerId: string;
  name: string;
  amount: number;
}

/** Supplier opening debt entry as returned by the setup state. */
export interface PuntoCeroSupplierDebt {
  supplierId: string;
  name: string;
  amount: number;
}

/** Per-account opening balances — `cash` mirrors `openingCash` (alias). */
export interface OpeningBalances {
  cash: number;
  mp: number;
  bank: number;
}

/** Per-account one-time load timestamp (ISO) or null when still editable. */
export interface OpeningBalancesSetAt {
  cash: string | null;
  mp: string | null;
  bank: string | null;
}

/** GET/PATCH /v1/setup/profile — the tenant's business identity. */
export interface BusinessProfile {
  businessName: string;
  address: string;
  phone: string;
}

/** GET /v1/setup/punto-cero — the current business setup state. */
export interface BusinessConfig {
  /** True once the one-time setup POST succeeded. */
  finalized: boolean;
  openingCash: number;
  /** Per-account opening balances (cash = openingCash alias). */
  openingBalances: OpeningBalances;
  /** Lock timestamps: a non-null value means the account is read-only. */
  openingBalancesSetAt: OpeningBalancesSetAt;
  clientDebts: PuntoCeroClientDebt[];
  supplierDebts: PuntoCeroSupplierDebt[];
  stock: PuntoCeroStockEntry[];
}

/** POST /v1/setup/punto-cero — every section is optional (partial setup valid). */
export interface SetupPuntoCeroPayload {
  stock?: { productId: string; quantity: number }[];
  openingCash?: number;
  /** Per-account opening balances — `cash` keeps `openingCash` in sync server-side. */
  openingBalances?: { cash?: number; mp?: number; bank?: number };
  clientDebts?: { customerId: string; amount: number }[];
  supplierDebts?: { supplierId: string; amount: number }[];
}

// ─── AI assistant types ─────────────────────────────────────────────────────

/** One tool invocation summary attached to an assistant message. */
export interface AgentToolCallSummary {
  name: string;
  ok: boolean;
  summary: string;
}

/** A single transcript entry. */
export interface AgentChatMessage {
  /** Present on server reads; optimistic client entries omit it. */
  _id?: string;
  /** The live backend serializes the id as `id` (the spec used `_id`). */
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: AgentToolCallSummary[];
  createdAt: string;
}

/** AI action kinds that need an explicit human confirmation before writing. */
export type AgentActionType =
  | 'create_order'
  | 'register_payment'
  | 'create_customer'
  | 'change_order_status';

/** Lifecycle of a pending AI action. */
export type AgentActionStatus =
  | 'pending'
  | 'executing'
  | 'confirmed'
  | 'cancelled'
  | 'failed'
  | 'expired';

/** Entity created by a confirmed action (order, payment or customer). */
export interface AgentActionResultRef {
  entity: 'order' | 'payment' | 'customer';
  id: string;
  label?: string;
}

/** One write the assistant proposed; it only runs after the user confirms. */
export interface AgentAction {
  id: string;
  /** Id of the assistant message that proposed this action. */
  messageId: string;
  type: AgentActionType;
  preview: string;
  status: AgentActionStatus;
  resultSummary?: string;
  resultRef?: AgentActionResultRef;
  error?: string;
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string;
}

/** GET /v1/agent/chat — always 200, even when the provider is unconfigured. */
export interface AgentChatState {
  enabled: boolean;
  messages: AgentChatMessage[];
  /** Last 50 proposed actions, oldest → newest. */
  actions: AgentAction[];
  rateLimitPerHour: number;
}

/** POST /v1/agent/chat — the assistant reply and the tools it used. */
export interface AgentChatResponse {
  reply: string;
  toolCalls: AgentToolCallSummary[];
}
