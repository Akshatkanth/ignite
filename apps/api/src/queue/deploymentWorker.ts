import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { runDeploymentJob } from '../jobs/deploymentJob';
import { DEPLOYMENT_QUEUE_NAME } from './deploymentQueue';
import type { DeploymentJobData } from './deploymentQueue';
import { activeDeployments } from '../metrics/registry';

let worker: Worker<DeploymentJobData> | null = null;

export function startDeploymentWorker(): Worker<DeploymentJobData> {
  if (worker) return worker;

  worker = new Worker<DeploymentJobData>(
    DEPLOYMENT_QUEUE_NAME,
    async (job: Job<DeploymentJobData>) => {
      logger.info(
        { jobId: job.id, deploymentId: job.data.deploymentId, attempt: job.attemptsMade + 1 },
        'Worker processing deployment job'
      );
      await runDeploymentJob(job.data);
    },
    {
      connection: redis,
      concurrency: 3, // Process up to 3 deployments simultaneously
      limiter: {
        max: 5,
        duration: 10_000, // Max 5 jobs per 10 seconds
      },
    }
  );

  worker.on('completed', (job) => {
    activeDeployments.dec();
    logger.info(
      { jobId: job.id, deploymentId: job.data.deploymentId },
      'Deployment job completed'
    );
  });

  worker.on('failed', (job, err) => {
    activeDeployments.dec();
    logger.error(
      { jobId: job?.id, deploymentId: job?.data.deploymentId, err },
      'Deployment job failed'
    );
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Deployment worker error');
  });

  logger.info({ concurrency: 3 }, 'Deployment worker started');
  return worker;
}

export async function stopDeploymentWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('Deployment worker stopped');
  }
}
