# ExpenseFlow

ExpenseFlow is a free, open-source, lightweight personal finance tracker for phone, tablet and desktop.

Core workflow:

```text
Input → Parse → Preview → Review/Edit → Save → Dashboard
```

AI never saves directly. ExpenseFlow works without AI.

## Choose your setup

| Setup | Use when | Stack |
|---|---|---|
| **Local** | Maximum privacy and speed | Go + SQLite |
| **Local + AI** | Local Hindi/Hinglish/English parsing | Go + SQLite + Ollama |
| **Cloud** | Phone access anywhere with laptop off | Cloudflare Worker + D1 |

The same `web/` PWA is used in every mode.

---

# Fastest setup for most users: Docker

Docker is the simplest supported setup on Windows, macOS and Linux.

## Windows

1. Install **Docker Desktop** and enable its WSL2 backend.
2. Download/extract ExpenseFlow.
3. Open PowerShell inside the extracted `expenseflow` folder.
4. Run:

```powershell
docker compose up -d --build
```

Open:

```text
http://localhost:8787
```

Stop:

```powershell
docker compose down
```

## macOS

1. Install **Docker Desktop**.
2. Extract ExpenseFlow.
3. Open Terminal in the `expenseflow` folder.
4. Run:

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:8787
```

Stop:

```bash
docker compose down
```

## Linux

Install Docker Engine and the Docker Compose plugin using your distribution's official Docker instructions, then:

```bash
cd expenseflow
docker compose up -d --build
```

Open:

```text
http://localhost:8787
```

Stop:

```bash
docker compose down
```

## Where local data is stored

Your SQLite database is outside the container:

```text
expenseflow/data/expenseflow.db
```

Backups are stored in:

```text
expenseflow/data/backups/
```

**Never delete the `data/` folder when upgrading.** Rebuilding/removing containers does not remove this bind-mounted data.

---

# Local AI with Ollama

AI is optional. The deterministic Quick input parser works without it.

## Easiest: run Ollama with Docker Compose

```bash
docker compose --profile ai up -d --build
```

Pull the recommended model:

```bash
docker exec -it expenseflow-ollama ollama pull qwen3.5:4b
```

Open **More → Settings → AI**:

```text
Enable AI: ON
Model: qwen3.5:4b
URL: http://ollama:11434
Unload immediately: OFF
```

Then choose **Test connection**.

`AI Ready` means a real JSON-Schema constrained extraction request succeeded, not only that Ollama answered a ping.

## If Ollama is installed directly on your computer

Use:

```text
ExpenseFlow in Docker + host Ollama:
http://host.docker.internal:11434

Both running natively:
http://127.0.0.1:11434
```

Recommended models:

```text
qwen3.5:2b  = lower-memory fallback
qwen3.5:4b  = recommended default
qwen3.5:9b  = higher accuracy, slower/heavier
```

ExpenseFlow requests structured JSON, temperature `0`, thinking disabled and streaming disabled. Every field is validated server-side and shown in Preview before saving.

---

# Voice input

When the browser supports Web Speech Recognition, **AI input** shows a **Speak** button.

Flow:

```text
Microphone → speech transcript → AI parser → Preview → Save
```

Example:

```text
Today petrol 500 UPI, tea 40 cash, medicine 320 UPI.
```

Notes:

- Voice input never saves directly.
- ExpenseFlow does not intentionally store audio recordings.
- Browser speech recognition support varies by browser/device.
- Speech recognition may be processed by the browser/OS provider; do not assume it is fully local.
- The button is hidden automatically when the browser does not support speech recognition.

---

# Phone access while your computer is ON

Use **Tailscale Serve** for private remote access.

1. Install Tailscale on the computer.
2. Install Tailscale on the phone.
3. Sign into the same Tailscale account.
4. Run:

```bash
tailscale serve --bg localhost:8787
```

5. Open the generated HTTPS URL on your phone.
6. Install ExpenseFlow from the browser.

Use **Tailscale Serve**, not Funnel, unless you deliberately want a public endpoint.

---

# Phone access with laptop OFF: Cloudflare

Cloud mode uses:

```text
Installed PWA
    ↓
ExpenseFlow Worker
    ↓
Built-in single-user authentication
    ↓
