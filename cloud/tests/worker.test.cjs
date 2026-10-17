const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  fixture,
  expense,
  root,
  readJSON,
  validDate,
} = require("./helpers.cjs");

const contract = JSON.parse(
  fs.readFileSync(path.join(root, "testdata/input-contract.json"), "utf8"),
);

test("authentication, cross-site rejection, and login lockout", async (t) => {
  const f = fixture(t);
  assert.equal(
    (await f.request("/api/transactions", "GET", undefined, { cookie: "" }))
      .status,
    401,
  );
  assert.equal(
    (
      await f.request("/api/transactions", "GET", undefined, {
        cookie: "__Host-expenseflow_session=tampered",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.request("/api/transactions", "POST", expense(), {
        "sec-fetch-site": "cross-site",
      })
    ).status,
    403,
  );
  const login = await f.request(
    "/api/auth/login",
    "POST",
    { password: f.password },
    { cookie: "" },
  );
  assert.equal(login.status, 200);
  assert.match(
    login.headers.get("set-cookie"),
    /HttpOnly; Secure; SameSite=Strict/,
  );
  for (let i = 1; i <= 5; i++) {
    assert.equal(
      (await f.request("/api/auth/login", "POST", { password: "incorrect" }))
        .status,
      i < 5 ? 401 : 429,
    );
  }
  assert.equal(
    (await f.request("/api/auth/login", "POST", { password: f.password }))
      .status,
    429,
  );
});

test("both backends use the same calendar date and categorization contract", async (t) => {
  const f = fixture(t);
  for (const item of contract.dates) {
    assert.equal(validDate(item.value), item.valid, item.value);
    const result = await f.request("/api/transactions", "POST", {
      ...expense(item.value),
      transaction_date: item.value,
    });
    assert.equal(result.status, item.valid ? 201 : 400, item.value);
  }
  for (const rule of contract.rules)
    assert.equal((await f.request("/api/rules", "POST", rule)).status, 201);
  for (const item of contract.quick_inputs) {
    const result = await f.request("/api/parse", "POST", {
      text: item.text,
      local_date: "2026-10-15",
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.items[0].category_id, item.category_id, item.text);
  }
});

test("transaction validation rejects unsafe amounts, oversized fields, and invalid lookup types", async (t) => {
  const f = fixture(t);
  for (const patch of [
    { amount_paise: 10_000_000_001 },
    { amount_paise: Number.MAX_SAFE_INTEGER + 1 },
    { notes: "x".repeat(2001) },
    { notes: {} },
    { raw_input: "x".repeat(20001) },
    { category_id: "3" },
    { account_id: 0 },
    { source: {} },
  ])
    assert.equal(
      (await f.request("/api/transactions", "POST", { ...expense(), ...patch }))
        .status,
      400,
    );
  assert.equal(
    (await f.request("/api/transactions/bulk", "POST", { items: [null] }))
      .status,
    400,
  );
});

test("actual request bytes are limited with absent or incorrect Content-Length", async (t) => {
  const f = fixture(t);
  const json = JSON.stringify(expense());
  const atLimit = json + " ".repeat(1_048_576 - Buffer.byteLength(json));
  assert.equal(
    (await f.request("/api/transactions", "POST", atLimit)).status,
    201,
  );
  for (const headers of [{}, { "content-length": "1" }]) {
    assert.equal(
      (await f.request("/api/transactions", "POST", atLimit + " ", headers))
        .status,
      413,
    );
  }
  assert.equal(
    (
      await f.request("/api/transactions", "POST", {
        ...expense(),
        raw_input: "😀".repeat(300000),
      })
    ).status,
    413,
  );
  for (const body of ["null", "[]", "1", "{invalid"])
    assert.equal(
      (await f.request("/api/transactions", "POST", body)).status,
      400,
    );
});

test("oversized streaming JSON is cancelled before consuming the rest", async () => {
  let reads = 0,
    cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      reads++;
      controller.enqueue(new Uint8Array(600000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://expenseflow.test/api/parse", {
    method: "POST",
    body: stream,
    duplex: "half",
  });
  await assert.rejects(readJSON(request), (error) => error.status === 413);
  assert.equal(cancelled, true);
  assert.ok(reads <= 3, `read ${reads} chunks`);
});

test("concurrent single and bulk saves create one copy", async (t) => {
  const f = fixture(t);
  f.synchronizeWrites(2);
  const results = await Promise.all([
    f.request("/api/transactions", "POST", expense()),
    f.request("/api/transactions/bulk", "POST", { items: [expense()] }),
  ]);
  assert.deepEqual(results.map((x) => x.status).sort(), [201, 409]);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM transactions").get().n, 1);
});

test("concurrent bulk saves reject the entire conflicting batch", async (t) => {
  const f = fixture(t);
  f.synchronizeWrites(2);
  const results = await Promise.all(
    ["A", "B"].map((label) =>
      f.request("/api/transactions/bulk", "POST", {
        items: [expense("Shared"), expense(label)],
      }),
    ),
  );
  assert.deepEqual(results.map((x) => x.status).sort(), [201, 409]);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM transactions").get().n, 2);
});

test("bulk saves preserve explicit duplicate overrides and reject duplicates within a batch", async (t) => {
  const f = fixture(t);
  const items = [expense(), expense()];
  assert.equal(
    (await f.request("/api/transactions/bulk", "POST", { items })).status,
    409,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM transactions").get().n, 0);
  assert.equal(
    (
      await f.request("/api/transactions/bulk", "POST", {
        items,
        allow_duplicates: true,
      })
    ).data.created,
    2,
  );
  assert.equal(
    (await f.request("/api/transactions", "POST", expense())).status,
    409,
  );
  assert.equal(
    (
      await f.request("/api/transactions/bulk", "POST", {
        items: [expense("Unique"), expense()],
      })
    ).status,
    409,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM transactions").get().n, 2);
});

test("concurrent edits cannot introduce duplicates and stale edits conflict", async (t) => {
  const f = fixture(t);
  const ids = [];
  for (const label of ["A", "B"])
    ids.push(
      (await f.request("/api/transactions", "POST", expense(label))).data.id,
    );
  f.synchronizeWrites(2);
  const results = await Promise.all(
    ids.map((id) =>
      f.request(`/api/transactions/${id}`, "PUT", {
        ...expense("Same"),
        version: 1,
      }),
    ),
  );
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
  const saved = f.db
    .prepare("SELECT id FROM transactions WHERE description='Same'")
    .get();
  const stale = await f.request(`/api/transactions/${saved.id}`, "PUT", {
    ...expense("Changed"),
    version: 1,
  });
  assert.equal(stale.status, 409);
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) n FROM transactions WHERE description='Same'")
      .get().n,
    1,
  );
});

test("recurring processing preserves month-end anchors and is idempotent", async (t) => {
  const f = fixture(t);
  assert.equal(
    (
      await f.request("/api/recurring", "POST", {
        ...expense("Monthly fixture"),
        frequency: "monthly",
        next_date: "2026-01-31",
        anchor_day: 31,
        enabled: true,
      })
    ).status,
    201,
  );
  assert.equal(
    (await f.request("/api/recurring/process", "POST", { until: "2026-03-31" }))
      .data.created,
    3,
  );
  assert.deepEqual(
    f.db
      .prepare(
        "SELECT transaction_date FROM transactions ORDER BY transaction_date",
      )
      .all()
      .map((x) => x.transaction_date),
    ["2026-01-31", "2026-02-28", "2026-03-31"],
  );
  assert.equal(
    (await f.request("/api/recurring/process", "POST", { until: "2026-03-31" }))
      .data.created,
    0,
  );
});

test("financial CSV exports are no-store and spreadsheet formulas are escaped", async (t) => {
  const f = fixture(t);
  await f.request("/api/transactions", "POST", expense("=SUM(A1:A2)"));
  const result = await f.request("/api/export");
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.ok(result.data.includes("'=SUM(A1:A2)"));
});
