import mongoose, { type Connection, type Schema } from 'mongoose';

import { userSchema } from '../modules/auth/model.js';
import { businessConfigSchema } from '../modules/config/model.js';
import { counterSchema } from '../modules/counters/model.js';
import { customerSchema } from '../modules/customers/model.js';
import { dailyCloseSchema } from '../modules/daily-closes/model.js';
import { expenseSchema } from '../modules/expenses/model.js';
import { inventorySchema } from '../modules/inventory/model.js';
import { transactionSchema } from '../modules/inventory/transaction-model.js';
import { orderSchema } from '../modules/orders/model.js';
import { paymentSchema } from '../modules/payments/model.js';
import { productSchema } from '../modules/products/model.js';
import { priceEntrySchema } from '../modules/products/price-list-model.js';
import { promotionSchema } from '../modules/promotions/model.js';
import { purchaseSchema } from '../modules/purchases/model.js';
import { returnSchema } from '../modules/returns/model.js';
import { routeSchema } from '../modules/routes/model.js';
import { supplierSchema } from '../modules/suppliers/model.js';
import { vehicleSchema } from '../modules/vehicles/model.js';

interface ModelRegistration {
  name: string;
  schema: Schema;
}

/**
 * Every tenant-bound model, paired with its schema. Models are compiled per
 * connection (a Mongoose model is bound to the connection it was compiled on).
 */
const REGISTRATIONS: ModelRegistration[] = [
  { name: 'User', schema: userSchema },
  { name: 'BusinessConfig', schema: businessConfigSchema },
  { name: 'Counter', schema: counterSchema },
  { name: 'Customer', schema: customerSchema },
  { name: 'DailyClose', schema: dailyCloseSchema },
  { name: 'Expense', schema: expenseSchema },
  { name: 'Inventory', schema: inventorySchema },
  { name: 'StockTransaction', schema: transactionSchema },
  { name: 'Order', schema: orderSchema },
  { name: 'Payment', schema: paymentSchema },
  { name: 'Product', schema: productSchema },
  { name: 'PriceEntry', schema: priceEntrySchema },
  { name: 'Promotion', schema: promotionSchema },
  { name: 'Purchase', schema: purchaseSchema },
  { name: 'Return', schema: returnSchema },
  { name: 'Route', schema: routeSchema },
  { name: 'Supplier', schema: supplierSchema },
  { name: 'Vehicle', schema: vehicleSchema }
];

/** Model names registered on every tenant connection. */
export const TENANT_MODEL_NAMES: readonly string[] = REGISTRATIONS.map((r) => r.name);

/**
 * Compiles every tenant model on `conn`, idempotently. Safe to call multiple
 * times: already-compiled models are reused (`conn.models[name]`).
 */
export const registerModels = (conn: Connection): void => {
  for (const { name, schema } of REGISTRATIONS) {
    if (!conn.models[name]) {
      conn.model(name, schema);
    }
  }
};

/**
 * Returns the cached connection for `dbName` with all tenant models registered.
 * Uses `mongoose.connection.useDb(..., { useCache: true })` so a db gets exactly
 * one Connection (and one set of models) for the lifetime of the process.
 */
export const getTenantConnection = (dbName: string): Connection => {
  const conn = mongoose.connection.useDb(dbName, { useCache: true });
  registerModels(conn);
  return conn;
};
