
# Ignite (formerly DevFlow)

A full-stack, container-first deployment platform for demoing modern backend engineering patterns: CI-style pipelines, queued workers, real-time logs, Playwright-based preview captures, and a Next.js web console.

This repository is organized as a monorepo with a clear separation between the API, web UI, and shared packages. It is intended as both a learning/reference project and a lightweight platform that can be deployed to cloud container platforms.

## Highlights / Use

- Trigger deployments from connected GitHub repositories.
- Pipeline: clone → validate → build → health-check → capture preview screenshot.
- Real-time logs streamed via WebSockets for observability while a deployment runs.
- Background workers process builds and long-running tasks (BullMQ + Redis).
- Preview screenshots are captured with Playwright during health checks and exposed by the API for the UI to open.

## Architecture & Workflow

1. User creates a Project in the web UI pointing to a GitHub repo + branch.
2. When a deployment is triggered (manual or automated), the API enqueues a deployment job.
3. Worker(s) pick up jobs and run the pipeline: clone repo, validate, build (Docker), start runtime container (for health checks), run health checks, capture a Playwright screenshot of the runtime URL, save results to storage and update the DB.
4. The API persists deployment state in Postgres and emits realtime events over Socket.io (optionally using a Redis adapter) so web clients see logs/status updates live.
5. The web UI (Next.js) shows projects, deployment history, and exposes an "Open preview" action that opens the captured screenshot or the runtime preview URL.

## Tech stack

- Backend API: Node.js + TypeScript + Express
- Web UI: Next.js (App Router) + React + TypeScript
- Database: PostgreSQL (Prisma ORM)
- Queue / Workers: BullMQ + Redis
- Screenshot / E2E: Playwright (headless Chromium in a container)
- WebSockets: Socket.io (can use Redis adapter for multi-instance)
- Containerization: Docker + docker-compose at `infra/docker-compose.yml`
- Monorepo tooling: workspace-managed packages under `apps/` and `packages/shared`

## Important files & folders

- `apps/api/` — API server, Prisma schema, deployment jobs and Playwright capture logic
- `apps/web/` — Next.js frontend (App Router) used by users
- `apps/web/src/app/deployments/[id]/page.tsx` — deployment details + preview logic
- `apps/api/src/jobs/deploymentJob.ts` — deployment pipeline orchestration
- `infra/docker-compose.yml` — local multi-container stack for quick testing
- `packages/shared/` — shared TypeScript types and helpers used across services

## Environment (local / production)

The app relies on several environment variables. Key ones include:

- `DATABASE_URL` — Postgres connection string (Prisma)
- `REDIS_URL` — Redis connection for BullMQ and optional Socket.io adapter
- `JWT_SECRET` — Auth signing secret
- `NEXT_PUBLIC_API_URL` — API base URL used by the frontend
- `DEPLOYMENT_PREVIEW_URL` — Optional base URL to serve stored previews
- `DEPLOYMENT_RUNTIME_URL` / `DEPLOYMENT_RUNTIME_PORT` — runtime discovery fallback settings

Check `apps/api/config/env.ts` and `apps/web` for other env values used by each service.

## Local development (quick start)

1. Start local Postgres and Redis (you can use Docker compose in `infra/docker-compose.yml`).
2. From the repo root, install dependencies and run the services:

```bash
# From repo root (example using npm)
npm install

# Run API (in a new terminal)
cd apps/api
npm run dev

# Run web (in a new terminal)
cd ../../apps/web
npm run dev

# Or use docker-compose for a full stack locally
docker compose -f infra/docker-compose.yml up --build
```

Notes: this is a monorepo — your package manager may be `pnpm`, `yarn`, or `npm` depending on your local preferences and lockfile. Use the appropriate commands for your setup.

## Tests

- Unit and integration tests live under `apps/api/src/__tests__` and use the workspace test runner configured in the repo. Run tests from the specific package directory, for example:

```bash
cd apps/api
npm test
```

## Deployment guidance (cloud)

This repo is container-ready. Recommended production architecture:

- Build container images for `apps/api`, `apps/web`, and the worker/playwright services and push to a registry (GitHub Container Registry, ACR, ECR, Docker Hub).
- Use managed Postgres and Redis services in your cloud provider (low ops, high reliability).
- Store previews in durable object storage (S3/Blob) instead of writing to ephemeral container filesystem. Update the Playwright preview logic accordingly.
- Run frontend & API on container platforms that support WebSockets (Cloud Run, Azure Container Apps, App Service for Containers, Kubernetes).
- Use a Socket.io Redis adapter (optional) when scaling the API horizontally so events propagate to all instances.

If you want, we can add a GitHub Actions pipeline that builds images and deploys to Cloud Run / Azure Container Apps, plus a code change to persist previews to S3.

## Production considerations & gotchas

- Playwright requires browser binaries and some OS libs — use the official Playwright Docker images for reliability.
- Don't rely on writing preview PNGs to the repo root or container filesystem in production — use object storage or a persistent volume.
- Ensure the platform you choose supports long-running WebSocket connections or adopt a managed signal service.
- Secure secrets with your cloud provider's secret store and never commit them to the repo.

## Contributing

1. Fork and create a branch.
2. Follow the existing code and run tests locally.
3. Open a PR describing changes and include test coverage when applicable.



