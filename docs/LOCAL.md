# Local mode

Local mode is one Go process serving the PWA/API and using SQLite.

Default URL:

```text
http://127.0.0.1:8787
```

Docker persists data in `./data`.

Local startup automatically:

1. opens SQLite with foreign keys, WAL and busy timeout;
2. checks `schema_version`;
3. creates one pre-migration backup for an existing database when an upgrade is pending;
4. runs only missing numbered migrations;
5. starts the HTTP server.

Do not delete `data/expenseflow.db` when upgrading.

Scheduled daily/weekly backups are checked by the startup `/api/bootstrap` request
and by health checks. Concurrent startup requests create one backup per period.
SQLite creates consistent snapshots that include committed WAL data.

Restore validates and migrates a temporary copy first, then creates a safety
backup and replaces the live database while other API requests wait. Migration
failures leave the live database and the source backup untouched.

AI routes extend the HTTP write deadline to 105 seconds so the 90-second Ollama
extraction deadline can complete and return a response.
