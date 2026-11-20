import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  loginAs
} from './helpers.js';
import { app } from '../app.js';
import { User } from '../modules/auth/model.js';
import { Route } from '../modules/routes/model.js';
import mongoose from 'mongoose';

const request = supertest(app);

describe('Auth Integration', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  describe('POST /api/v1/auth/login', () => {
    it('returns JWT token on valid credentials', async () => {
      const { email, password } = await seedAdminUser();

      const response = await request
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(email);
      expect(response.body.user.role).toBe('admin');
      expect(typeof response.body.token).toBe('string');
      expect(response.body.token.split('.')).toHaveLength(3); // JWT format
    });

    it('returns 401 on invalid password', async () => {
      await seedAdminUser();

      const response = await request
        .post('/api/v1/auth/login')
        .send({ email: 'admin@test.com', password: 'wrongpassword' })
        .expect(401);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toMatch(/invalid credentials/i);
    });

    it('returns 401 on non-existent user', async () => {
      const response = await request
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@test.com', password: 'password123' })
        .expect(401);

      expect(response.body.error).toMatch(/invalid credentials/i);
    });

    it('returns 400 on missing fields', async () => {
      const response = await request
        .post('/api/v1/auth/login')
        .send({ email: 'admin@test.com' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('returns 400 on invalid email format', async () => {
      const response = await request
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: 'password123' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('invalidates token — subsequent requests return 401', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      // Logout
      await request
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      // Try to access a protected route with the same token
      const response = await request
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      expect(response.body.error).toMatch(/revoked|invalid/i);
    });

    it('returns 401 without authorization header', async () => {
      await request
        .post('/api/v1/auth/logout')
        .expect(401);
    });
  });

  describe('POST /api/v1/auth/register', () => {
    it('admin can register a new user', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const response = await request
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'New Driver',
          email: 'newdriver@test.com',
          password: 'driver123',
          role: 'driver'
        })
        .expect(201);

      expect(response.body.user.email).toBe('newdriver@test.com');
      expect(response.body.user.role).toBe('driver');
    });

    it('rejects the retired superadmin role on register (400)', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const response = await request
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'New Superadmin',
          email: 'newsuperadmin@test.com',
          password: 'super123',
          role: 'superadmin'
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('admin can register a puesto (stall) user', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const response = await request
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Empleado Puesto',
          email: 'puesto@test.com',
          password: 'puesto123',
          role: 'puesto'
        })
        .expect(201);

      expect(response.body.user.email).toBe('puesto@test.com');
      expect(response.body.user.role).toBe('puesto');

      const stored = await User.findOne({ email: 'puesto@test.com' });
      expect(stored!.role).toBe('puesto');
    });

    it('returns 403 when driver tries to register', async () => {
      await seedAdminUser();
      const { email, password } = await seedDriverUser();
      const driverToken = await loginAs(request, email, password);

      await request
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          name: 'Another User',
          email: 'another@test.com',
          password: 'password123',
          role: 'viewer'
        })
        .expect(403);
    });

    it('returns 401 without authentication', async () => {
      await request
        .post('/api/v1/auth/register')
        .send({
          name: 'New User',
          email: 'new@test.com',
          password: 'password123',
          role: 'viewer'
        })
        .expect(401);
    });

    it('returns 409 on duplicate email', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      await request
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Duplicate',
          email: 'admin@test.com', // same email
          password: 'password123',
          role: 'viewer'
        })
        .expect(409);
    });
  });

  describe('Role-based access control', () => {
    it('admin can access customer routes', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      await request
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('driver cannot access admin-only customer write routes', async () => {
      await seedAdminUser();
      const { email, password } = await seedDriverUser();
      const driverToken = await loginAs(request, email, password);

      await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          name: 'Test',
          type: 'B2C',
          phone: '+1234567890',
          address: '123 St'
        })
        .expect(403);
    });

    it('returns 401 on protected route without token', async () => {
      await request
        .get('/api/v1/customers')
        .expect(401);
    });

    it('returns 401 with malformed authorization header', async () => {
      await request
        .get('/api/v1/customers')
        .set('Authorization', 'NotBearer some-token')
        .expect(401);
    });

    it('returns 401 with expired/invalid token', async () => {
      await request
        .get('/api/v1/customers')
        .set('Authorization', 'Bearer invalid.token.here')
        .expect(401);
    });
  });

  describe('GET /api/v1/users/drivers', () => {
    it('returns only driver-role users sorted by name', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const passwordHash = await bcrypt.hash('testpassword', 10);
      await User.create([
        { name: 'Zoe Driver', email: 'zoe@test.com', passwordHash, role: 'driver' },
        { name: 'Ana Driver', email: 'ana@test.com', passwordHash, role: 'driver' },
        { name: 'Viewer User', email: 'viewer@test.com', passwordHash, role: 'viewer' }
      ]);
      const { email: driverEmail } = await seedDriverUser();

      const response = await request
        .get('/api/v1/users/drivers')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(3);
      expect(response.body.map((d: { name: string }) => d.name)).toEqual([
        'Ana Driver',
        'Test Driver',
        'Zoe Driver'
      ]);
      expect(response.body[0]).toMatchObject({
        _id: expect.any(String),
        name: expect.any(String),
        email: expect.any(String)
      });
      expect(response.body[0]).not.toHaveProperty('role');
      expect(response.body[0]).not.toHaveProperty('passwordHash');
    });

    it('returns an empty array when there are no drivers', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const response = await request
        .get('/api/v1/users/drivers')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('returns 403 when a driver tries to list drivers', async () => {
      await seedAdminUser();
      const { email, password } = await seedDriverUser();
      const driverToken = await loginAs(request, email, password);

      await request
        .get('/api/v1/users/drivers')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });

    it('returns 401 without authentication', async () => {
      await request
        .get('/api/v1/users/drivers')
        .expect(401);
    });
  });

  describe('GET /api/v1/users', () => {
    it('returns all users sorted by name with role and createdAt', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const passwordHash = await bcrypt.hash('testpassword', 10);
      await User.create([
        { name: 'Zoe Driver', email: 'zoe@test.com', passwordHash, role: 'driver' },
        { name: 'Ana Viewer', email: 'ana@test.com', passwordHash, role: 'viewer' }
      ]);
      const { email: driverEmail } = await seedDriverUser();

      const response = await request
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(4); // admin + 2 created + seeded driver
      expect(response.body.map((u: { name: string }) => u.name)).toEqual([
        'Ana Viewer',
        'Test Admin',
        'Test Driver',
        'Zoe Driver'
      ]);
      expect(response.body[0]).toMatchObject({
        _id: expect.any(String),
        name: expect.any(String),
        email: expect.any(String),
        role: expect.any(String),
        createdAt: expect.any(String)
      });
      expect(response.body[0]).not.toHaveProperty('passwordHash');
      expect(response.body[0]).not.toHaveProperty('updatedAt');
    });

    it('returns 403 when a driver tries to list all users', async () => {
      await seedAdminUser();
      const { email, password } = await seedDriverUser();
      const driverToken = await loginAs(request, email, password);

      await request
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });

    it('returns 401 without authentication', async () => {
      await request
        .get('/api/v1/users')
        .expect(401);
    });
  });

  describe('DELETE /api/v1/users/:id', () => {
    it('deletes a user and returns 204', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const passwordHash = await bcrypt.hash('testpassword', 10);
      const target = await User.create({
        name: 'Doomed Viewer',
        email: 'doomed@test.com',
        passwordHash,
        role: 'viewer'
      });

      await request
        .delete(`/api/v1/users/${target._id.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const remaining = await User.findById(target._id);
      expect(remaining).toBeNull();
    });

    it('returns 404 when the user does not exist', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const response = await request
        .delete(`/api/v1/users/${new mongoose.Types.ObjectId().toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(response.body.error).toMatch(/not found/i);
    });

    it('returns 409 when an admin tries to delete their own user', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const admin = await User.findOne({ email });
      const response = await request
        .delete(`/api/v1/users/${admin!._id.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      expect(response.body.error).toMatch(/own user/i);
    });

    it('returns 409 when the user has routes assigned', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const passwordHash = await bcrypt.hash('testpassword', 10);
      const driver = await User.create({
        name: 'Busy Driver',
        email: 'busy@test.com',
        passwordHash,
        role: 'driver'
      });

      await Route.create({
        routeNumber: 'R-DELETE-GUARD',
        driverId: driver._id,
        driverName: driver.name,
        plannedDate: new Date('2026-08-25'),
        status: 'planned',
        stops: []
      });

      const response = await request
        .delete(`/api/v1/users/${driver._id.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      expect(response.body.error).toMatch(/assigned routes/i);

      // User still exists — deletion was blocked
      const remaining = await User.findById(driver._id);
      expect(remaining).not.toBeNull();
    });

    it('returns 403 when a driver tries to delete a user', async () => {
      await seedAdminUser();
      const { email, password } = await seedDriverUser();
      const driverToken = await loginAs(request, email, password);

      const passwordHash = await bcrypt.hash('testpassword', 10);
      const target = await User.create({
        name: 'Other Viewer',
        email: 'other-viewer@test.com',
        passwordHash,
        role: 'viewer'
      });

      await request
        .delete(`/api/v1/users/${target._id.toString()}`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });

    it('returns 401 without authentication', async () => {
      await request
        .delete(`/api/v1/users/${new mongoose.Types.ObjectId().toString()}`)
        .expect(401);
    });
  });

  describe('PATCH /api/v1/users/:id', () => {
    it('changes a user role (driver → viewer) and returns 200', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const passwordHash = await bcrypt.hash('testpassword', 10);
      const target = await User.create({
        name: 'Role Change Driver',
        email: 'rolechange@test.com',
        passwordHash,
        role: 'driver'
      });

      const response = await request
        .patch(`/api/v1/users/${target._id.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'viewer' })
        .expect(200);

      expect(response.body.user.role).toBe('viewer');
      expect(response.body.user._id).toBe(target._id.toString());

      const updated = await User.findById(target._id);
      expect(updated!.role).toBe('viewer');
    });

    it('rejects the retired superadmin role on role change (400)', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const passwordHash = await bcrypt.hash('testpassword', 10);
      const target = await User.create({
        name: 'Role Change Driver',
        email: 'rolechange@test.com',
        passwordHash,
        role: 'driver'
      });

      const response = await request
        .patch(`/api/v1/users/${target._id.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'superadmin' })
        .expect(400);

      expect(response.body).toHaveProperty('error');

      const unchanged = await User.findById(target._id);
      expect(unchanged!.role).toBe('driver');
    });

    it('changes a user role (viewer → puesto) and returns 200', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const passwordHash = await bcrypt.hash('testpassword', 10);
      const target = await User.create({
        name: 'Role Change Viewer',
        email: 'rolechange-puesto@test.com',
        passwordHash,
        role: 'viewer'
      });

      const response = await request
        .patch(`/api/v1/users/${target._id.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'puesto' })
        .expect(200);

      expect(response.body.user.role).toBe('puesto');

      const updated = await User.findById(target._id);
      expect(updated!.role).toBe('puesto');
    });

    it('is idempotent when the role does not change', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const passwordHash = await bcrypt.hash('testpassword', 10);
      const target = await User.create({
        name: 'Same Role',
        email: 'samerole@test.com',
        passwordHash,
        role: 'driver'
      });

      const response = await request
        .patch(`/api/v1/users/${target._id.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'driver' })
        .expect(200);

      expect(response.body.user.role).toBe('driver');
    });

    it('returns 409 when an admin tries to change their own role', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const admin = await User.findOne({ email });
      const response = await request
        .patch(`/api/v1/users/${admin!._id.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'viewer' })
        .expect(409);

      expect(response.body.error).toMatch(/own role/i);

      // Role was not changed
      const unchanged = await User.findById(admin!._id);
      expect(unchanged!.role).toBe('admin');
    });

    it('returns 400 on an invalid role', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const passwordHash = await bcrypt.hash('testpassword', 10);
      const target = await User.create({
        name: 'Invalid Role',
        email: 'invalidrole@test.com',
        passwordHash,
        role: 'viewer'
      });

      const response = await request
        .patch(`/api/v1/users/${target._id.toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'superuser' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('returns 404 when the user does not exist', async () => {
      const { email, password } = await seedAdminUser();
      const token = await loginAs(request, email, password);

      const response = await request
        .patch(`/api/v1/users/${new mongoose.Types.ObjectId().toString()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'viewer' })
        .expect(404);

      expect(response.body.error).toMatch(/not found/i);
    });

    it('returns 403 when a driver tries to change a user role', async () => {
      await seedAdminUser();
      const { email, password } = await seedDriverUser();
      const driverToken = await loginAs(request, email, password);

      const passwordHash = await bcrypt.hash('testpassword', 10);
      const target = await User.create({
        name: 'Other Viewer',
        email: 'other-viewer-role@test.com',
        passwordHash,
        role: 'viewer'
      });

      await request
        .patch(`/api/v1/users/${target._id.toString()}`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ role: 'driver' })
        .expect(403);
    });

    it('returns 401 without authentication', async () => {
      await request
        .patch(`/api/v1/users/${new mongoose.Types.ObjectId().toString()}`)
        .send({ role: 'viewer' })
        .expect(401);
    });
  });
});
