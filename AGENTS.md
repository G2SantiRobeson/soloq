<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# SoloQ project instructions

## Git workflow

- `main` is the production branch.
- `staging` is the development and integration branch.
- All development work must start from `staging`.
- Never push directly to `main`.
- Never merge into `main` automatically.
- Production changes are promoted only after manual validation in Vercel Preview.
- Do not force-push or rewrite Git history.
- Preserve valid work already present in the repository.

## Environments

### Production

- Git branch: `main`
- Vercel Production
- Public URL: `https://soloq-teal.vercel.app`
- Neon branch: `production`
- Vercel Functions region: `gru1` / São Paulo
- Do not use a Riot Development API key in Production.

### Staging / Preview

- Git branch: `staging`
- Vercel Preview
- Protected with Vercel Authentication
- Neon branch: `staging`
- Riot Development API key may be used here.
- `DEMO_MODE=false`
- This is the environment for real integration testing.

### Local development

- `.env.local` points to Neon `staging`.
- `.env.local` may use the Riot Development API key.
- `APP_URL=http://localhost:3000`
- Never use Production database credentials for local development.

## Secrets

Never:

- commit `.env` or `.env.local`;
- print secrets;
- expose API keys;
- expose database credentials;
- expose admin passwords;
- expose session secrets;
- expose cron secrets.

Do not modify `.env.local` unless the user explicitly asks.

## Database

SoloQ uses PostgreSQL on Neon with Drizzle ORM.

- Never reset, drop, truncate, or recreate the Production database.
- Never delete previously applied migrations.
- Do not generate a migration unless the Drizzle schema actually changed.
- Always inspect generated SQL before applying a migration.
- New migrations must be tested against Neon `staging` first.
- Production must later receive the exact same reviewed migration.
- Do not apply migrations against Production during ordinary development tasks.
- Preserve historical match and ranked snapshot data.

The existing migration history is authoritative.

## Riot API

The application uses Riot's Standard APIs.

Important rules:

- Riot ID / PUUID are the canonical player identity mechanism.
- Respect Riot API rate limits.
- Respect HTTP 429 and `Retry-After`.
- Do not bypass rate limits with concurrency.
- Development API keys are for the protected development/staging environment.
- Do not expose `RIOT_API_KEY` client-side.

## Match history vs rank history

This distinction is mandatory:

MATCH HISTORY != RANK HISTORY

MATCH-V5 may be used to reconstruct historical:

- matches;
- wins and losses;
- KDA;
- champion usage;
- CS;
- season performance;
- activity.

MATCH-V5 must NOT be used to invent historical:

- League Points;
- tier;
- division;
- MMR;
- ELO.

Historical rank and League Points must come only from real `RankedSnapshot` records collected by SoloQ.

Never invent missing historical LP.

## Season data

The intended architecture is:

- store the full supported season match history;
- `Season`, `30d`, and `7d` are query/display windows;
- `30d` must not be an ingestion/storage limit;
- initial historical synchronization is a season backfill;
- subsequent synchronization is incremental;
- backfills must be idempotent and resumable.

Do not redownload the entire season during every normal synchronization.

## LP deltas

Riot does not directly provide LP gained/lost per MATCH-V5 game.

Only derive an LP delta when the available snapshots support it honestly.

- One unambiguous ranked match between snapshots: may be high confidence.
- Multiple matches between snapshots: show aggregated interval delta.
- Promotion, demotion, missing snapshots, or ambiguity: mark as unknown/indeterminate.

Never interpret:

Gold I 80 LP -> Platinum IV 5 LP

as `-75 LP`.

## UI and design

Preserve the current SoloQ visual identity.

The application should remain:

- dark-first;
- competitive;
- esports-oriented;
- information-dense;
- focused on League ranked performance.

Avoid turning it into:

- a generic SaaS dashboard;
- a fintech dashboard;
- a grid of cards;
- excessive glassmorphism;
- unnecessary gradients or glow.

The leaderboard remains the primary focus of the home page.

`/metrics` is the dedicated global statistics page.

Use existing local champion icons and rank emblems when appropriate.

## Rank assets

Rank emblems exist locally, including complete emblems with exterior ornamentation / wings.

- Preserve aspect ratio.
- Do not clip wings with overflow.
- Keep tier -> asset mapping centralized.
- Keep leaderboard position (#1, #2, etc.) distinct from the player's official rank.

## Code quality

Prefer:

- strict TypeScript;
- explicit types;
- small focused functions;
- clear naming;
- reusable domain-specific components;
- server-side aggregation where appropriate;
- efficient database queries.

Avoid:

- unnecessary abstractions;
- unnecessary dependencies;
- N+1 database queries;
- giant components;
- `any` unless genuinely unavoidable.

## Scope discipline

Before implementing a task:

1. inspect the current implementation;
2. determine what is already correct;
3. preserve valid existing work;
4. implement only the requested scope.

Do not use a feature request as an excuse to refactor unrelated architecture.

## Validation

Before declaring a coding task complete, run:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

All four should pass.

When relevant, also test the feature manually in the staging/local environment.

Do not consider a task complete merely because the project compiles.

## Production safety

During development tasks:

- do not modify Production environment variables;
- do not write to Neon `production`;
- do not deploy directly to `main`;
- do not configure Production cron jobs;
- do not perform destructive Production operations.

Validate changes through:

`staging -> Vercel Preview -> Neon staging`

before promotion to Production.