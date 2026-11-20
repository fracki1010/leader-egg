import { Schema, type Document } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';

export type UserRole = 'superadmin' | 'admin' | 'driver' | 'viewer' | 'puesto';

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  /** Per-module permissions (only meaningful for admins). */
  permissions: string[];
  /**
   * Session generation counter. Every issued token carries the current value as
   * `tv`; bumping it invalidates all previously issued tokens (password change,
   * platform-forced reset) without storing issued-token ids.
   */
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, enum: ['superadmin', 'admin', 'driver', 'viewer', 'puesto'], default: 'viewer' },
    permissions: { type: [String], default: [] },
    tokenVersion: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

export const User = createScopedModel<IUser>('User', userSchema);
