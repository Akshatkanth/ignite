import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { getIoServer } from '../websocket/io';
import type { DeploymentJobData } from '../queue/deploymentQueue';
import { deploymentDuration, deploymentsTotal } from '../metrics/registry';
import { DeploymentStatus, LogLevel } from '@devflow/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PipelineContext {
  deploymentId: string;
  repoUrl: string;
  branch: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function updateStatus(deploymentId: string, status: DeploymentStatus): Promise<void> {
  await prisma.deployment.update({
    where: { id: deploymentId },
    data: {
      status,
      ...(status === DeploymentStatus.CLONING ? { startedAt: new Date() } : {}),
      ...(
        status === DeploymentStatus.HEALTHY || status === DeploymentStatus.FAILED
          ? { completedAt: new Date() }
          : {}
      ),
    },
  });

  // Broadcast status change over WebSocket
  const io = getIoServer();
  if (io) {
    io.to(`deployment:${deploymentId}`).emit('deployment:status', {
      deploymentId,
      type: 'status',
      status,
    });
  }
}

async function emitLog(
  deploymentId: string,
  message: string,
  level: LogLevel = LogLevel.INFO
): Promise<void> {
  const timestamp = new Date();

  // Persist log line to DB
  await prisma.deploymentLog.create({
    data: { deploymentId, message, level, timestamp },
  });

  // Broadcast log line over WebSocket
  const io = getIoServer();
  if (io) {
    io.to(`deployment:${deploymentId}`).emit('deployment:log', {
      deploymentId,
      type: 'log',
      log: { message, level, timestamp: timestamp.toISOString() },
    });
  }
}

async function isDeploymentCancelled(deploymentId: string): Promise<boolean> {
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    select: { status: true },
  });

  return deployment?.status === DeploymentStatus.CANCELLED;
}

async function getDeploymentStartTime(deploymentId: string): Promise<Date | null> {
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    select: { startedAt: true },
  });

  return deployment?.startedAt ?? null;
}

function recordDeploymentOutcome(status: 'healthy' | 'failed', framework: string, duration: number | null): void {
  deploymentsTotal.inc({ status, framework });

  if (duration !== null) {
    deploymentDuration.observe({ status, framework }, duration);
  }
}

/** Delay helper that simulates real pipeline latency */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Generate a plausible-looking short commit SHA */
function mockCommitSha(): string {
  return Math.random().toString(16).slice(2, 9);
}

// ─── Simulated Pipeline Steps ─────────────────────────────────────────────────

async function stepClone(ctx: PipelineContext): Promise<string> {
  const { deploymentId, repoUrl, branch } = ctx;
  await updateStatus(deploymentId, DeploymentStatus.CLONING);

  await emitLog(deploymentId, `Cloning repository: ${repoUrl}`);
  await delay(800);
  await emitLog(deploymentId, `Resolving branch: ${branch}`);
  await delay(600);
  await emitLog(deploymentId, `remote: Enumerating objects: 147, done.`);
  await delay(400);
  await emitLog(deploymentId, `remote: Counting objects: 100% (147/147), done.`);
  await delay(500);
  await emitLog(deploymentId, `remote: Compressing objects: 100% (89/89), done.`);
  await delay(700);
  await emitLog(deploymentId, `Receiving objects: 100% (147/147), 284.21 KiB | 3.40 MiB/s, done.`);
  await delay(300);

  const sha = mockCommitSha();
  await emitLog(deploymentId, `HEAD is now at ${sha}`);
  await emitLog(deploymentId, `✓ Repository cloned successfully`, LogLevel.SUCCESS);

  return sha;
}

async function stepValidate(ctx: PipelineContext): Promise<string> {
  const { deploymentId, repoUrl } = ctx;
  await updateStatus(deploymentId, DeploymentStatus.VALIDATING);

  await emitLog(deploymentId, `Validating project structure...`);
  await delay(500);

  // Detect framework from repo URL heuristic
  const repoName = repoUrl.split('/').pop()?.toLowerCase() ?? '';
  let framework = 'node';
  let runtime = 'Node.js 20';

  if (repoName.includes('python') || repoName.includes('django') || repoName.includes('flask')) {
    framework = 'python';
    runtime = 'Python 3.11';
  } else if (repoName.includes('go') || repoName.includes('golang')) {
    framework = 'go';
    runtime = 'Go 1.22';
  } else if (repoName.includes('next') || repoName.includes('react')) {
    framework = 'nextjs';
    runtime = 'Node.js 20 (Next.js)';
  }

  await emitLog(deploymentId, `Detected runtime: ${runtime}`);
  await delay(400);
  await emitLog(deploymentId, `Found: package.json`);
  await delay(300);
  await emitLog(deploymentId, `Found: Dockerfile`);
  await delay(300);
  await emitLog(deploymentId, `Checking for required build scripts...`);
  await delay(500);
  await emitLog(deploymentId, `✓ Project structure valid`, LogLevel.SUCCESS);

  return framework;
}

