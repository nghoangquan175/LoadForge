# LoadForge

Auto-scaling playground. Learn traffic, load and resilience on AWS EC2.

- `apps/dashboard`: Next.js dashboard, real-time via SSE (port 3100)
- `apps/server`: NestJS API with AWS CloudWatch + Auto Scaling data and heavy load routes for k6 (port 4000)
- `infra/`: Terraform (coming later)

## Requirements

- Node.js 22+
- npm 11+ (npm 10 hits an install bug with this workspace: `npm i -g npm@11`)

## Run locally

```bash
npm install
npm run dev          # server + dashboard
npm run dev:server   # server only
npm run dev:dashboard
```

- Dashboard: http://localhost:3100
- API: http://localhost:4000/api

With no AWS setup, the server sends **mock** data from a simulated Auto Scaling group.
If the server is down, the dashboard runs its own local simulation.

## API

| Route | What it does |
|---|---|
| `GET /api/stream` | SSE stream, one `snapshot` event per refresh |
| `GET /api/snapshot` | Full dashboard snapshot |
| `GET /api/instances` | ASG capacity + EC2 instances |
| `GET /api/metrics` | CPU, requests, latency, 5xx series |
| `GET /api/activities` | Scaling activity history |
| `GET /api/health` | Health check for the load balancer |
| `GET /api/load/cpu?limit=300000` | Counts primes (CPU bound) |
| `GET /api/load/memory?size=500000` | Allocates, sorts and hashes an array (memory bound) |
| `GET /api/load/io?delay=300` | Waits on a fake downstream call (latency bound) |

Every response has an `X-Served-By` header, so you can see which instance answered.

## Server config

Copy `apps/server/.env.example` to `apps/server/.env`.

| Variable | Default | Meaning |
|---|---|---|
| `DATA_SOURCE` | `auto` | `auto` uses AWS when `ASG_NAME` is set and reachable, otherwise mock. `aws` or `mock` to force. |
| `AWS_REGION` | `ap-southeast-1` | |
| `ASG_NAME` | | Auto Scaling group to watch |
| `ALB_ARN_SUFFIX` | | e.g. `app/loadforge-alb/abc123`, enables request / latency / 5xx charts |
| `TARGET_CPU` | `60` | Used if the ASG has no target tracking policy |
| `AWS_POLL_MS` | `15000` | How often to call AWS |
| `CORS_ORIGINS` | `http://localhost:3100` | Comma separated |

AWS credentials come from the normal AWS SDK chain (`aws configure`, env vars, or the EC2 instance role).
Enable detailed monitoring on the instances to get 1-minute CPU data.
