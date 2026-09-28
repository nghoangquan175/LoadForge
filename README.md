# LoadForge

Auto-scaling playground. Learn traffic, load and resilience on AWS EC2.

- `apps/dashboard` â€” Next.js dashboard (real-time via SSE)
- `apps/server` â€” NestJS API (AWS CloudWatch + Auto Scaling data, heavy load routes for k6)
- `infra/` â€” Terraform (coming later)

## Requirements

- Node.js 22+
- npm 11+ (npm 10 hits an install bug with this workspace: `npm i -g npm@11`)

## Run locally

```bash
npm install
npm run dev
```

- Dashboard: http://localhost:3100
- Server: http://localhost:4000
