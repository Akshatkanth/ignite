# Ignite (formerly DevFlow)

This repository contains Ignite, a container-first deployment platform demonstrating a production-capable delivery pipeline, background workers, automated preview capture, and comprehensive observability. The project is delivered as a monorepo and is intended for local development, CI-driven workflows, and containerized cloud deployments.

---

## Overview

Ignite implements an opinionated pipeline for deploying applications from Git repositories. It focuses on reproducibility, observability, and operational practices: deterministic build steps, health checks, automated runtime preview capture, real-time logs, metrics collection, and worker-based orchestration.

## Features

- Project-driven deployments with history and status
- Deterministic pipeline: clone → validate → build → health-check → capture preview
- Playwright-based preview screenshot capture during health checks
- Asynchronous job execution using BullMQ and Redis
- Real-time logs and events via Socket.io
- Prometheus metrics exposure and Grafana provisioning

## Architecture and workflow

- The frontend (`apps/web`) provides project and deployment management.
- The API (`apps/api`) exposes REST endpoints, metrics at `/metrics`, and socket events for live logs.
- Workers consume jobs from Redis (BullMQ) and perform pipeline stages, updating the database via Prisma.
- Playwright-based capture service runs during the health-check stage and stores preview artifacts for the UI to reference.

## Technology stack

- Node.js + TypeScript
- Express (API)
- Next.js (App Router) (frontend)
- Prisma (ORM) + PostgreSQL
- Redis + BullMQ (background jobs)
- Playwright (browser-based screenshot captures)
- Socket.io (real-time logs/events)
- Prometheus (metrics) + Grafana (dashboards)
- Pino (structured logging)
- Docker & Docker Compose (local infra)
- Jest (unit and integration tests)

## Repository layout

- `apps/api/` — Express API, Prisma schema/migrations, job definitions, metrics, and socket logic
- `apps/web/` — Next.js (App Router) frontend and UI components
- `packages/shared/` — shared types and utilities
- `infra/` — Docker Compose, Prometheus, Grafana provisioning, and related infra manifests

## Environment variables (selected)

Define environment variables in your local environment or via your deployment platform's secret manager. Primary variables include:

- `DATABASE_URL` — PostgreSQL connection string used by Prisma
- `REDIS_URL` — Redis connection string used by BullMQ and (optionally) Socket.io adapter
- `JWT_SECRET` — JWT signing secret used for authentication
- `NEXT_PUBLIC_API_URL` — Base URL for API used by the frontend
- `DEPLOYMENT_PREVIEW_URL` — Base URL used to resolve preview assets when hosted externally
- `DEPLOYMENT_RUNTIME_URL` / `DEPLOYMENT_RUNTIME_PORT` — Optional runtime discovery fallbacks

Refer to `apps/api/config/env.ts` and `apps/web` for the full set of environment variables.

## Quick start — Local development

Prerequisites: Docker, Docker Compose, Node.js (LTS), and a package manager (npm/pnpm/yarn).

From the repository root:

```bash
# Install dependencies
npm install

# Start the local stack (Postgres, Redis, Prometheus, Grafana, API, web)
docker compose -f infra/docker-compose.yml up --build

# Alternatively run services individually for development
cd apps/api && npm run dev
cd apps/web && npm run dev
```

Apply database migrations and generate the Prisma client when required:

```bash
cd apps/api
npm run db:migrate
npm run db:generate
```

## Tests

Run tests per package. Example for the API package:

```bash
cd apps/api
npm test
```

## Deployment (summary)

- Build and push container images for `apps/api`, `apps/web`, and the worker/playwright services to a container registry.
- Use managed services for production: managed PostgreSQL, managed Redis, and durable object storage for preview artifacts.
- Deploy on a container platform that supports WebSockets and long-running connections. When scaling horizontally, enable a Socket.io Redis adapter or equivalent pub/sub mechanism to propagate events.

## Observability

- Prometheus is configured under `infra/prometheus` and the compose stack to scrape API metrics exposed at `/metrics`.
- Grafana provisioning files are located under `infra/grafana/provisioning`.

## Production considerations

- Use Playwright's official Docker images for the capture service to ensure browser binaries and dependencies are present.
- Do not rely on container-local filesystem for persistent preview storage in production; use object storage (S3/Blob) and serve assets via CDN or API endpoints.
- Store and manage secrets using a secure secret manager; avoid storing secrets in code or config files.