Cloudflare D1
```

Your laptop can be completely off. Local Ollama cannot run while the computer is off, but normal expense, income, budget, transaction and dashboard features work from the cloud.

## Requirements

- A Cloudflare account.
- Current Node.js LTS.
- Internet connection.
- No payment card is required by ExpenseFlow's built-in login.

## First Cloudflare deployment

### 1. Open the cloud folder

Windows PowerShell, macOS Terminal or Linux shell:

```bash
cd expenseflow/cloud
npm ci
```

### 2. Sign into Cloudflare

```bash
npx wrangler login
```

### 3. Create the D1 database

For India/Asia, request the APAC location hint:

```bash
npx wrangler d1 create expenseflow --location=apac
```

Wrangler prints a `database_id`. Put it in `cloud/wrangler.toml`:

```toml
database_id = "YOUR_REAL_DATABASE_ID"
```

If Cloudflare says **a database with this name already exists**, do not create another one. Recover the existing ID:

```bash
npx wrangler d1 info expenseflow
```

or:

```bash
npx wrangler d1 list
```

### 4. Initialize a brand-new D1 database

Run this only for a new/empty database:

```bash
npx wrangler d1 execute expenseflow --remote --file=./schema.sql
```

### 5. Apply migrations

```bash
npx wrangler d1 migrations apply expenseflow --remote
```

### 6. Create the Worker once

```bash
npx wrangler deploy
```

Until authentication secrets are configured, v0.6 fails closed: the app shows the login/setup screen and financial APIs return an authentication-setup error.

### 7. Configure the built-in private login

```bash
npm run auth:setup
```

The setup command:

- asks for a password without echoing it;
- requires at least 16 characters;
- stores only a secret-peppered HMAC-SHA256 verifier in Cloudflare Secrets;
- generates a separate random session-signing secret;
- never writes your password into source code, D1 or browser storage.

### 8. Deploy the authenticated build

```bash
npx wrangler deploy
```

Wrangler prints a URL similar to:

```text
https://expenseflow.<your-subdomain>.workers.dev
```

Open that URL. You should see the ExpenseFlow login screen before any financial data is available.

## Cloud authentication security

Cloud authentication is enforced by the Worker, not by hiding buttons in JavaScript.

- Every financial `/api/*` route requires a valid signed session.
- Sessions use `HttpOnly`, `Secure`, `SameSite=Strict` cookies.
- The browser never stores the password or session token in `localStorage`.
- Passwords are verified with a secret-peppered HMAC-SHA256 verifier stored in Cloudflare Secrets.
- The session signing key is a separate Cloudflare secret.
- Cross-site mutation requests are rejected.
- Five failed logins within the login window trigger a temporary per-source lockout.
- Source addresses used for lockout tracking are HMAC-hashed before D1 storage.
- Sign out clears the browser session and private cached shell entry.
- Rotating the session secret signs out all existing devices.

Cloudflare Access remains an optional additional outer layer; it is not required for ExpenseFlow's built-in single-user login.

## Change or reset the cloud password

From `expenseflow/cloud`:

```bash
npm run auth:setup
npx wrangler deploy
```

This creates a new password hash and a new session secret, so existing sessions become invalid.

## Install the cloud PWA

### Android

Chrome → menu → **Add to Home screen / Install app**.

### iPhone/iPad

Safari → Share → **Add to Home Screen**.

### Windows/macOS/Linux desktop

Chrome/Edge → Install icon/menu → **Install ExpenseFlow**.

# Why v0.6 stays fast

The application shell is deliberately local-first after the first visit/install:

- HTML/CSS/JavaScript/icons are cached by the PWA.
- Versioned JS/CSS assets use long-lived immutable browser caching.
- Versioned static assets are served from the PWA cache after first use.
- Navigations are network-first so an expired cloud session cannot be bypassed by an old cached page.
- Cloudflare serves ordinary versioned JS/CSS/icon assets directly from its edge network.
- Only protected navigation/auth routes and `/api/*` execute the Worker before static delivery.
- Startup metadata uses one `/api/bootstrap` request instead of separate settings/category/payment/account requests.
- Bootstrap metadata is reused immediately from browser storage and refreshed in the background.
- Dashboard D1 reads are batched into one database round trip.
- Six-month dashboard history uses grouped queries instead of repeated month-by-month queries.
- Last-visited-page tracking is local and no longer writes to D1 on every navigation.
- Recurring processing runs at most once per local day per browser instead of on every refresh.

Financial API responses are still treated as live data and are not service-worker cached.

---

# Safe upgrades: do not delete tables or databases

ExpenseFlow upgrades the database using migrations.

Local flow:

```text
Existing database
      ↓
Pre-migration backup
      ↓
Run only missing migrations
      ↓
Record schema version
      ↓
Start new version
```

Cloud D1 uses Wrangler's migration history.

## Upgrade a local Docker installation

### If you use Git

1. Create a backup from **More → Import & backup → Backup now**.
2. Then:

```bash
docker compose down
git pull
docker compose up -d --build
```

ExpenseFlow automatically applies only missing local migrations. Before an existing database is migrated, it creates one safety backup, then applies the pending migrations in order.

### If you upgrade using ZIP files

1. In the old version, create a backup.
2. Stop the old app:

```bash
docker compose down
```

3. Extract the new ZIP to a new folder.
4. Copy the **entire old `data/` folder** into the new ExpenseFlow folder.
5. Do not copy old application code over the new code.
6. Start:

```bash
docker compose up -d --build
```

The database is migrated automatically.

The Ollama Docker volume has the fixed name `expenseflow-ollama-data`, so changing the extracted project-folder name does not intentionally create a new model volume.

## Upgrade an existing Cloudflare deployment

**Never delete the existing D1 database and do not run `schema.sql` during a normal upgrade.** Deploying new Worker code does not replace D1 data.

1. Extract/pull the new ExpenseFlow version.
2. Put the existing D1 `database_id` into the new `cloud/wrangler.toml`. If you replaced/deleted the old local project folder and no longer know the ID, run `npx wrangler d1 info expenseflow` after login and copy the existing ID; do **not** create another database.
3. Open the cloud folder:

```bash
cd cloud
npm ci
npx wrangler login
```

4. Export a safety backup before migrating:

```bash
npx wrangler d1 export expenseflow --remote --output=expenseflow-before-upgrade.sql
```

5. Check and apply only pending migrations:

```bash
npx wrangler d1 migrations list expenseflow --remote
npx wrangler d1 migrations apply expenseflow --remote
```

6. When upgrading from v0.5.x to v0.6.x, configure built-in authentication once:

```bash
npm run auth:setup
```

7. Deploy:

```bash
npx wrangler deploy
```

8. Open the Worker URL, sign in, and verify existing transactions before adding new data.

For later v0.6.x code-only upgrades, the Cloudflare secrets remain in the account; rerun `npm run auth:setup` only when you intentionally want to change the password or invalidate every session.

## Verify after any upgrade

Local:

```bash
curl -fsS http://127.0.0.1:8787/api/health
```

Windows PowerShell alternative:

```powershell
./scripts/healthcheck.ps1
```

Expected fields include:

```json
{"ok":true,"database":true,"version":"0.6.0"}
```

Then verify:

- Open Overview.
- Add one test expense and preview it.
- Save it.
- Confirm it appears in Transactions.
- Open Budget & income.
- Confirm existing data is still present.
- If AI is enabled, run Test connection.

---

# Backup and restore

## UI

Open:

```text
More → Import & backup
```

## macOS/Linux scripts

Backup:

```bash
./scripts/backup.sh
```

Health check:

```bash
./scripts/healthcheck.sh
```

Restore:

```bash
./scripts/restore.sh BACKUP_FILE.db
```

## Windows PowerShell scripts

Backup:

```powershell
./scripts/backup.ps1
```

Health check:

```powershell
./scripts/healthcheck.ps1
```

Restore:

```powershell
./scripts/restore.ps1 -Name BACKUP_FILE.db
```

Restore migrates a temporary copy of the backup before replacing the live database. A failed migration leaves the live database untouched, and a safety backup is created before replacement. Older backups are ready to use immediately after a successful restore.

---

# Input formats

## Quick input

```text
500, petrol, upi
40, chai, cash
899, mouse, card
```

Optional fields:

```text
amount, description, payment, date, category
```

You can paste many lines at once.

## AI input

Examples:

```text
aaj petrol ke 500 lage
chai ke 40 cash diye
amazon se mouse 899 card se liya
kal medicine ke 320 upi se diye
```

The AI output must satisfy a strict JSON schema and server validation before it can reach Preview.

---

# Main features

- Expense CRUD and bulk add.
- Duplicate detection.
- Editable Preview before Save.
- Sticky bulk Save bar.
- Mobile and desktop responsive UI.
- Search and date/category/payment/account/amount filters.
- Income tracking.
- Monthly expected income.
- Spending limit.
- Savings target.
- Category budgets.
- Free-to-spend and safe-daily-spend calculations.
- Recurring expenses with month-end anchor handling.
- Favorites and categorization rules.
- CSV preview/import and safe CSV export.
- Local SQLite backup/restore.
- Native Canvas charts.
- Optional Ollama structured parsing.
- Optional browser voice transcription for AI input.
- Installable PWA.
- Cloudflare Worker + D1 deployment.
- Built-in single-user cloud authentication with secure session cookies.
- Automatic local database migrations.
- Cloud D1 migrations.

## Not in v0.6

Automatic two-way local ↔ cloud database sync is intentionally **not** enabled yet. It changes record identity/conflict semantics and deserves a separate migration/test cycle rather than being rushed into a performance/stability release.

Until then, local and cloud deployments are independent databases; CSV export/import is the manual transfer path.

---

# Native Go run

Docker is recommended for non-developers.

Native mode requires Go plus a C toolchain because the SQLite driver uses CGO.

## macOS

Install Xcode Command Line Tools and Go, then:

```bash
go mod download
go run ./local
```

## Linux

Install Go and your distribution's C build tools (`build-essential`, `gcc`, etc.), then:

```bash
go mod download
go run ./local
```

## Windows

Install Go and a supported GCC/MinGW toolchain, then run from PowerShell:

```powershell
go mod download
go run ./local
```

Native default URL:

```text
http://127.0.0.1:8787
```

---

# Security and privacy defaults

- No analytics or telemetry.
- No external fonts.
- Parameterized SQL.
- SQLite foreign keys, WAL and busy timeout.
- Same-origin API.
- Cross-site mutation rejection.
- Strict Content Security Policy.
- `nosniff`, Referrer Policy and frame protection.
- Request/body/bulk limits.
- User content rendered without unsafe `innerHTML`.
- CSV formula-injection protection.
- Docker runs unprivileged and drops Linux capabilities.
- Ollama is not publicly published by the default Compose file.
- API/financial responses use `no-store`.
- Cloud static assets use dedicated security headers.
- Cloud financial APIs require built-in server-side authentication.
- Cloud sessions use signed `HttpOnly`, `Secure`, `SameSite=Strict` cookies.
- Cloud password hashes and session keys live in Cloudflare Secrets, never source control.
- Failed cloud logins are rate-limited with temporary lockout state in D1.

See `SECURITY.md`.

---

# Troubleshooting

| Problem | Fix |
|---|---|
| Port 8787 already in use | Stop the other service or change the published port. |
| Docker build cannot download modules | Check internet/DNS/proxy and retry. |
| Existing data disappeared after ZIP upgrade | Stop immediately and copy the old `data/` folder into the new project folder. |
| AI says offline | Verify Ollama is running and the configured URL matches your setup. |
| AI model missing | Pull `qwen3.5:4b`. |
| AI is slow the first time | Keep **Unload immediately** off; first request can include model load time. |
| Voice button missing | Browser does not expose SpeechRecognition, or AI mode is unavailable. |
| Phone cannot access local app | Verify Tailscale on both devices and re-run `tailscale serve`. |
| Cloud app is slow after first load | Install/open as PWA, verify v0.6 is deployed, and verify D1 migrations are applied. |
| Cloud shows Authentication is not configured | Run `npm run auth:setup`, then `npx wrangler deploy`. |
| Cloud login says migration required | Run `npx wrangler d1 migrations apply expenseflow --remote`. |
| Forgot cloud password | Run `npm run auth:setup` again and redeploy; existing data is untouched. |
| Need to sign out every device | Run `npm run auth:setup` again to rotate the session secret, then redeploy. |
| Cloud deploy works but tables are missing | On a new DB run `schema.sql`, then migrations. |
| Cloud upgrade | Apply migrations, then deploy; do not recreate the database. |
| PWA looks like an old version | Close/reopen once online; v0.6 automatically refreshes the service worker and versioned assets. |

---

# Developer commands

On a connected development machine:

```bash
go mod verify
go test -race ./...
go vet ./...
go build -o expenseflow-bin ./local
```

Cloud frontend/Worker check:

```bash
cd cloud
npm ci
npm run check
npm test
```

Docker:

```bash
docker compose build
docker compose up -d
curl -fsS http://127.0.0.1:8787/api/health
```

Security/release CI also runs dependency/vulnerability checks through GitHub Actions.

---

# Project layout

```text
local/             Go + SQLite application
web/               Shared HTML/CSS/vanilla-JS PWA
db/migrations/     Local SQLite migrations
cloud/             Cloudflare Worker + D1
cloud/migrations/  D1 migrations
scripts/           Backup/restore/health helpers
docs/              Additional technical notes
.github/            CI, CodeQL and Dependabot
```

# Development philosophy

Keep ExpenseFlow deliberately boring:

- one local Go process;
- direct SQL;
- SQLite/D1;
- plain HTML/CSS/JavaScript;
- no frontend framework;
- no ORM;
- no microservices;
- no unnecessary dependencies;
- no feature should bypass Preview/validation.

If a feature makes the core harder to understand, debug or secure, simplify it or postpone it.

# Contributing

See `CONTRIBUTING.md`.

# Security reports

See `SECURITY.md`. Do not publish active vulnerabilities in public issues.

# License

MIT. See `LICENSE`.
