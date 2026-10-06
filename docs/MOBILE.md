# Mobile

## Installed PWA

ExpenseFlow can be installed from a supported browser. The PWA keeps the application shell locally so repeat launches do not depend on downloading UI assets again.

## Local computer online

Use Tailscale Serve:

```bash
tailscale serve --bg localhost:8787
```

## Laptop/computer offline

Deploy the Cloudflare Worker + D1 edition, then install that HTTPS URL as a PWA.

See the README for Android/iOS installation and Cloudflare deployment steps.
