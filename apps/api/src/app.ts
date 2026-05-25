import express, { Request, Response } from 'express';
import path from 'node:path';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';

import { env } from './config/env';
import { logger } from './config/logger';
import { register } from './metrics/registry';
import { httpRequestsTotal, httpRequestDuration } from './metrics/registry';
import { generalLimiter } from './middleware/rateLimiter';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

// Route modules
import authRoutes from './modules/auth/auth.routes';
import projectsRoutes from './modules/projects/projects.routes';
import deploymentsRoutes from './modules/deployments/deployments.routes';

function parseCorsOrigins(value: string): string[] | '*' {
  const trimmed = value.trim();
  if (trimmed === '*') {
    return '*';
  }

  return trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function createApp() {
  const app = express();
  // Resolve previews directory at repository root so it matches where
  // the capture worker writes images (repoRoot/storage/previews).
  function findRepoRoot(startDir: string): string {
    let dir = startDir;
    for (let i = 0; i < 8; i++) {
      try {
        const pkg = path.join(dir, 'package.json');
        if (require('fs').existsSync(pkg)) return dir;
      } catch {}
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return process.cwd();
  }

  const repoRoot = findRepoRoot(__dirname);
  const previewStorageDir = path.resolve(repoRoot, 'storage', 'previews');
  const altPreviewStorageDir = path.resolve(process.cwd(), 'storage', 'previews');

  // ─── Security Middleware ───────────────────────────────────────────────────
  app.use(helmet());
  const corsOrigin = parseCorsOrigins(env.CORS_ORIGIN);
  const corsOptions = {
    origin: corsOrigin,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };

  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));

  // ─── Request Parsing ───────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(compression());

  // ─── Request Logging (Pino HTTP) ───────────────────────────────────────────
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res) => {
        if (res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage: (req, res) =>
        `${req.method} ${req.url} ${res.statusCode}`,
    })
  );

  // ─── HTTP Metrics Middleware ───────────────────────────────────────────────
  app.use((req: Request, res: Response, next) => {
    const start = Date.now();
    const route = req.path;

    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000;
      httpRequestsTotal.inc({
        method: req.method,
        route,
        status_code: String(res.statusCode),
      });
      httpRequestDuration.observe({ method: req.method, route }, duration);
    });

    next();
  });

  // ─── Rate Limiting ─────────────────────────────────────────────────────────
  app.use('/api/', generalLimiter);

  // ─── Health & Metrics ──────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      version: process.env.npm_package_version ?? '0.1.0',
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    });
  });

  // ─── Deployment previews ───────────────────────────────────────────────────
  // Serve previews from both the repository-root storage and the process
  // cwd storage to cover different startup working directories.
  logger.info({ previewStorageDir, altPreviewStorageDir }, 'Preview storage directories');
  app.use('/previews', express.static(previewStorageDir));
  if (altPreviewStorageDir !== previewStorageDir) {
    app.use('/previews', express.static(altPreviewStorageDir));
  }

  // Prometheus scrape endpoint
  app.get('/metrics', async (_req: Request, res: Response) => {
    try {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch (err) {
      res.status(500).end(String(err));
    }
  });

  // ─── API Routes ────────────────────────────────────────────────────────────
  app.use('/api/auth', authRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api', deploymentsRoutes);

  // ─── 404 & Error Handlers ──────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
