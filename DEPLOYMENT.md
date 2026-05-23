# Ignite Deployment Guide

This guide prepares Ignite for a free-tier cloud deployment while keeping the existing local Docker Compose workflow intact.

## Target architecture

- Frontend: Netlify
- API: Render Web Service
- Worker: Separate Render Background Worker or Web Service
- Database: Neon PostgreSQL
- Queue: Upstash Redis

## 1. Local development stays unchanged

Do not remove or modify `infra/docker-compose.yml`. It remains the local stack for development and testing.

Typical local setup:

```bash
npm install
npm run dev
```

Or use Docker Compose directly:

```bash
docker compose -f infra/docker-compose.yml up --build
```

## 2. Render setup for the API

Create a Render Web Service for `apps/api`.

Recommended build and start commands:

```bash
cd apps/api
npm install
npm run build
npm start
```

Environment variables for the API:

- `NODE_ENV=production`
- `DATABASE_URL` from Neon
- `REDIS_URL` from Upstash Redis
- `JWT_SECRET` or both `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`
- `CORS_ORIGIN` set to your Netlify site URL and local dev origin if needed, for example `https://your-site.netlify.app,http://localhost:3000`
- `ENABLE_DEPLOYMENT_WORKER=false` on the API service
- `DEPLOYMENT_PREVIEW_URL` optional, only if you host previews elsewhere

Notes:

- The API keeps its REST endpoints and Socket.io server on a single Render web process.
- CORS is configured from `CORS_ORIGIN` and uses header-based auth, which works cross-origin with Netlify.
- Prisma connects to Neon through `DATABASE_URL` without changing the schema or local Compose setup.

## 3. Render setup for the worker

Create a separate Render Background Worker or Web Service for `apps/api`.

Recommended build and start commands:

```bash
cd apps/api
npm install
npm run build
npm run worker
```

Worker environment variables:

- `NODE_ENV=production`
- `DATABASE_URL` from Neon
- `REDIS_URL` from Upstash Redis
- `JWT_SECRET` or the split JWT secrets
- `ENABLE_DEPLOYMENT_WORKER=true` is fine, but not required for `npm run worker`

Notes:

- The worker runs independently from the API.
- BullMQ uses the same Redis connection settings for local and cloud environments.
- The worker can be scaled separately from the API if needed.

## 4. Neon PostgreSQL setup

1. Create a Neon project.
2. Copy the pooled or direct connection string into `DATABASE_URL`.
3. Run Prisma migrations from your deployment workflow or local machine:

```bash
cd apps/api
npm run db:migrate
```

Production note:

- Use the connection string that Neon recommends for your deployment environment.
- Keep the existing Prisma schema unchanged unless you are intentionally evolving the database.

## 5. Upstash Redis setup

1. Create an Upstash Redis database.
2. Copy the Redis URL into `REDIS_URL`.
3. Point both the API and worker to the same Redis instance.

Production note:

- Upstash works well for BullMQ in low-traffic portfolio/demo deployments.
- Keep retry settings and backoff behavior in the existing BullMQ config.

## 6. Netlify setup for the frontend

Create a Netlify site for `apps/web`.

Recommended build settings:

- Build command: `npm run build`
- Publish directory: `.next`

Environment variables:

- `NEXT_PUBLIC_API_URL=https://your-render-api.onrender.com`
- `NODE_ENV=production`

Notes:

- The frontend already reads `NEXT_PUBLIC_API_URL` in `apps/web/src/lib/api.ts`.
- Auth/session state is stored in browser storage and is sent to the API as bearer tokens, so cross-origin API calls work with CORS enabled on Render.
- Socket and API calls should point to the Render API domain, not localhost.

## 7. Screenshot system

- Local screenshot capture remains intact.
- Screenshot capture is best-effort in production.
- If Playwright browser binaries are unavailable or the runtime URL cannot be reached, the deployment should still complete successfully.
- The current code logs preview failures and continues.

Production recommendation:

- If you want persistent public previews later, move preview storage to object storage such as S3 or Blob Storage.
- That is not required for the free-tier deployment described here.

## 8. Required environment variables

Minimum production set:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `NEXT_PUBLIC_API_URL`
- `NODE_ENV`

Recommended additional variables:

- `CORS_ORIGIN`
- `ENABLE_DEPLOYMENT_WORKER`
- `DEPLOYMENT_PREVIEW_URL`

## 9. Deployment steps summary

1. Provision Neon and Upstash.
2. Deploy the API to Render as a web service.
3. Deploy the worker to Render as a separate background worker or web service.
4. Deploy the frontend to Netlify with `NEXT_PUBLIC_API_URL` pointing at the Render API.
5. Set `CORS_ORIGIN` on the API to include your Netlify domain.
6. Verify login, create project, trigger deployment, and confirm logs are streaming.

## 10. Production notes

- Keep Docker Compose untouched for local development.
- Do not introduce Kubernetes or a new orchestration layer.
- Keep the worker separate in production, but leave the current local all-in-one path intact.
- Use free-tier managed services until the project outgrows them.
