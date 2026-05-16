# DevFlow - Project Overview

## Summary
DevFlow is a developer-focused SaaS platform that simulates a modern deployment pipeline (similar to Render or Railway). It allows users to connect GitHub repositories, trigger deployments, monitor real-time build logs, track deployment history, and view application health/metrics through a dashboard.

The project is designed to showcase backend engineering, DevOps practices, cloud infrastructure concepts, observability, and distributed systems patterns.

## Core Features
- **Project Management:** Connect repositories, set branches.
- **Simulated Deployment Pipeline:** Clones, validates structure, simulates Docker builds, and performs health checks.
- **Real-Time Logs:** Streaming build logs to the frontend via WebSockets.
- **Observability:** Built-in Prometheus metrics, Grafana dashboards, and structured Pino logging.
- **Security:** JWT authentication, RBAC, tiered rate-limiting, and Zod validation.

## Tech Stack
- **Monorepo:** Turborepo
- **Frontend:** Next.js 15 (App Router), React, Tailwind CSS v4, shadcn/ui, Axios
- **Backend:** Node.js, Express, TypeScript, Zod
- **Database:** PostgreSQL, Prisma ORM
- **Queue/Worker:** Redis, BullMQ
- **Real-Time:** Socket.io
- **Infrastructure:** Docker Compose, Nginx, Prometheus, Grafana
