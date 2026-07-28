# EcoFlow — Packaging Delivery OS

Operations platform for a fast-paced small packaging warehouse: Ordermentum
order intake, release gating, barcode-verified picking, multi-run delivery
with proof-of-delivery, returns inspection, customer notifications, pricing
and statements — across Owner/Admin, Account, Warehouse and Driver surfaces.

## Documentation

| Doc | What it covers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Surfaces, enhancer layer, shared day state, RLS write matrix, edge functions |
| [docs/engineering/AGENT-OPERATING-MODEL.md](docs/engineering/AGENT-OPERATING-MODEL.md) | Multi-agent roles, work-package discipline, evidence and merge order |
| [docs/engineering/FILE-OWNERSHIP.md](docs/engineering/FILE-OWNERSHIP.md) | Protected paths and required implementation/review ownership |
| [docs/adr/README.md](docs/adr/README.md) | Accepted architecture decisions and ADR process |
| [docs/OPERATIONS-RUNBOOK.md](docs/OPERATIONS-RUNBOOK.md) | Incident playbooks (deploy pipeline, DB connections, Vercel skew), storage retention, field-device issues |
| [docs/RELEASE-PROCESS.md](docs/RELEASE-PROCESS.md) | Push discipline, shadow verification gate, release-sync status, local UI smoke testing |
| docs/archive/ | Historical per-feature write-ups |

## Quick start (development)

```bash
npm ci                 # Node 22.x, npm 10.9.4
npm run dev            # requires VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local
```

Production deploys: Vercel builds the frontend on push; GitHub Actions
(`deploy-supabase-migrations.yml`) shadow-verifies and applies database
migrations, then deploys all edge functions. See RELEASE-PROCESS.md.
