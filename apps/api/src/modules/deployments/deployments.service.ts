import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { NotFoundError, ForbiddenError, AppError } from '../../middleware/errorHandler';
import { enqueueDeployment, getDeploymentQueue } from '../../queue/deploymentQueue';
import {
  deploymentsTotal,
  activeDeployments,
  deploymentDuration,
} from '../../metrics/registry';
import type { Deployment, DeploymentLog, PaginatedResponse } from '@devflow/shared';
import { DeploymentStatus, LogLevel, ProjectRole } from '@devflow/shared';

function mapDeployment(deployment: {
  id: string;
  projectId: string;
  status: string;
  commitSha: string | null;
  commitMessage: string | null;
  triggeredBy: string | null;
  previewScreenshotPath: string | null;
  previewScreenshotUrl: string | null;
  previewScreenshotCapturedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  duration: number | null;
  error: string | null;
  createdAt: Date;
}): Deployment {
  return {
    id: deployment.id,
    projectId: deployment.projectId,
    status: deployment.status as DeploymentStatus,
    commitSha: deployment.commitSha,
    commitMessage: deployment.commitMessage,
    triggeredBy: deployment.triggeredBy,
    previewScreenshotPath: deployment.previewScreenshotPath,
    previewScreenshotUrl: deployment.previewScreenshotUrl,
    previewScreenshotCapturedAt: deployment.previewScreenshotCapturedAt,
    startedAt: deployment.startedAt,
    completedAt: deployment.completedAt,
    duration: deployment.duration,
    error: deployment.error,
    createdAt: deployment.createdAt,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function assertDeploymentAccess(deploymentId: string, userId: string): Promise<Deployment> {
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    include: { project: { include: { members: true } } },
  });

  if (!deployment) throw new NotFoundError('Deployment');

  const isMember = deployment.project.members.some((m: { userId: string }) => m.userId === userId);
  if (!isMember) throw new NotFoundError('Deployment');

  return mapDeployment(deployment);
}

async function isDeploymentCancelled(deploymentId: string): Promise<boolean> {
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    select: { status: true },
  });

  return deployment?.status === DeploymentStatus.CANCELLED;
}

async function removeQueuedDeploymentJob(deploymentId: string): Promise<void> {
  const queue = getDeploymentQueue();
  const job = await queue.getJob(deploymentId);

  if (!job) {
    return;
  }

  const state = await job.getState();
  if (state === 'waiting' || state === 'delayed') {
    await job.remove();
    logger.info({ deploymentId, jobId: job.id, state }, 'Queued deployment job removed');
    activeDeployments.dec();
  }
}

// ─── Deployments Service ──────────────────────────────────────────────────────

export async function triggerDeployment(
  projectId: string,
  userId: string,
  commitMessage?: string
): Promise<Deployment> {
  // Verify user is a member of the project
  const membership = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
    include: { project: true },
  });

  if (!membership) throw new NotFoundError('Project');

  // Check for an already-running deployment on this project
  const running = await prisma.deployment.findFirst({
    where: {
      projectId,
      status: {
        in: [
          DeploymentStatus.QUEUED,
          DeploymentStatus.CLONING,
          DeploymentStatus.VALIDATING,
          DeploymentStatus.BUILDING,
          DeploymentStatus.HEALTH_CHECK,
        ],
      },
    },
  });

  if (running) {
    throw new AppError(409, 'A deployment is already in progress for this project', 'DEPLOY_IN_PROGRESS');
  }

  // Create DB record first (so we have an ID for the queue job)
  const deployment = await prisma.deployment.create({
    data: {
      projectId,
      status: DeploymentStatus.QUEUED,
      commitMessage: commitMessage ?? 'Manual deployment',
      triggeredBy: userId,
    },
  });

  // Enqueue the pipeline job
  await enqueueDeployment({
    deploymentId: deployment.id,
    projectId,
    repoUrl: membership.project.repoUrl,
    branch: membership.project.branch,
    triggeredBy: userId,
  });

  // Track metrics
  deploymentsTotal.inc({ status: 'queued', framework: 'unknown' });
  activeDeployments.inc();

  logger.info({ deploymentId: deployment.id, projectId, userId }, 'Deployment triggered');

  return mapDeployment(deployment);
}

export async function getDeployment(deploymentId: string, userId: string): Promise<Deployment> {
  return assertDeploymentAccess(deploymentId, userId);
}

export async function getDeploymentLogs(
  deploymentId: string,
  userId: string,
  page: number,
  limit: number
): Promise<PaginatedResponse<DeploymentLog>> {
  await assertDeploymentAccess(deploymentId, userId);

  const [logs, total] = await Promise.all([
    prisma.deploymentLog.findMany({
      where: { deploymentId },
      orderBy: { timestamp: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.deploymentLog.count({ where: { deploymentId } }),
  ]);

  return {
    data: logs.map((l: { id: string; deploymentId: string; message: string; level: string; timestamp: Date }) => ({
      id: l.id,
      deploymentId: l.deploymentId,
      message: l.message,
      level: l.level as LogLevel,
      timestamp: l.timestamp,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function cancelDeployment(deploymentId: string, userId: string): Promise<Deployment> {
  const deployment = await assertDeploymentAccess(deploymentId, userId);

  const cancellableStatuses = [
    DeploymentStatus.QUEUED,
    DeploymentStatus.CLONING,
    DeploymentStatus.VALIDATING,
    DeploymentStatus.BUILDING,
    DeploymentStatus.HEALTH_CHECK,
  ];

  if (!cancellableStatuses.includes(deployment.status)) {
    throw new AppError(
      409,
      `Deployment cannot be cancelled in status: ${deployment.status}`,
      'INVALID_STATUS_TRANSITION'
    );
  }

  // Verify ownership or at least membership (any member can cancel)
  try {
    await removeQueuedDeploymentJob(deploymentId);
  } catch (err) {
    logger.warn({ deploymentId, err }, 'Failed to remove queued deployment job during cancel');
  }

  const updated = await prisma.deployment.update({
    where: { id: deploymentId },
    data: {
      status: DeploymentStatus.CANCELLED,
      completedAt: new Date(),
    },
  });

  logger.info({ deploymentId, userId }, 'Deployment cancelled');

  return { ...deployment, status: updated.status as DeploymentStatus };
}
