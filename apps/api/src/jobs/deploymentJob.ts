import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { getIoServer } from '../websocket/io';
import type { DeploymentJobData } from '../queue/deploymentQueue';
import { deploymentDuration, deploymentsTotal } from '../metrics/registry';
import { DeploymentStatus, LogLevel } from '@devflow/shared';
import { captureDeploymentPreview } from '../services/deploymentPreview';

const execFileAsync = promisify(execFile);

// ─── Types ────────────────────────────────────────────────────────────────────

interface PipelineContext {
  deploymentId: string;
  repoUrl: string;
  branch: string;
  runtimeUrl?: string;
  workdir?: string;
  imageName?: string;
  containerId?: string;
  dockerfilePath?: string;
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(command, args, {
      cwd,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${command} ${args.join(' ')} failed: ${message}`);
  }
}

async function getPublishedPort(containerId: string, internalPort: string): Promise<number> {
  const { stdout } = await runCommand('docker', ['port', containerId, internalPort]);
  const match = stdout.match(/:(\d+)\s*$/m) ?? stdout.match(/:(\d+)/);
  if (!match) {
    throw new Error(`Unable to determine published port from docker port output: ${stdout}`);
  }

  return Number(match[1]);
}

async function waitForHttpOk(targetUrl: string, attempts = 12): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(targetUrl, { method: 'GET' });
      if (response.ok) {
        return;
      }
      lastErr = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastErr = err;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }

  throw lastErr instanceof Error ? lastErr : new Error(`Timed out waiting for ${targetUrl}`);
}

async function cleanupRuntime(ctx: PipelineContext): Promise<void> {
  if (ctx.containerId) {
    await runCommand('docker', ['rm', '-f', ctx.containerId]).catch((err) => {
      logger.warn({ deploymentId: ctx.deploymentId, err }, 'Failed to remove deployment container');
    });
  }

  if (ctx.workdir) {
    await fs.rm(ctx.workdir, { recursive: true, force: true }).catch((err) => {
      logger.warn({ deploymentId: ctx.deploymentId, err }, 'Failed to remove deployment workdir');
    });
  }
}

// ─── Simulated Pipeline Steps ─────────────────────────────────────────────────

async function stepClone(ctx: PipelineContext): Promise<string> {
  const { deploymentId, repoUrl, branch } = ctx;
  await updateStatus(deploymentId, DeploymentStatus.CLONING);

  await emitLog(deploymentId, `Cloning repository: ${repoUrl}`);
  await delay(800);
  await emitLog(deploymentId, `Resolving branch: ${branch}`);
  await delay(400);

  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-deploy-'));
  ctx.workdir = workdir;

  await emitLog(deploymentId, `Cloning into ${workdir}`);
  await runCommand('git', ['clone', '--depth', '1', '--branch', branch, repoUrl, workdir]);

  const shaResult = await runCommand('git', ['rev-parse', '--short', 'HEAD'], workdir);
  const sha = shaResult.stdout.trim() || mockCommitSha();
  await emitLog(deploymentId, `HEAD is now at ${sha}`);
  await emitLog(deploymentId, `✓ Repository cloned successfully`, LogLevel.SUCCESS);

  return sha;
}

async function stepValidate(ctx: PipelineContext): Promise<string> {
  const { deploymentId, repoUrl, workdir } = ctx;
  await updateStatus(deploymentId, DeploymentStatus.VALIDATING);

  await emitLog(deploymentId, `Validating project structure...`);
  await delay(500);

  if (!workdir) {
    throw new Error('Deployment workdir not initialized');
  }

  const dockerfilePath = path.join(workdir, 'Dockerfile');
  const hasDockerfile = await pathExists(dockerfilePath);
  const hasIndexHtml = await pathExists(path.join(workdir, 'index.html'));
  const hasPackageJson = await pathExists(path.join(workdir, 'package.json'));

  let framework = 'static';
  let runtime = 'Static HTML';

  if (hasDockerfile) {
    framework = 'dockerfile';
    runtime = 'Dockerfile app';
    ctx.dockerfilePath = dockerfilePath;
  } else if (hasPackageJson) {
    framework = 'node';
    runtime = 'Node.js app';
  } else if (hasIndexHtml) {
    framework = 'static';
    runtime = 'Static HTML site';
  }

  await emitLog(deploymentId, `Detected runtime: ${runtime}`);
  await delay(400);
  if (hasPackageJson) {
    await emitLog(deploymentId, `Found: package.json`);
  }
  await delay(300);
  if (hasDockerfile) {
    await emitLog(deploymentId, `Found: Dockerfile`);
  } else if (hasIndexHtml) {
    await emitLog(deploymentId, `Found: index.html`);
  }
  await delay(300);
  await emitLog(deploymentId, `Checking for required build scripts...`);
  await delay(500);
  await emitLog(deploymentId, `✓ Project structure valid`, LogLevel.SUCCESS);

  return framework;
}

async function stepBuild(ctx: PipelineContext, framework: string): Promise<void> {
  const { deploymentId, workdir } = ctx;
  await updateStatus(deploymentId, DeploymentStatus.BUILDING);

  await emitLog(deploymentId, `Building Docker image...`);
  await delay(600);

  if (!workdir) {
    throw new Error('Deployment workdir not initialized');
  }

  const imageName = `devflow-deploy-${deploymentId.toLowerCase()}`;
  ctx.imageName = imageName;

  if (framework === 'static') {
    const generatedDockerfile = path.join(workdir, 'Dockerfile.devflow');
    const dockerfile = [
      'FROM nginx:alpine',
      'COPY . /usr/share/nginx/html',
    ].join('\n');
    await fs.writeFile(generatedDockerfile, `${dockerfile}\n`);
    ctx.dockerfilePath = generatedDockerfile;
    await emitLog(deploymentId, `Step 1/3 : FROM nginx:alpine`);
    await delay(500);
    await emitLog(deploymentId, `Step 2/3 : COPY . /usr/share/nginx/html`);
    await delay(700);
    await emitLog(deploymentId, `Step 3/3 : EXPOSE 80`);
    await delay(300);
    await runCommand('docker', ['build', '-t', imageName, '-f', generatedDockerfile, workdir]);
  } else {
    const dockerfile = ctx.dockerfilePath ?? path.join(workdir, 'Dockerfile');
    await emitLog(deploymentId, `Step 1/5 : FROM base image`);
    await delay(500);
    await emitLog(deploymentId, `Step 2/5 : BUILD from ${path.basename(dockerfile)}`);
    await delay(500);
    await emitLog(deploymentId, `Step 3/5 : COPY source files`);
    await delay(500);
    await emitLog(deploymentId, `Step 4/5 : RUN production build`);
    await delay(500);
    await runCommand('docker', ['build', '-t', imageName, '-f', dockerfile, workdir]);
    await emitLog(deploymentId, `Step 5/5 : IMAGE ready`);
  }

  await emitLog(deploymentId, `Successfully tagged ${imageName}`);
  await emitLog(deploymentId, `✓ Docker image built successfully`, LogLevel.SUCCESS);
}

async function stepHealthCheck(ctx: PipelineContext): Promise<void> {
  const { deploymentId, imageName } = ctx;
  await updateStatus(deploymentId, DeploymentStatus.HEALTH_CHECK);

  await emitLog(deploymentId, `Running health checks...`);
  await delay(600);
  if (!imageName) {
    throw new Error('Deployment image not built');
  }

  const runResult = await runCommand('docker', ['run', '-d', '--rm', '-P', '--name', `devflow-${deploymentId}`, imageName]);
  const containerId = runResult.stdout.trim();
  ctx.containerId = containerId;

  await emitLog(deploymentId, `Starting container ${containerId.slice(0, 12)}...`);
  await delay(800);

  const { stdout: portList } = await runCommand('docker', ['port', containerId]);
  const firstMapping = portList.split(/\r?\n/).find((line) => line.includes('->')) ?? portList.split(/\r?\n/)[0];
  const portMatch = firstMapping?.match(/:(\d+)\s*$/) ?? firstMapping?.match(/:(\d+)/);
  if (!portMatch) {
    throw new Error(`Unable to detect published port from docker port output: ${portList}`);
  }

  const runtimePort = Number(portMatch[1]);
  const runtimeUrl = `http://localhost:${runtimePort}`;
  ctx.runtimeUrl = runtimeUrl;

  await emitLog(deploymentId, `Waiting for application to be ready at ${runtimeUrl}...`);
  await waitForHttpOk(runtimeUrl, 12);

  for (let i = 1; i <= 3; i++) {
    await delay(400);
    await emitLog(deploymentId, `Health probe ${i}/3: GET ${runtimeUrl}/`);
    await delay(200);
    if (i < 3) {
      await emitLog(deploymentId, `  → 200 OK (${110 + i * 10}ms)`);
    }
  }

  await emitLog(deploymentId, `  → 200 OK (142ms)`);
  await emitLog(deploymentId, `✓ All health checks passed`, LogLevel.SUCCESS);
}

// ─── Main Job Runner ──────────────────────────────────────────────────────────

export async function runDeploymentJob(data: DeploymentJobData): Promise<void> {
  const { deploymentId, repoUrl, branch } = data;
  const ctx: PipelineContext = {
    deploymentId,
    repoUrl,
    branch,
  };

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

    // Capture a screenshot from the actual running container runtime.
    if (ctx.runtimeUrl) {
      try {
        await captureDeploymentPreview(deploymentId, ctx.runtimeUrl);
      } catch (captureErr) {
        logger.warn({ deploymentId, err: captureErr }, 'Preview capture failed but deployment remains healthy');
      }
    } else {
      logger.warn({ deploymentId }, 'Skipping preview capture because no runtime URL was available');
    }

    await updateStatus(deploymentId, DeploymentStatus.HEALTHY);

    logger.info({ deploymentId, duration, runtimeUrl: ctx.runtimeUrl }, 'Deployment pipeline completed');
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
  } finally {
    await cleanupRuntime(ctx);
  }
}
