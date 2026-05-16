# DevFlow - API Specification

All API endpoints are prefixed with `/api` and routed via Nginx proxy.

## Authentication
| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Register a new user |
| POST | `/auth/login` | Login and receive JWT tokens |
| POST | `/auth/refresh` | Obtain a new access token using a refresh token |
| POST | `/auth/logout` | Invalidate current session |
| GET | `/auth/me` | Get current user profile |

## Projects
| Method | Endpoint | Description |
|---|---|---|
| POST | `/projects` | Create a new project |
| GET | `/projects` | List user's projects |
| GET | `/projects/:id` | Get specific project details |
| PATCH | `/projects/:id` | Update project metadata |
| DELETE | `/projects/:id` | Delete a project |
| GET | `/projects/:id/deployments` | List paginated deployments for a project |
| POST | `/projects/:id/deployments` | Trigger a new deployment |

## Deployments
| Method | Endpoint | Description |
|---|---|---|
| GET | `/deployments/:id` | Get specific deployment status |
| GET | `/deployments/:id/logs` | Fetch historical logs for a deployment |
| POST | `/deployments/:id/cancel` | Cancel a running deployment |

## WebSocket Events
**Namespace:** `/` (default)
**Rooms:** Clients must emit `deployment:subscribe` with a `deploymentId` to join a room.

- `deployment:subscribe` (Client -> Server): Join a deployment log stream.
- `deployment:unsubscribe` (Client -> Server): Leave a deployment log stream.
- `deployment:log` (Server -> Client): Receives `{ log: { message, level, timestamp } }`.
- `deployment:status` (Server -> Client): Receives `{ status }`.
