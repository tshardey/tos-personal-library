# Our Library

Household physical-book catalog (Vite + React + TypeScript + Tailwind 4 + Vitest). It uses the `library` schema of the Tome of Secrets Supabase project. Design: `docs/superpowers/specs/2026-11-03-personal-library-design.md`.

## Setup

```bash
cp .env.example .env
```

Edit `.env`:

- `TOS_REPO_PATH` - host path of the Tome of Secrets checkout (or worktree) that owns `supabase/` migrations. It is mounted at `/tos` in the container.
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` - local values from `supabase status`.

## First-time install

`node_modules` lives in a named Docker volume (`node_modules`), so Linux deps never clash with Windows. A fresh clone has an empty volume, so install before anything else:

```bash
docker compose run --rm app npm install
```

Re-run it whenever `package.json` or `package-lock.json` changes.

## Daily commands (Docker Compose)

```bash
docker compose up app                       # http://localhost:5173/tos-personal-library/
docker compose run --rm app npm test
docker compose run --rm app npm run lint
docker compose run --rm app npm run build
```

## Local database (Supabase)

The Supabase CLI is pinned (`supabase` devDependency `2.122.1`; 3.x rejects the ToS `config.toml` `[inbucket]` section).

**Host is the supported path for database commands.** The container shares the host Docker daemon through the mounted socket, so the CLI's bind mounts (`/tos/...`) refer to paths the daemon cannot see, and it connects to `127.0.0.1` inside the container. Findings:

- `npm run db:start` in the container works only to report an already-running stack; a fresh start there is unreliable.
- `db:reset` in the container needs `--db-url` and then leaves the DB in a state where pgTAP fails (`not_authenticated`), so do not use it.
- `db:test` in the container finds no tests (the daemon mounts an empty `/tos`).

Run these from the host instead (PowerShell or Git Bash), from this repo:

```bash
npx supabase@2.122.1 start    --workdir ../tome-of-secrets
npx supabase@2.122.1 db reset --workdir ../tome-of-secrets
npx supabase@2.122.1 test db  --workdir ../tome-of-secrets
npx supabase@2.122.1 status   --workdir ../tome-of-secrets   # keys for .env
npx supabase@2.122.1 stop     --workdir ../tome-of-secrets
```

Use your `TOS_REPO_PATH` value for `--workdir`. The `npm run db:*` scripts read `TOS_REPO_DIR` (`/tos` in the container) and also work on the host if you set `TOS_REPO_DIR` to the ToS path.

## Deploy (GitHub Pages)

Pushes to `main` run `.github/workflows/deploy.yml`. Add two repository secrets (Settings > Secrets and variables > Actions):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

and set Pages source to "GitHub Actions".
