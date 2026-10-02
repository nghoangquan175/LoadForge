# LoadForge: making the system hold up under load

How the LoadForge system was built and then hardened, phase by phase: what
went wrong under load, why, what was changed, and what it gave. Commits are
on `main` of this repo.

**The setup in one picture**

```
k6 / dashboard load test
        │
        ▼
Internet ─► ALB :443 ─┬─ /api/*     ─► Defenders: Auto Scaling group, 1-6 x t3.micro (2 vCPU)
                      ├─ /monitor/* ─► Watcher   ┐
                      └─ /*         ─► Dashboard ┘ one t3.micro
```

| Part | Role |
|---|---|
| **Defender** | The servers under test. `GET /api/load/cpu` burns CPU (counts primes) |
| **Watcher** | Collects the group's state and metrics, streams them to the dashboard |
| **Dashboard** | Shows capacity, scaling activity and metrics; runs browser load tests |

---

## Phase 1: Building the system

*Sept 28-29: `50dc71c` … `71dbf89`*

- Learned and built the AWS pieces with Terraform: VPC with 2 public subnets,
  security groups, launch template, Application Load Balancer (HTTPS with a
  wildcard certificate), target groups, Auto Scaling group, CloudWatch, SSM
  Parameter Store for config.
- **Scaling rule:** target tracking on average CPU at 60%. AWS adds a server
  after **3 one-minute data points** above 60%, so about 3 minutes into a peak.
- **Load route:** `GET /api/load/cpu?limit=…` on the Defenders, to receive fake
  traffic from k6 or the dashboard's load test and see how strong the system is.
  (Memory and I/O routes existed at first; the test became CPU-only in `9e39ccf`.)
- **Dashboard:** shows how the Defenders scale and their state, from the Auto
  Scaling API (capacity, instances, scaling activity) and CloudWatch (metrics).
  CloudWatch data is 1-minute and arrives 1-2 minutes late, and it was read once
  a minute, so charts were **2-3 minutes behind**.
- **CI/CD:** GitHub Actions builds images to GHCR and rolls them out; instance
  refresh launches new servers before stopping old ones, so deploys have no
  downtime even with one server (`c78d7c7`).

---

## Phase 2: Wasting half the CPU

*Sept 30: `b595a95`*

**Problem.** Under load, the group never scaled out.

**Why.** A t3.micro has 2 vCPUs, but Node.js runs JavaScript on one core. One
core sat at 100% while the other stayed near 0%, so **average CPU topped out
at ~50%** and never reached the 60% target.

**Fix.** Node cluster: the primary process forks **one worker per vCPU**
(`WEB_CONCURRENCY=auto`); workers share the port, the primary restarts any that
die.

**Result** (measured, container limited to 2 CPUs): CPU **101% → 200%**,
throughput **26.7 → 39.2 req/s**. The 60% target can now trigger.

---

## Phase 3: Why was a Defender shut down for no reason?

*Sept 30: `704a4f8`*

**Problem.** Under heavy load, servers were terminated and replaced instead of
the group scaling out.

**Why.** The ALB health-checks each Defender, and the ASG (health check type
`ELB`) replaces any server the ALB marks unhealthy. The health check went to the
same workers as the fake traffic, so it **waited in line behind CPU-heavy
requests**: under load `/api/health` took **~20 s**, timed out, and a server
that was only busy was treated as dead.

**Fix.** The **primary process answers health checks** on its own port (4001);
fake traffic stays on the workers (4000). The primary does no request work, so
it answers at once. It returns 503 until at least one worker is listening.

**Result:** at 200% CPU the health check answers in **8 ms**. Busy servers stay.

Same commit, two more fixes found while testing:

- **Random 502s:** Node closed idle keep-alive connections after 5 s, while the
  ALB keeps them for 120 s and sometimes reused a closed one. Node now keeps
  them for 125 s.
- **Fair load test:** requests that miss their time slot are dropped (like k6),
  instead of going out later in a burst.

---

## Phase 4: No data / late data on the dashboard

**Problem.** During a load test the dashboard froze, and when it showed data,
it was minutes old.

**Step 1, poll more often** (*Sept 30, `2c73b4f`*). CloudWatch is read on
every poll (15 s) instead of reusing one read for a minute: up to ~1 minute less
lag.

**Step 2, a separate Watcher** (*Oct 1, `bf444a4`*). The dashboard's stream
(SSE) was served by the **same Node workers that ran the CPU-heavy load
routes**, so it froze exactly when a load test was running. The API was split:

