import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/config/database';
import { getDeploymentQueue } from '../../src/queue/deploymentQueue';

jest.mock('../../src/config/redis', () => ({
  redis: { connect: jest.fn(), ping: jest.fn(), quit: jest.fn(), on: jest.fn() },
  getRedisClient: jest.fn(),
  closeRedis: jest.fn(),
}));
jest.mock('../../src/queue/deploymentQueue', () => ({
  getDeploymentQueue: jest.fn(),
  enqueueDeployment: jest.fn().mockResolvedValue('mock-job-id'),
  DEPLOYMENT_QUEUE_NAME: 'deployments',
}));
jest.mock('../../src/queue/deploymentWorker', () => ({
  startDeploymentWorker: jest.fn(),
  stopDeploymentWorker: jest.fn(),
}));
jest.mock('../../src/websocket/io', () => ({
  initIoServer: jest.fn(),
  getIoServer: jest.fn().mockReturnValue(null),
}));

const app = createApp();
const mockGetDeploymentQueue = jest.mocked(getDeploymentQueue);

const suffix = Date.now();
const testUser = { email: `proj-user-${suffix}@devflow.test`, password: 'TestPassword123', name: 'Proj User' };
let accessToken: string;
let projectId: string;
let deploymentId: string;

beforeAll(async () => {
  const res = await request(app).post('/api/auth/register').send(testUser);
  accessToken = res.body.data.tokens.accessToken;
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { name: { startsWith: 'Test Project' } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@devflow.test' } } });
  await prisma.$disconnect();
});

// ─── Projects Tests ───────────────────────────────────────────────────────────

describe('POST /api/projects', () => {
  it('should create a project', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: `Test Project ${suffix}`,
        repoUrl: 'https://github.com/test/my-app',
        branch: 'main',
        description: 'A test project',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.project.name).toBe(`Test Project ${suffix}`);
    expect(res.body.data.project.repoUrl).toBe('https://github.com/test/my-app');
    projectId = res.body.data.project.id;
  });

  it('should reject invalid GitHub URL', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Bad Project',
        repoUrl: 'https://gitlab.com/test/my-app',
      });
    expect(res.status).toBe(422);
  });

  it('should require authentication', async () => {
    const res = await request(app).post('/api/projects').send({
      name: 'Unauth Project',
      repoUrl: 'https://github.com/test/repo',
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/projects', () => {
  it('should list user projects', async () => {
    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.projects)).toBe(true);
    expect(res.body.data.projects.length).toBeGreaterThan(0);
  });
});

describe('GET /api/projects/:id', () => {
  it('should return a specific project', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.project.id).toBe(projectId);
  });

  it('should return 404 for non-existent project', async () => {
    const res = await request(app)
      .get('/api/projects/nonexistent-id-here')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/projects/:id', () => {
  it('should update project name', async () => {
    const res = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ description: 'Updated description' });

    expect(res.status).toBe(200);
    expect(res.body.data.project.description).toBe('Updated description');
  });
});

describe('POST /api/projects/:projectId/deployments', () => {
  it('should trigger a deployment', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/deployments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ commitMessage: 'Test deploy' });

    expect(res.status).toBe(202);
    expect(res.body.data.deployment.status).toBe('QUEUED');
    expect(res.body.data.deployment.projectId).toBe(projectId);
    deploymentId = res.body.data.deployment.id;
  });
});

describe('POST /api/deployments/:id/cancel', () => {
  it('should cancel a queued deployment and remove it from the queue', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const getState = jest.fn().mockResolvedValue('waiting');

    mockGetDeploymentQueue.mockReturnValue({
      getJob: jest.fn().mockResolvedValue({
        id: deploymentId,
        getState,
        remove,
      }),
    } as never);

    const res = await request(app)
      .post(`/api/deployments/${deploymentId}/cancel`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.deployment.status).toBe('CANCELLED');
    expect(remove).toHaveBeenCalledTimes(1);

    const getRes = await request(app)
      .get(`/api/deployments/${deploymentId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.deployment.status).toBe('CANCELLED');
  });
});
