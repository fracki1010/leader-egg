// This file runs before any test modules are loaded.
// It sets the required environment variables so that `config/env.ts`
// validates successfully when imported by application code.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-at-least-16-chars-long';
process.env.JWT_EXPIRES_IN = '1h';

// Small, deterministic login rate limits so brute-force tests stay fast.
// Kept above what the existing suite exercises (successful logins are not
// counted, so only failed attempts per IP+email matter per test file).
process.env.LOGIN_RATE_LIMIT_WINDOW_MS = '60000';
process.env.LOGIN_RATE_LIMIT_MAX = '5';
process.env.PLATFORM_LOGIN_RATE_LIMIT_WINDOW_MS = '60000';
process.env.PLATFORM_LOGIN_RATE_LIMIT_MAX = '3';
