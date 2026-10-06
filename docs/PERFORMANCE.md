# Performance model

ExpenseFlow v0.6 keeps repeat PWA launches fast while enforcing cloud authentication and never service-worker caching financial API responses.

## Static shell

- Versioned CSS, JavaScript, manifest and icons are cache-first after first use.
- Cloudflare can serve ordinary versioned static assets directly from its edge network.
- Protected root/login navigation and `/api/*` run through the Worker.
- Navigation is network-first so an expired session cannot be bypassed by stale cached HTML.
- A previously authenticated shell is only an offline fallback; financial APIs still require live authentication.
- Signing out removes the cached private HTML shell entry.

## Startup data

`GET /api/bootstrap` returns settings, categories, payment methods, accounts, app version and schema version in one authenticated request.

The browser stores this non-transaction bootstrap payload so the UI can initialize quickly, then refreshes it in the background. It is removed when authentication expires or the user signs out.

## Dynamic data

Financial responses remain `no-store` and are fetched live.

Cloud dashboard queries use one D1 `batch()` call, including current totals, charts, budgets, recurring commitments and six-month aggregates. This reduces D1 network round trips.

## Authentication overhead

Normal authenticated requests use a stateless HMAC-verified cookie, so D1 is not queried for session validation. D1 is used only for login-attempt throttling during sign-in.

## No unnecessary writes

- Last visited route is browser-local.
- Recurring processing is requested at most once per local day per browser.
