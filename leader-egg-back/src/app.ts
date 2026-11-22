import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { router } from './routes/index.js';

export const app = express();

/**
 * Trust the configured number of reverse-proxy hops so `req.ip` reflects the
 * real client (used by the login rate limiter). `TRUST_PROXY` accepts "false"
 * (disabled), a numeric hop count (default "1" for Caddy), or an express
 * trust-proxy value such as "loopback".
 */
const resolveTrustProxy = (raw: string): boolean | number | string => {
  if (raw === 'false') return false;
  if (raw === 'true') return true;
  const asNumber = Number(raw);
  return Number.isNaN(asNumber) ? raw : asNumber;
};

app.set('trust proxy', resolveTrustProxy(env.TRUST_PROXY));
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/api', router);

app.use(notFoundHandler);
app.use(errorHandler);
