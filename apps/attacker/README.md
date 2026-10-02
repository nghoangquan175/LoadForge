# @loadforge/attacker

A k6 load generator with a small control API, run on its own EC2 box (the
"Attacker") so load comes from outside the system under test, not from a
browser tab.

**Safety model:** the target URL is fixed at deploy time (`ATTACK_TARGET`). A
control request can only choose the **rate** and **duration**, never the URL, so
the box can only ever load-test the LoadForge system it was deployed for. Rate
and duration are capped (`MAX_RATE`, `MAX_DURATION_SEC`), and `/control/*`
needs the bearer `CONTROL_TOKEN`.

## Control API

| Method + path | Body | Does |
|---|---|---|
| `GET /health` | | Liveness |
| `GET /control/status` | | Current state, plan, last result |
| `POST /control/start` | `{ "rate": 50, "durationSec": 300 }` | Start a run |
| `POST /control/update` | `{ "rate": 80, "durationSec": 300 }` | Change rate/duration live (restarts k6) |
| `POST /control/stop` | | Stop the run |

All `/control/*` calls need `Authorization: Bearer <CONTROL_TOKEN>`.

```bash
TOKEN=...                       # terraform -chdir=infra/attacker output -raw control_token
URL=http://<ip>:4200            # ... output -raw control_url
curl -s $URL/control/status -H "Authorization: Bearer $TOKEN"
curl -s -X POST $URL/control/start -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"rate":60,"durationSec":300}'
```

## Deploy

CI builds `ghcr.io/<owner>/loadforge-attacker` on every push to `main`. Then:

```bash
cd infra/attacker
cp terraform.tfvars.example terraform.tfvars   # set control_cidr to your IP/32
terraform apply
```

Stop the EC2 instance between tests; stopped, it only costs its disk.

## Local

```bash
npm run build -w @loadforge/attacker
ATTACK_TARGET=http://localhost:4000/api/load/cpu?limit=50000 MAX_RATE=100 \
  K6_SCRIPT=apps/attacker/k6/attack.js node apps/attacker/dist/main.js
```

Needs k6 on the PATH (`K6_BIN` to point elsewhere).
