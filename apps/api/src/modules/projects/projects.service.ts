import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../../middleware/errorHandler';
import type {
  Project,
  ProjectWithStats,
  Deployment,
  PaginatedResponse,
} from '@devflow/shared';
import { ProjectRole, DeploymentStatus } from '@devflow/shared';
import type { CreateProjectInput, UpdateProjectInput } from '@devflow/shared';

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

async function assertProjectAccess(projectId: string, userId: string): Promise<void> {
  const member = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  if (!member) {
    throw new NotFoundError('Project');
  }
}

async function assertProjectOwner(projectId: string, userId: string): Promise<void> {
  const member = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  if (!member) {
    throw new NotFoundError('Project');
  }
  if (member.role !== ProjectRole.OWNER) {
    throw new ForbiddenError('Only the project owner can perform this action');
  }
}

function mapProject(p: {
  id: string;
  name: string;
  repoUrl: string;
  branch: string;
  description: string | null;
  framework: string | null;
  createdAt: Date;
  updatedAt: Date;
  members: { userId: string }[];
}): Project {
  return {
    id: p.id,
    name: p.name,
    repoUrl: p.repoUrl,
    branch: p.branch,
    description: p.description,
    framework: p.framework,
    ownerId: p.members[0]?.userId ?? '',
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// ─── Project Service ──────────────────────────────────────────────────────────

export async function createProject(
  input: CreateProjectInput,
  userId: string
): Promise<Project> {
  // Check for duplicate project name for this user
  const existingMembership = await prisma.projectMember.findFirst({
    where: {
      userId,
      project: { name: input.name },
    },
  });
  if (existingMembership) {
    throw new ConflictError(`You already have a project named "${input.name}"`);
  }

  const project = await prisma.project.create({
    data: {
      name: input.name,
      repoUrl: input.repoUrl,
      branch: input.branch,
      description: input.description ?? null,
      members: {
        create: {
          userId,
          role: ProjectRole.OWNER,
        },
      },
    },
    include: {
      members: { where: { role: ProjectRole.OWNER }, select: { userId: true } },
    },
  });

  logger.info({ projectId: project.id, userId }, 'Project created');
  return mapProject(project);
}

export async function listProjects(userId: string): Promise<ProjectWithStats[]> {
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    include: {
      project: {
        include: {
          members: { where: { role: ProjectRole.OWNER }, select: { userId: true } },
          deployments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          _count: { select: { deployments: true } },
        },
      },
    },
    orderBy: { project: { updatedAt: 'desc' } },
  });

  return memberships.map(({ project }: { project: (typeof memberships)[number]['project'] }) => {
    const lastDep = project.deployments[0] ?? null;
    return {
      ...mapProject(project),
      deploymentCount: project._count.deployments,
      lastDeployment: lastDep ? mapDeployment(lastDep) : null,
    };
  });
}

export async function getProject(projectId: string, userId: string): Promise<ProjectWithStats> {
  await assertProjectAccess(projectId, userId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      members: { where: { role: ProjectRole.OWNER }, select: { userId: true } },
      deployments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      _count: { select: { deployments: true } },
    },
  });

  if (!project) throw new NotFoundError('Project');

  const lastDep = project.deployments[0] ?? null;
  return {
    ...mapProject(project),
    deploymentCount: project._count.deployments,
    lastDeployment: lastDep ? mapDeployment(lastDep) : null,
  };
}

export async function updateProject(
  projectId: string,
  input: UpdateProjectInput,
  userId: string
): Promise<Project> {
  await assertProjectOwner(projectId, userId);

  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.repoUrl !== undefined && { repoUrl: input.repoUrl }),
      ...(input.branch !== undefined && { branch: input.branch }),
      ...(input.description !== undefined && { description: input.description }),
    },
    include: {
      members: { where: { role: ProjectRole.OWNER }, select: { userId: true } },
    },
  });

  logger.info({ projectId, userId }, 'Project updated');
  return mapProject(project);
}

export async function deleteProject(projectId: string, userId: string): Promise<void> {
  await assertProjectOwner(projectId, userId);

  await prisma.project.delete({ where: { id: projectId } });
  logger.info({ projectId, userId }, 'Project deleted');
}

export async function getProjectDeployments(
  projectId: string,
  userId: string,
  page: number,
  limit: number
): Promise<PaginatedResponse<Deployment>> {
  await assertProjectAccess(projectId, userId);

  const [deployments, total] = await Promise.all([
    prisma.deployment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.deployment.count({ where: { projectId } }),
  ]);

  return {
    data: deployments.map((d: (typeof deployments)[number]) => mapDeployment(d)),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
