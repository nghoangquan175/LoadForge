# LoadForge

Auto-scaling playground. Learn traffic, load and resilience on AWS EC2.

- `apps/dashboard`: Next.js dashboard, real-time via SSE (port 3100)
- `apps/server`: NestJS API with AWS CloudWatch + Auto Scaling data and heavy load routes for k6 (port 4000)
- `infra/`: Terraform for AWS (VPC, ALB, Auto Scaling Group)

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

## Dashboard login

Set `DASHBOARD_USER`, `DASHBOARD_PASSWORD` and `AUTH_SECRET` for the dashboard.
With no password, login is off in dev and every page is blocked in production.
The API (`/api/*`) is not behind the login, so k6 can reach it.

## Deploy to AWS

```
Internet ─► ALB :80 (redirect) / :443 (*.quannh.xyz cert)
             ├─ /api/*  ─► API target group :4000 ─► Auto Scaling Group (1-6 x t3.micro)
             └─ /*      ─► dashboard target group :3100 ─► 1 x t3.micro
```

Instances pull private images from GHCR and read their env from SSM Parameter Store
(`/loadforge/server/*`, `/loadforge/dashboard/*`). The image to run is in
`/loadforge/deploy/<app>-image`.

### CI/CD (`.github/workflows/deploy.yml`)

On every push to `main` that touches `apps/`:

1. **test**: lint, server unit + e2e tests, dashboard type check
2. **build**: both images to GHCR, tagged with the git sha and `latest`
3. **deploy** (needs repo variable `AWS_DEPLOY_ROLE_ARN`):
   - sets `/loadforge/deploy/<app>-image` to the new sha
   - API: starts an ASG **instance refresh**; new instances boot with the new image
   - dashboard: **SSM Run Command** runs `/usr/local/bin/loadforge-deploy` on the instance

Rollback: set the parameter to an older sha, then start an instance refresh.

### One-time setup

1. `infra/certificate`: `terraform apply`, add the validation CNAME at your DNS.
2. SSM parameter `/loadforge/ghcr-token` (SecureString): GitHub classic token with `read:packages`.
3. `infra/ci`: `terraform apply`, then
   `gh variable set AWS_DEPLOY_ROLE_ARN --body "$(terraform output -raw deploy_role_arn)"`
4. `infra`: `terraform apply`, then add a CNAME `loadforge` -> `alb_dns_name` (DNS only).
   Dashboard password: `terraform output -raw dashboard_password`

`terraform destroy` in `infra/` removes the app; the certificate and CI access stay.
`scripts/push-images.sh` builds and pushes images by hand if you ever need to skip CI.
