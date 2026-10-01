# LoadForge

Auto-scaling playground. Learn traffic, load and resilience on AWS EC2.

- `apps/dashboard`: Next.js dashboard (port 3100)
- `apps/watcher`: NestJS, reads the Auto Scaling group + CloudWatch and streams it to the dashboard over SSE (port 4100)
- `apps/defender`: NestJS, the servers under test: load routes for k6, publishes its own request metrics (port 4000)
- `infra/`: Terraform for AWS (VPC, ALB, Auto Scaling Group)

## Requirements

- Node.js 22+
- npm 11+ (npm 10 hits an install bug with this workspace: `npm i -g npm@11`)

## Run locally

```bash
npm install
npm run dev            # defender + watcher + dashboard
npm run dev:defender
npm run dev:watcher
npm run dev:dashboard
```

- Dashboard: http://localhost:3100
- Watcher: http://localhost:4100/monitor
- Defender: http://localhost:4000/api

With no AWS setup, the Watcher sends **mock** data from a simulated Auto Scaling group.
If the Watcher is down, the dashboard runs its own local simulation.

## Watcher routes

| Route | What it does |
|---|---|
| `GET /monitor/stream` | SSE stream, one `snapshot` event per refresh |
| `GET /monitor/snapshot` | Full dashboard snapshot |
| `GET /monitor/instances` | ASG capacity + EC2 instances |
| `GET /monitor/metrics` | CPU, requests, latency, 5xx series |
| `GET /monitor/activities` | Scaling activity history |
| `GET /monitor/health` | Health check for the load balancer |

## Defender routes

| Route | What it does |
|---|---|
| `GET /api/load/cpu?limit=300000` | Counts primes (CPU bound) |
| `GET /api/health` | Health check |

Every Defender response has an `X-Served-By` header, so you can see which instance answered.

## Watcher config

Copy `apps/watcher/.env.example` to `apps/watcher/.env`.

| Variable | Default | Meaning |
|---|---|---|
| `DATA_SOURCE` | `auto` | `auto` uses AWS when `ASG_NAME` is set and reachable, otherwise mock. `aws` or `mock` to force. |
| `AWS_REGION` | `ap-southeast-1` | |
| `ASG_NAME` | | Auto Scaling group to watch |
| `ALB_ARN_SUFFIX` | | e.g. `app/loadforge-alb/abc123`, enables request / latency / 5xx charts |
| `TARGET_CPU` | `60` | Used if the ASG has no target tracking policy |
| `AWS_POLL_MS` | `15000` | How often to call AWS |
| `CORS_ORIGINS` | `http://localhost:3100` | Comma separated |

The Defender (`apps/defender/.env.example`) only needs `PORT`, `CORS_ORIGINS`, and on AWS
`PUBLISH_METRICS=true` + `INSTANCE_ID` to publish its request metrics.

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
