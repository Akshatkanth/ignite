import 'dotenv/config';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { logger } from './config/logger';
import { env } from './config/env';
import { startDeploymentWorker, stopDeploymentWorker } from './queue/deploymentWorker';

async function main() {
  try {
    await prisma.$connect();
    logger.info('PostgreSQL connected for worker');
  } catch (err) {
    logger.error({ err }, 'Worker failed to connect to PostgreSQL');
    process.exit(1);
  }

  try {
    await redis.connect();
    await redis.ping();
    logger.info('Redis connected for worker');
  } catch (err) {
    logger.error({ err }, 'Worker failed to connect to Redis');
    process.exit(1);
  }

  startDeploymentWorker();

  logger.info(
    {
      env: env.NODE_ENV,
      pid: process.pid,
    },
    'Deployment worker running'
  );

  async function shutdown(signal: string) {
    logger.info({ signal }, 'Worker shutdown signal received');

    try {
      await stopDeploymentWorker();
      await prisma.$disconnect();
      await redis.quit();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during worker shutdown');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Worker uncaught exception — shutting down');
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Worker unhandled promise rejection — shutting down');
    shutdown('unhandledRejection');
  });
}

main();