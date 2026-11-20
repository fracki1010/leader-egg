import { AppError } from '../../middleware/error-handler.js';
import { Payment, accountForMethod, type IPayment } from './model.js';
import { Order } from '../orders/model.js';
import type { CreatePaymentInput } from './schema.js';

// ─── Payment operations ─────────────────────────────────────────────────────

export const recordPayment = async (orderId: string, input: CreatePaymentInput): Promise<IPayment> => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  if (order.status === 'cancelled') {
    throw new AppError('Cannot record payment for a cancelled order', 409);
  }

  if (order.balance <= 0) {
    throw new AppError('Order is already fully paid', 409);
  }

  if (input.amount > order.balance) {
    throw new AppError(
      `Payment amount ($${input.amount}) exceeds order balance ($${order.balance})`,
      400
    );
  }

  // Create payment record — the money account is derived from the method
  // unless an explicit override was sent (e.g. transfer → bank).
  const payment = await Payment.create({
    orderId: order._id,
    amount: input.amount,
    method: input.method,
    account: accountForMethod(input.method, input.account),
    reference: input.reference,
    date: input.date ?? new Date()
  });

  // Update order financials
  order.paidAmount += input.amount;
  order.balance -= input.amount;

  // Derive paymentStatus from balance
  if (order.balance === 0) {
    order.paymentStatus = 'paid';
  } else {
    order.paymentStatus = 'partial';
  }

  await order.save();

  return payment;
};

export const listPaymentsByOrder = async (orderId: string): Promise<IPayment[]> => {
  // Verify order exists
  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  return Payment.find({ orderId }).sort({ date: -1 });
};

export interface Receipt {
  orderNumber: string;
  customerName: string;
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  paymentStatus: string;
  payments: Array<{
    amount: number;
    method: string;
    reference?: string;
    date: Date;
  }>;
  date: Date;
}

export const generateReceipt = async (orderId: string): Promise<Receipt> => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  const payments = await Payment.find({ orderId }).sort({ date: 1 });

  return {
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    items: order.items.map(item => ({
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal
    })),
    totalAmount: order.totalAmount,
    paidAmount: order.paidAmount,
    balance: order.balance,
    paymentStatus: order.paymentStatus,
    payments: payments.map(p => ({
      amount: p.amount,
      method: p.method,
      reference: p.reference,
      date: p.date
    })),
    date: new Date()
  };
};
