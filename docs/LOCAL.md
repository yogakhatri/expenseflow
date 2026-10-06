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
