import 'dotenv/config';
import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { initIoServer } from './websocket/io';
import { startDeploymentWorker, stopDeploymentWorker } from './queue/deploymentWorker';

async function main() {
  // ─── Validate DB connection ──────────────────────────────────────────────
  try {
    await prisma.$connect();
    logger.info('PostgreSQL connected');
  } catch (err) {
    logger.error({ err }, 'Failed to connect to PostgreSQL');
    process.exit(1);
  }

  // ─── Validate Redis connection ───────────────────────────────────────────
  try {
    await redis.connect();
    await redis.ping();
    logger.info('Redis connected');
  } catch (err) {
    logger.error({ err }, 'Failed to connect to Redis');
    process.exit(1);
  }

  // ─── Create HTTP server ──────────────────────────────────────────────────
  const app = createApp();
  const httpServer = http.createServer(app);

  // ─── Initialize WebSocket server ─────────────────────────────────────────
  initIoServer(httpServer);

  // ─── Start BullMQ worker (local/default API runtime) ─────────────────────
  if (env.ENABLE_DEPLOYMENT_WORKER) {
    startDeploymentWorker();
  } else {
    logger.info('Deployment worker disabled for this process');
  }

  // ─── Start listening ─────────────────────────────────────────────────────
  httpServer.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        pid: process.pid,
      },
      `🚀 DevFlow API server running on port ${env.PORT}`
    );
  });

  // ─── Graceful Shutdown ───────────────────────────────────────────────────
  async function shutdown(signal: string) {
    logger.info({ signal }, 'Shutdown signal received, closing gracefully...');

    // Stop accepting new connections
    httpServer.close(async () => {
      try {
        await stopDeploymentWorker();
        await prisma.$disconnect();
        await redis.quit();
        logger.info('Graceful shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception — shutting down');
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection — shutting down');
    shutdown('unhandledRejection');
  });
}

main();