- **Defender:** only load routes, health check and its own metrics.
- **Watcher** (new, on the dashboard instance): reads the Auto Scaling group and
  CloudWatch, streams to the dashboard. It polls only while a dashboard is open,
  because CloudWatch reads are billed.

**Step 3, ask the Defenders directly** (*Oct 2, `fdaba0b`*). CloudWatch is
still 1-2 minutes behind, so:

- Each Defender's **primary process serves `/live`** on the health port: the
  last 5 minutes, one point per second (CPU, requests, latency, 5xx). Workers
  report their counts to the primary, so these reads never reach a worker and
  never count as traffic.
- The **Watcher reads `/live` every second** and streams it.
- Each primary also **keeps its last hour in 15 s steps** (~25 KB of RAM);
  the Watcher reads it every 15 s, always, so it still has a server's data after
  the server is terminated.
- **CloudWatch now only fills gaps:** servers that are gone, time before the
  Watcher saw every server, restarts.

**Result:** dashboard delay **2-3 minutes → a few seconds**. Charts show
CloudWatch (1-minute) → Defender 15 s steps → 1 s points for the last 2 minutes,
all measured, nothing filled in.

---

## Phase 5: Can a hacker break the first Defender for 3 minutes?

*Oct 2: `fdaba0b`*

**Problem.** A burst can push one server to 90%+ CPU right away, but the 60%
rule needs 3 one-minute points before adding a server, and the new server then
needs another 2-3 minutes to boot. That is ~5 minutes of slow responses and
lost requests.

**Fix 1, a danger level.** Keep the 60% target (the "warning" level), and add:

- Each Defender's primary publishes its CPU to CloudWatch **every 10 s**
  (high-resolution metric, one series for the whole group).
- Alarm: **average over 90% for 30 s** (3 points of 10 s) → step scaling adds
  **2 Defenders at once**.
- Servers still warming up count as added, so a long alarm does not add 2 more
  every 10 s. When both rules fire, the ASG takes the bigger one.
- Reacts in about 30-50 s (each point takes a few seconds to reach
  CloudWatch). Cost: about $0.60/month.

**Fix 2, faster boot.** New Defenders boot from AWS's **ECS-optimized Amazon
Linux 2023 AMI** instead of plain Amazon Linux. An AMI is a saved server disk;
this one is published by AWS (free, updated by AWS) and already has **Docker
installed**, so boot skips `dnf install docker` (about 30-40 s). Its unused ECS
agent is turned off at boot. The Defender image itself is still pulled at boot.

| Boot step | Before | Now |
|---|---|---|
| Start Amazon Linux | ✓ | ✓ |
| Install Docker | ~30-40 s | already in the AMI |
| Pull the Defender image | ✓ | ✓ |
| ALB health checks pass | ✓ | ✓ |

The saving is estimated, not measured yet. Trade-off: this AMI's disk is 30 GB
instead of 8 GB (about $1.80/month more for the always-on server).

---

## Phase 6: Why is traffic not shared evenly?

*Oct 2: `infra/alb.tf`, applied*

**Problem.** While new Defenders boot, the first one builds up a long queue.
Once they are ready, the ALB still sends it the **same share** of new requests
(round robin), even though it is far busier. The new servers get few requests,
so some were launched only to handle a handful.

**Fix.** Target group algorithm **`least_outstanding_requests`**. The ALB keeps
a counter per Defender: when it forwards a request to Defender A, A's counter
goes up by 1; when A's response comes back, it goes down by 1. Each new request
goes to the Defender with the **lowest counter**.

A new server starts at 0, so it takes most new requests until it is as busy as
the others; the overloaded one gets fewer until its queue drains. This suits
LoadForge well: each `/api/load/cpu` request keeps a worker busy until it
finishes, so "requests in flight" is a good measure of load. Slow start stays
off: it would ramp new servers up slowly, the opposite of what is wanted.

**Limit:** requests already queued on a server stay there; the ALB cannot move
them.

---

## Still open

Ideas from the analysis that are not built yet:

- **Rate limiting with AWS WAF** in front of the ALB (per-IP limits). Against a
  real attacker this matters more than scaling: scaling means paying to serve
  the attack.
- **Warm pool:** servers booted ahead of time and stopped; start in ~20-30 s.
- **Image baked into the AMI** (Packer or EC2 Image Builder): skips the image
  pull too, but needs a rebuild per deploy.
- **`min_size = 2`:** one server is a single point of failure under attack.
- **Load shedding:** each Defender returns 503 fast once its queue is too long,
  instead of letting requests wait and time out.
- **Measure boot time** before and after the AMI change, to replace the
  estimate in Phase 5.
