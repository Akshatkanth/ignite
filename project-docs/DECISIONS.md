# DevFlow - Architectural Decisions & Tradeoffs

## 1. Simulated vs Real Deployments (Phase 1)
**Decision:** We implemented a "simulated" deployment pipeline using `setTimeout` delays and mock log generation instead of actual Docker-in-Docker container execution.
**Tradeoff:** 
- *Pros:* Drastically reduces local complexity, avoids Docker socket mounting security issues locally, and allows us to focus entirely on systems architecture, observability, and queue processing.
- *Cons:* Not executing arbitrary user code yet.

## 2. JWT vs Session Cookies
**Decision:** Selected JWTs (Access + Refresh tokens) stored in localStorage (frontend), with standard `Authorization: Bearer` headers.
**Tradeoff:**
- *Pros:* Easier to implement for a mobile app or CLI later. Stateless backend, less Redis overhead for sessions.
- *Cons:* XSS vulnerability risk compared to HTTP-only cookies.

## 3. BullMQ + Redis for Job Queue
**Decision:** Used BullMQ instead of RabbitMQ or Kafka.
**Tradeoff:**
- *Pros:* Lightweight, native TypeScript support, easily runs alongside standard Node.js infrastructure using Redis which we already needed for rate limiting.
- *Cons:* Not as scalable as Kafka for massive distributed event streaming, but perfectly suited for task execution.

## 4. Turborepo Monorepo
**Decision:** Using Turborepo instead of separate repos for frontend, backend, and shared packages.
**Tradeoff:**
- *Pros:* Single source of truth. Shared types (`@devflow/shared`) ensure strict end-to-end type safety between database schemas, API responses, and frontend state.
- *Cons:* Slightly steeper learning curve for CI/CD setup and TypeScript path mapping.