async function stepBuild(ctx: PipelineContext, framework: string): Promise<void> {
  const { deploymentId } = ctx;
  await updateStatus(deploymentId, DeploymentStatus.BUILDING);

  await emitLog(deploymentId, `Building Docker image...`);
  await delay(600);
  await emitLog(deploymentId, `Step 1/8 : FROM node:20-alpine`);
  await delay(800);
  await emitLog(deploymentId, ` ---> 3f4d89ab2c1e`);
  await delay(300);
  await emitLog(deploymentId, `Step 2/8 : WORKDIR /app`);
  await delay(400);
  await emitLog(deploymentId, ` ---> Running in a4b2c9d8e1f3`);
  await delay(500);
  await emitLog(deploymentId, `Step 3/8 : COPY package*.json ./`);
  await delay(300);
  await emitLog(deploymentId, `Step 4/8 : RUN npm ci --only=production`);
  await delay(600);
  await emitLog(deploymentId, `npm warn deprecated inflight@1.0.6`);
  await delay(400);

  if (framework === 'nextjs') {
    await emitLog(deploymentId, `npm warn deprecated @humanwhocodes/config-array@0.11.14`);
    await delay(300);
  }

  await emitLog(deploymentId, `added 247 packages in 8.432s`);
  await delay(500);
  await emitLog(deploymentId, `Step 5/8 : COPY . .`);
  await delay(400);
  await emitLog(deploymentId, `Step 6/8 : RUN npm run build`);
  await delay(800);

  if (framework === 'nextjs') {
    await emitLog(deploymentId, `  ▲ Next.js 14.2.0`);
    await delay(300);
    await emitLog(deploymentId, `  Creating an optimized production build...`);
    await delay(1200);
    await emitLog(deploymentId, `  ✓ Compiled successfully`);
    await delay(400);
  } else {
    await emitLog(deploymentId, `> build`);
    await delay(600);
    await emitLog(deploymentId, `> tsc && node esbuild.js`);
    await delay(1000);
  }

  await emitLog(deploymentId, `Step 7/8 : EXPOSE 3000`);
  await delay(300);
  await emitLog(deploymentId, `Step 8/8 : CMD ["node", "dist/index.js"]`);
  await delay(400);
  await emitLog(deploymentId, `Successfully built 8f3a2c9d1b4e`);
  await delay(300);
  await emitLog(deploymentId, `Successfully tagged devflow-app:latest`);
  await delay(200);
  await emitLog(deploymentId, `✓ Docker image built successfully`, LogLevel.SUCCESS);
}

async function stepHealthCheck(ctx: PipelineContext): Promise<void> {
  const { deploymentId } = ctx;
  await updateStatus(deploymentId, DeploymentStatus.HEALTH_CHECK);

  await emitLog(deploymentId, `Running health checks...`);
  await delay(600);
  await emitLog(deploymentId, `Starting container on port 3000...`);
  await delay(800);
  await emitLog(deploymentId, `Waiting for application to be ready...`);
  await delay(1000);

  // Simulate 3 health check probes
  for (let i = 1; i <= 3; i++) {
    await delay(600);
    await emitLog(deploymentId, `Health probe ${i}/3: GET http://localhost:3000/health`);
    await delay(400);
    if (i < 3) {
      await emitLog(deploymentId, `  → 200 OK (${120 + i * 15}ms)`);
    }
  }

  await delay(300);
  await emitLog(deploymentId, `  → 200 OK (142ms)`);
  await delay(400);
  await emitLog(deploymentId, `✓ All health checks passed`, LogLevel.SUCCESS);
}

// ─── Main Job Runner ──────────────────────────────────────────────────────────

export async function runDeploymentJob(data: DeploymentJobData): Promise<void> {
  const { deploymentId, repoUrl, branch } = data;
  const ctx: PipelineContext = { deploymentId, repoUrl, branch };

  logger.info({ deploymentId }, 'Starting deployment pipeline');

  try {
    if (await isDeploymentCancelled(deploymentId)) {
      logger.info({ deploymentId }, 'Deployment was cancelled before pipeline started');
      return;
    }

    // Step 1: Clone
    const commitSha = await stepClone(ctx);

    if (await isDeploymentCancelled(deploymentId)) {
      logger.info({ deploymentId }, 'Deployment was cancelled after clone step');
      return;
    }

    // Step 2: Validate
    const framework = await stepValidate(ctx);

    if (await isDeploymentCancelled(deploymentId)) {
      logger.info({ deploymentId }, 'Deployment was cancelled after validate step');
      return;
    }

    // Step 3: Build
    await stepBuild(ctx, framework);

    if (await isDeploymentCancelled(deploymentId)) {
      logger.info({ deploymentId }, 'Deployment was cancelled after build step');
      return;
    }

    // Step 4: Health Check
    await stepHealthCheck(ctx);

    if (await isDeploymentCancelled(deploymentId)) {
      logger.info({ deploymentId }, 'Deployment was cancelled after health check step');
      return;
    }

    // Finalize: Calculate duration and mark complete
    const startedAt = await getDeploymentStartTime(deploymentId);
    const duration = startedAt
      ? Math.round((Date.now() - startedAt.getTime()) / 1000)
      : null;

    await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: DeploymentStatus.HEALTHY,
        commitSha,
        completedAt: new Date(),
        duration,
      },
    });

    recordDeploymentOutcome('healthy', 'unknown', duration);

    await emitLog(
      deploymentId,
      `\n🚀 Deployment complete! Duration: ${duration}s`,
      LogLevel.SUCCESS
    );

    await updateStatus(deploymentId, DeploymentStatus.HEALTHY);
    logger.info({ deploymentId, duration }, 'Deployment pipeline completed');
  } catch (err) {
    if (await isDeploymentCancelled(deploymentId)) {
      logger.info({ deploymentId }, 'Deployment pipeline stopped because it was cancelled');
      return;
    }

    const error = err instanceof Error ? err.message : 'Unknown error';

    logger.error({ deploymentId, err }, 'Deployment pipeline failed');

    await emitLog(
      deploymentId,
      `\n✗ Deployment failed: ${error}`,
      LogLevel.ERROR
    );

    await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: DeploymentStatus.FAILED,
        error,
        completedAt: new Date(),
      },
    });

    const startedAt = await getDeploymentStartTime(deploymentId);
    const duration = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 1000) : null;
    recordDeploymentOutcome('failed', 'unknown', duration);

    await updateStatus(deploymentId, DeploymentStatus.FAILED);

    // Re-throw so BullMQ can handle retries
    throw err;
  }
}
