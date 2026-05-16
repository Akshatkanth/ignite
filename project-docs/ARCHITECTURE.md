# DevFlow - Architecture

## System Diagram & Services
The application is structured as a Turborepo monorepo with the following core services running locally via Docker Compose:

1. **Web App (`apps/web`)**: Next.js frontend running on port 3000. Communicates with the API proxy.
2. **API App (`apps/api`)**: Node.js/Express backend running on port 4000. Exposes REST endpoints and Socket.io server.
3. **PostgreSQL**: Primary relational database storing Users, Projects, Deployments, and Logs.
4. **Redis**: In-memory data store used for BullMQ (deployment queues).
5. **Nginx Reverse Proxy**: Entry point on port 80. Routes `/api/` traffic and upgrades `/socket.io/` WebSocket connections to the API container.
6. **Prometheus**: Time-series database scraping API metrics every 15s.
7. **Grafana**: Dashboard interface pre-provisioned to display system metrics from Prometheus.

## Data & Event Flows

### Deployment Flow
1. User triggers a deployment via `POST /api/projects/:id/deployments`.
2. API validates request and enqueues a job in BullMQ (`deploymentQueue`).
3. BullMQ Worker picks up the job.
4. Worker executes the simulated pipeline: `Clone -> Validate -> Build -> Health Check`.
5. Worker updates Postgres `Deployment` status and emits log events to `deploymentLog` table.
6. Worker emits WebSocket events to `deployment:<id>` room via Socket.io.
7. Connected frontend clients receive real-time status updates and log lines.

### Observability Flow
1. API records metrics using `prom-client` (HTTP requests, deployment durations, WebSocket connections, Node.js heap).
2. API exposes `/metrics`.
3. Prometheus automatically scrapes `/metrics`.
4. Grafana auto-provisions Prometheus as a data source and loads the "DevFlow Overview" dashboard.
