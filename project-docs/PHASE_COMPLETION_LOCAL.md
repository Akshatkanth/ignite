# DevFlow - Fast Local Phase Completion Plan

Goal: complete all planned phases quickly and locally before formal testing.

## Reality Check (Current Codebase)
Most Phase 2-5 features already exist in code. The fastest strategy is to close final gaps and harden behavior, not rebuild completed modules.

## Completion Strategy (No Formal Testing Yet)

### Step 1 - Stabilize Base (1 short pass)
- [ ] Fix TypeScript deprecation warning in `apps/api/tsconfig.json` (baseUrl / ignoreDeprecations).
- [ ] Ensure API env file exists: `apps/api/.env` from `.env.example`.
- [ ] Confirm local infra starts cleanly (`postgres`, `redis`).

### Step 2 - Phase 2 Closure: Deployment Pipeline
- [ ] Verify queue + worker lifecycle is robust for local restarts.
- [ ] Ensure deployment cancel behavior is reflected consistently in UI and API.
- [ ] Add missing edge-case handling for duplicate/parallel deployment triggers.

### Step 3 - Phase 3 Closure: Monitoring & Observability
- [ ] Validate `/metrics` exposure and Prometheus scrape alignment.
- [ ] Ensure Grafana provisioning loads dashboard without manual fixes.
- [ ] Ensure structured logging fields are consistent across API + worker logs.

### Step 4 - Phase 4 Closure: Security & CI Polish
- [ ] Expand deployment endpoint integration tests (trigger/get/logs/cancel).
- [ ] Verify validation + rate limiter responses are consistent error shape.
- [ ] Keep CI green for lint/build/test and docker build path.

### Step 5 - Phase 5 Closure: Frontend UX Consistency
- [ ] Tighten error states for dashboard/project/deployment pages.
- [ ] Ensure loading and empty states are consistent and non-blocking.
- [ ] Confirm auth flow guards and redirects are reliable.

## Execution Order (Fastest)
1. Stabilize base (Step 1).
2. Finish API hardening (Steps 2 and 4 together).
3. Finish observability checks (Step 3).
4. Finish frontend polish (Step 5).
5. Then run full testing pass.

## Definition of Done Per Phase
- All phase checklist items above are complete.
- No blocking runtime errors in local startup path.
- CI-relevant tasks run successfully locally.

## Local Commands You Will Use During Build (not final testing)
- `npm ci`
- `docker compose -f infra/docker-compose.yml up -d postgres redis`
- `npm run db:generate --workspace=apps/api`
- `npm run db:migrate --workspace=apps/api`
- `npm run dev`

## Notes
- This plan avoids cloud dependencies and focuses only on local completion.
- Formal test execution is intentionally deferred until all closure items are done.
