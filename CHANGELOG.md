# Changelog

## 0.6.0 - 2026-10-05

- Added built-in single-user Cloudflare authentication; Cloudflare Access is now optional defense-in-depth.
- Added secret-peppered HMAC-SHA256 password verification using Cloudflare Secrets; plaintext passwords are never stored in source, D1 or browser storage.
- Added signed 30-day `HttpOnly`, `Secure`, `SameSite=Strict` session cookies with a separate session secret.
- Added per-source failed-login throttling and temporary lockout using HMAC-hashed source identifiers in D1.
- Added cloud login/logout/status endpoints and a minimal responsive login screen.
- Added Settings → Cloud security → Sign out.
- Added automatic redirect to login when an authenticated API session expires.
- Changed PWA navigation to network-first so stale cached HTML cannot bypass cloud login; versioned static assets remain cache-first.
- Added cache clearing of the private HTML shell on logout/session expiry.
- Added D1 migration `0002_auth_security.sql`; existing financial tables/data are untouched.
- Added `npm run auth:setup` to generate a password hash and session secret without placing the password on the command line.
- Expanded README, Security, Cloud, Performance and Upgrade documentation with first deploy, v0.5→v0.6 upgrade, password reset and recovery steps.
- Bumped local/cloud health and PWA cache version to 0.6.0.

## 0.5.0 - 2026-10-05

- Reworked repeat PWA launches for speed: cache-first application shell with background refresh and versioned assets.
- Added Cloudflare static-asset routing so only `/api` requests execute the Worker.
- Added long-lived immutable caching for versioned JavaScript/CSS and dedicated static security headers.
- Added `/api/bootstrap` in local and cloud modes to replace separate startup settings/category/payment/account requests.
- Added browser bootstrap reuse with background revalidation; financial API responses remain uncached.
- Reworked Cloud D1 dashboard reads into one `batch()` database round trip and grouped six-month aggregates.
- Optimized D1 budget/income date queries and added performance indexes.
- Removed the D1 write previously used on every route change; last route is now browser-local.
- Limited recurring-process startup calls to once per local day per browser.
- Added optional Web Speech Recognition input for local AI mode, with no direct save path.
- Added local migration 007 and Cloudflare D1 migrations; local upgrades now fail safely if the required pre-migration backup cannot be created.
- Added fixed Ollama volume naming so ZIP/folder-name upgrades retain the Docker model volume.
- Added Windows PowerShell backup/restore/health helpers.
- Rewrote README with beginner setup for Windows/macOS/Linux, PWA installation, Cloudflare first deploy, safe local/cloud upgrades and troubleshooting.
- Bumped local/cloud health and PWA cache version to 0.5.0.

## 0.4.0 - 2026-10-03

- Replaced loose Ollama JSON mode with JSON-Schema structured outputs through `/api/chat`.
- Disabled model thinking for extraction and set deterministic temperature 0.
- Changed the default AI model from `qwen3.5:0.8b` to `qwen3.5:4b` for more reliable multilingual parsing.
- Added strict amount/date/category/payment validation and clearer AI timeout/connection errors.
- Made Test connection run a real structured-output request and test the currently visible settings.
- Keep the model warm for about five minutes by default to reduce repeated cold-start latency.
- Added mobile inline category editing after parsing; payment/date appear when screen width allows.
- Rebuilt dark mode around true `rgb(0,0,0)` AMOLED background with neutral grey surfaces and accessible text.
- Added real system-theme detection plus light/dark/system cycling.
- Refined the central mobile Add action and desktop Add button.
- Removed the Docker AI URL override so a URL saved in Settings persists across restarts.
- Bumped the PWA shell cache and local/cloud health version to 0.4.0.

## 0.3.1 - 2026-10-03

- Fixed oversized mobile transaction checkboxes caused by shared input sizing.
- Rebuilt mobile transaction rows so description, amount and metadata keep stable widths.
- Allowed two-line mobile descriptions instead of squeezing text into a tiny column.
- Added a compact mobile Select all control and synchronized bulk selection.
- Reduced the oversized mobile transaction range toolbar.
- Made quick date filters horizontally scrollable on narrow phones.
- Bumped the PWA shell cache and versioned frontend assets so the mobile CSS update is not masked by stale cache.
- Bumped local and cloud health versions to 0.3.1.

## 0.3.0 - 2026-10-03

- Rebuilt the frontend from readable, task-oriented JavaScript instead of compressed one-line functions.
- Reworked information architecture: one desktop Add action under the brand and one central mobile Add action.
- Simplified Overview to four primary KPIs plus focused charts and budget progress.
- Rebuilt bulk expense review with a dense desktop table, compact mobile rows and sticky Save all bar.
- Rebuilt transaction search, quick date scopes, advanced filters, pagination, selection and editing.
- Rebuilt Settings layout and removed the unused chart-animation control.
- Added versioned frontend assets and a new PWA cache generation to prevent stale broken JavaScript after upgrades.
- Fixed transaction edit payloads to comply with strict server-side JSON validation.
- Changed fresh-install start page to Overview while retaining the configurable start-page setting.
- Bumped local and cloud health versions to 0.3.0.

## 0.2.0 - 2026-10-03

- Rebuilt responsive UI for desktop, tablet and mobile.
- Added clickable ExpenseFlow brand navigation to Overview.
- Added desktop sidebar and mobile-only bottom navigation.
- Added sticky/fixed bulk review Save all action and compact batch review.
- Added income tracking, monthly budgets, savings targets and category limits.
- Added free-to-spend, safe-daily-spend, savings-gap and commitment calculations.
- Added six-month income vs spending and improved dashboard visualizations.
- Reworked transaction filters, pagination, truncation and multi-select actions.
- Rebuilt Settings layout for aligned controls and checkboxes.
- Added local and Cloudflare/D1 finance schema/API parity.

## 0.1.0 - 2026-10-02

- Initial ExpenseFlow implementation.
