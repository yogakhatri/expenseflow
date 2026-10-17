import type { Env } from "./db";
import { bad, fingerprint, json, norm, validDate } from "./db";
import {
  authConfigured,
  authRequired,
  authStatus,
  isAuthenticated,
  login,
  logout,
} from "./auth";
import { readJSON } from "./request";

const APP_VERSION = "0.6.0";
const MAX_BULK = 500;

const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Robots-Tag": "noindex",
};

function secure(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders))
    headers.set(key, value);
  if (headers.get("content-type")?.includes("application/json"))
    headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isMutation(request: Request): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(request.method);
}

function sameOrigin(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site) return site === "same-origin" || site === "none";
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function parsePaise(value: string): number | null {
  const cleaned = value.trim().replace(/^₹/, "").trim();
  if (!/^\+?\d+(?:\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.replace(/^\+/, "").split(".");
  const paise = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}

function formatPaise(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

function csvSafe(value: string): string {
  const trimmed = value.trimStart();
  const safe = trimmed && "=+-@".includes(trimmed[0]) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

async function lookupMap(
  env: Env,
  table: "categories" | "payment_methods" | "accounts",
): Promise<Map<string, number>> {
  const result = await env.DB.prepare(
    `SELECT id,name FROM ${table} WHERE enabled=1`,
  ).all<any>();
  return new Map(result.results.map((x: any) => [norm(x.name), Number(x.id)]));
}

function paymentAlias(value: string): string {
  const v = norm(value);
  if (["card", "credit", "creditcard"].includes(v)) return "credit card";
  if (["debit", "debitcard"].includes(v)) return "debit card";
  if (["bank", "transfer"].includes(v)) return "bank transfer";
  return v;
}

async function validTransaction(env: Env, input: any): Promise<string> {
  if (!input || typeof input !== "object") return "Invalid transaction";
  if (
    !Number.isSafeInteger(input.amount_paise) ||
    input.amount_paise <= 0 ||
    input.amount_paise > 10_000_000_000
  )
    return "Invalid amount";
  if (
    typeof input.description !== "string" ||
    !input.description.trim() ||
    input.description.length > 300
  )
    return "Invalid description";
  if (
    input.notes != null &&
    (typeof input.notes !== "string" || input.notes.length > 2000)
  )
    return "Invalid notes";
  if (
    input.raw_input != null &&
    (typeof input.raw_input !== "string" || input.raw_input.length > 20_000)
  )
    return "Invalid raw input";
  if (input.source != null && typeof input.source !== "string")
    return "Invalid source";
  if (!Number.isSafeInteger(input.category_id) || input.category_id <= 0)
    return "Invalid category";
  if (
    !Number.isSafeInteger(input.payment_method_id) ||
    input.payment_method_id <= 0
  )
    return "Invalid payment method";
  if (
    input.account_id != null &&
    (!Number.isSafeInteger(input.account_id) || input.account_id <= 0)
  )
    return "Invalid account";
  if (!validDate(input.transaction_date)) return "Invalid date";
  const [category, payment, account] = await Promise.all([
    env.DB.prepare("SELECT 1 FROM categories WHERE id=?")
      .bind(input.category_id)
      .first(),
    env.DB.prepare("SELECT 1 FROM payment_methods WHERE id=?")
      .bind(input.payment_method_id)
      .first(),
    input.account_id
      ? env.DB.prepare("SELECT 1 FROM accounts WHERE id=?")
          .bind(input.account_id)
          .first()
      : Promise.resolve({ ok: 1 }),
  ]);
  if (!category) return "Invalid category";
  if (!payment) return "Invalid payment method";
  if (!account) return "Invalid account";
  return "";
}

async function createTransaction(
  env: Env,
  input: any,
  allowDuplicate = false,
): Promise<number> {
  const validation = await validTransaction(env, input);
  if (validation) throw Object.assign(new Error(validation), { status: 400 });
  const fp = await fingerprint(input);
  // The duplicate predicate and write must execute in the same SQL statement.
  const result = await env.DB.prepare(
    `
    INSERT INTO transactions(amount_paise,description,category_id,payment_method_id,account_id,transaction_date,notes,raw_input,source,ai_processed,fingerprint)
    SELECT ?,?,?,?,?,?,?,?,?,?,?
    WHERE ? OR NOT EXISTS (SELECT 1 FROM transactions WHERE fingerprint=?)
  `,
  )
    .bind(
      input.amount_paise,
      input.description.trim(),
      input.category_id,
      input.payment_method_id,
      input.account_id || null,
      input.transaction_date,
      input.notes || "",
      input.raw_input || "",
      input.source || "manual",
      input.ai_processed ? 1 : 0,
      fp,
      allowDuplicate ? 1 : 0,
      fp,
    )
    .run();
  if (!result.meta.changes)
    throw Object.assign(new Error("Possible duplicate transaction"), {
      status: 409,
      duplicate: true,
    });
  return Number(result.meta.last_row_id || 0);
}

async function handleParse(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return bad("Method not allowed", 405);
  const input = await readJSON<{ text: string; local_date: string }>(request);
  if (!input.text?.trim()) return bad("Input is empty");
  const localDate = validDate(input.local_date)
    ? input.local_date
    : new Date().toISOString().slice(0, 10);
  const [categories, payments, accounts] = await Promise.all([
    lookupMap(env, "categories"),
    lookupMap(env, "payment_methods"),
    lookupMap(env, "accounts"),
  ]);
  const other = categories.get("other") || 0;
  const cash = payments.get("cash") || 0;
  const account = accounts.get("cash") || null;
  const rules = await env.DB.prepare(
    `
    SELECT r.category_id,c.name category_name,r.keyword,r.merchant
    FROM categorization_rules r JOIN categories c ON c.id=r.category_id
    WHERE r.enabled=1 ORDER BY r.priority,r.id
  `,
  ).all<any>();
  const items: any[] = [];
  for (const [index, raw] of input.text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length < 3 || parts.length > 5)
      return bad(
        `Line ${index + 1} must be amount, description, payment[, date, category]`,
      );
    const amount = parsePaise(parts[0]);
    const description = parts[1].trim();
    if (!amount || !description) return bad(`Line ${index + 1} is invalid`);
    let needsReview = false;
    let paymentName = paymentAlias(parts[2]);
    let payment = payments.get(paymentName) || cash;
    if (!payments.get(paymentName)) {
      needsReview = true;
      paymentName = "cash";
    }
    const date = parts[3]?.trim() || localDate;
    if (!validDate(date)) return bad(`Line ${index + 1} has invalid date`);
    const explicitCategory = parts[4]?.trim() || "";
    let categoryName = norm(explicitCategory || "other");
    let category = categories.get(categoryName) || other;
    if (explicitCategory && !categories.get(categoryName)) {
      needsReview = true;
      categoryName = "other";
    }
    if (!explicitCategory) {
      const normalizedDescription = norm(description);
      const rule = rules.results.find(
        (rule) =>
          (rule.keyword &&
            normalizedDescription.includes(norm(rule.keyword))) ||
          (rule.merchant &&
            normalizedDescription.includes(norm(rule.merchant))),
      );
      if (rule) {
        category = Number(rule.category_id);
        categoryName = rule.category_name;
      }
    }
    items.push({
      amount_paise: amount,
      description,
      category_id: category,
      category_name: categoryName,
      payment_method_id: payment,
      payment_name: paymentName,
      account_id: account,
      transaction_date: date,
      notes: "",
      raw_input: line,
      source: "comma",
      needs_review: needsReview,
    });
  }
  if (!items.length) return bad("No transactions found");
  return json({ items });
}

async function handleTransactions(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (request.method === "POST") {
    const input = await readJSON(request);
    try {
      return json({ id: await createTransaction(env, input) }, 201);
    } catch (error: any) {
      return json(
        { error: error.message, duplicate: !!error.duplicate },
        error.status || 500,
      );
    }
  }
  if (request.method !== "GET") return bad("Method not allowed", 405);

  const clauses = ["1=1"];
  const args: any[] = [];
  const search = (url.searchParams.get("search") || "").trim();
  if (search) {
    clauses.push("(t.description LIKE ? OR t.notes LIKE ?)");
    args.push(`%${search}%`, `%${search}%`);
  }
  for (const [key, column] of [
    ["category", "t.category_id"],
    ["payment", "t.payment_method_id"],
    ["account", "t.account_id"],
  ] as const) {
    const value = url.searchParams.get(key);
    if (value) {
      clauses.push(`${column}=?`);
      args.push(Number(value));
    }
  }
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from && validDate(from)) {
    clauses.push("t.transaction_date>=?");
    args.push(from);
  }
  if (to && validDate(to)) {
    clauses.push("t.transaction_date<=?");
    args.push(to);
  }
  const min = Number(url.searchParams.get("min"));
  const max = Number(url.searchParams.get("max"));
  if (Number.isSafeInteger(min) && min > 0) {
    clauses.push("t.amount_paise>=?");
    args.push(min);
  }
  if (Number.isSafeInteger(max) && max > 0) {
    clauses.push("t.amount_paise<=?");
    args.push(max);
  }
  const sort = url.searchParams.get("sort");
  const order =
    sort === "amount_desc"
      ? "t.amount_paise DESC,t.id DESC"
      : sort === "amount_asc"
        ? "t.amount_paise ASC,t.id DESC"
        : "t.transaction_date DESC,t.id DESC";
  const limit = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get("limit") || 100) || 100),
  );
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0) || 0);
  const result = await env.DB.prepare(
    `
    SELECT t.*,c.name category_name,p.name payment_method_name,COALESCE(a.name,'') account_name
    FROM transactions t
    JOIN categories c ON c.id=t.category_id
    JOIN payment_methods p ON p.id=t.payment_method_id
    LEFT JOIN accounts a ON a.id=t.account_id
    WHERE ${clauses.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?
  `,
  )
    .bind(...args, limit, offset)
    .all();
  return json({ items: result.results, limit, offset });
}

async function handleBulk(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return bad("Method not allowed", 405);
  const payload: any = await readJSON(request);
  if (
    !Array.isArray(payload.items) ||
    payload.items.length < 1 ||
    payload.items.length > MAX_BULK
  )
    return bad("Invalid bulk item count");
  const fingerprints: string[] = [];
  const seen = new Set<string>();
  for (const item of payload.items) {
    const validation = await validTransaction(env, item);
    if (validation) return bad(validation);
    const fp = await fingerprint(item);
    if (seen.has(fp) && payload.allow_duplicates !== true)
      return json(
        { error: "Possible duplicate transactions", duplicate: true },
        409,
      );
    seen.add(fp);
    fingerprints.push(fp);
  }
  const incoming = payload.items.map((item: any, index: number) => ({
    amount_paise: item.amount_paise,
    description: item.description.trim(),
    category_id: item.category_id,
    payment_method_id: item.payment_method_id,
    account_id: item.account_id ?? null,
    transaction_date: item.transaction_date,
    notes: item.notes || "",
    raw_input: item.raw_input || "",
    source: item.source || "manual",
    ai_processed: item.ai_processed ? 1 : 0,
    fingerprint: fingerprints[index],
  }));
  // One statement checks every fingerprint and inserts the whole batch. A
  // concurrent save cannot slip between checking and writing, and a conflict
  // inserts zero rows rather than partially saving the batch.
  const result = await env.DB.prepare(
    `
    WITH incoming AS MATERIALIZED (
      SELECT
        json_extract(value,'$.amount_paise') amount_paise,
        json_extract(value,'$.description') description,
        json_extract(value,'$.category_id') category_id,
        json_extract(value,'$.payment_method_id') payment_method_id,
        json_extract(value,'$.account_id') account_id,
        json_extract(value,'$.transaction_date') transaction_date,
        json_extract(value,'$.notes') notes,
        json_extract(value,'$.raw_input') raw_input,
        json_extract(value,'$.source') source,
        json_extract(value,'$.ai_processed') ai_processed,
        json_extract(value,'$.fingerprint') fingerprint
      FROM json_each(?)
    )
    INSERT INTO transactions(amount_paise,description,category_id,payment_method_id,account_id,transaction_date,notes,raw_input,source,ai_processed,fingerprint)
    SELECT amount_paise,description,category_id,payment_method_id,account_id,transaction_date,notes,raw_input,source,ai_processed,fingerprint
    FROM incoming
    WHERE ? OR NOT EXISTS (
      SELECT 1 FROM transactions t JOIN incoming i ON i.fingerprint=t.fingerprint
    )
  `,
  )
    .bind(JSON.stringify(incoming), payload.allow_duplicates === true ? 1 : 0)
    .run();
  if (!result.meta.changes)
    return json(
      { error: "Possible duplicate transactions", duplicate: true },
      409,
    );
  return json({ created: result.meta.changes }, 201);
}

async function handleBulkDelete(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return bad("Method not allowed", 405);
  const payload = await readJSON<{ ids: number[] }>(request);
  if (
    !Array.isArray(payload.ids) ||
    payload.ids.length < 1 ||
    payload.ids.length > MAX_BULK
  )
    return bad("Invalid bulk item count");
  await env.DB.batch(
    payload.ids.map((id) =>
      env.DB.prepare("DELETE FROM transactions WHERE id=?").bind(id),
    ),
  );
  return json({ ok: true });
}

async function handleTransactionByID(
  request: Request,
  env: Env,
  id: number,
): Promise<Response> {
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM transactions WHERE id=?").bind(id).run();
    return json({ ok: true });
  }
  if (request.method !== "PUT") return bad("Method not allowed", 405);
  const input: any = await readJSON(request);
  const validation = await validTransaction(env, input);
  if (validation) return bad(validation);
  if (!Number.isInteger(input.version) || input.version < 1)
    return bad("version is required");
  const fp = await fingerprint(input);
  const duplicate = await env.DB.prepare(
    "SELECT id FROM transactions WHERE fingerprint=? AND id<>? LIMIT 1",
  )
    .bind(fp, id)
    .first();
  if (duplicate)
    return json(
      { error: "Possible duplicate transaction", duplicate: true },
      409,
    );
  const result = await env.DB.prepare(
    `
    UPDATE transactions SET amount_paise=?,description=?,category_id=?,payment_method_id=?,account_id=?,transaction_date=?,notes=?,fingerprint=?,version=version+1,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND version=?
      AND NOT EXISTS (SELECT 1 FROM transactions WHERE fingerprint=? AND id<>?)
  `,
  )
    .bind(
      input.amount_paise,
      input.description.trim(),
      input.category_id,
      input.payment_method_id,
      input.account_id || null,
      input.transaction_date,
      input.notes || "",
      fp,
      id,
      input.version,
      fp,
      id,
    )
    .run();
  if (!result.meta.changes) {
    if (
      await env.DB.prepare(
        "SELECT id FROM transactions WHERE fingerprint=? AND id<>? LIMIT 1",
      )
        .bind(fp, id)
        .first()
    ) {
      return json(
        { error: "Possible duplicate transaction", duplicate: true },
        409,
      );
    }
    return bad("Transaction changed elsewhere; refresh and retry", 409);
  }
  return json({ ok: true });
}

async function handleLookups(
  request: Request,
  env: Env,
  table: string,
  id?: number,
): Promise<Response> {
  if (!["categories", "payment_methods", "accounts"].includes(table))
    return bad("Not found", 404);
  if (!id && request.method === "GET") {
    const result = await env.DB.prepare(
      `SELECT * FROM ${table} ORDER BY enabled DESC,name`,
    ).all();
    return json({
      items: result.results.map((x: any) => ({ ...x, enabled: !!x.enabled })),
    });
  }
  const payload: any =
    request.method === "POST" || request.method === "PUT"
      ? await readJSON(request)
      : null;
  if (!id && request.method === "POST") {
    if (typeof payload.name !== "string" || !payload.name.trim())
      return bad("Name required");
    try {
      const result =
        table === "categories"
          ? await env.DB.prepare(
              "INSERT INTO categories(name,icon,color) VALUES(?,?,?)",
            )
              .bind(
                payload.name.trim(),
                payload.icon || "tag",
                payload.color || "#64748b",
              )
              .run()
          : await env.DB.prepare(`INSERT INTO ${table}(name) VALUES(?)`)
              .bind(payload.name.trim())
              .run();
      return json({ id: result.meta.last_row_id }, 201);
    } catch {
      return bad("Name already exists or is invalid", 409);
    }
  }
  if (id && request.method === "PUT") {
    if (typeof payload.name !== "string" || !payload.name.trim())
      return bad("Name required");
    if (table === "categories") {
      await env.DB.prepare(
        "UPDATE categories SET name=?,icon=?,color=?,enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
        .bind(
          payload.name.trim(),
          payload.icon || "tag",
          payload.color || "#64748b",
          payload.enabled === false ? 0 : 1,
          id,
        )
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE ${table} SET name=?,enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      )
        .bind(payload.name.trim(), payload.enabled === false ? 0 : 1, id)
        .run();
    }
    return json({ ok: true });
  }
  if (id && request.method === "DELETE") {
    const column =
      table === "categories"
        ? "category_id"
        : table === "payment_methods"
          ? "payment_method_id"
          : "account_id";
    if (
      await env.DB.prepare(
        `SELECT id FROM transactions WHERE ${column}=? LIMIT 1`,
      )
        .bind(id)
        .first()
    )
      return bad("Item is referenced; disable it instead", 409);
    await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run();
    return json({ ok: true });
  }
  return bad("Method not allowed", 405);
}

function validMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
function nonNegative(value: number): number {
  return Math.max(0, value || 0);
}

async function handleIncome(
  request: Request,
  env: Env,
  url: URL,
  id?: number,
): Promise<Response> {
  if (id && request.method === "DELETE") {
    const r = await env.DB.prepare("DELETE FROM income_entries WHERE id=?")
      .bind(id)
      .run();
    if (!r.meta.changes) return bad("Income not found", 404);
    return json({ ok: true });
  }
  if (id && request.method === "PUT") {
    const x: any = await readJSON(request);
    if (
      !Number.isInteger(x.amount_paise) ||
      x.amount_paise <= 0 ||
      typeof x.source !== "string" ||
      !x.source.trim() ||
      x.source.length > 120 ||
      !validDate(x.income_date) ||
      !Number.isInteger(x.version) ||
      x.version < 1
    )
      return bad("Invalid income");
    if (
      x.account_id &&
      !(await env.DB.prepare("SELECT 1 FROM accounts WHERE id=?")
        .bind(x.account_id)
        .first())
    )
      return bad("Invalid account");
    const r = await env.DB.prepare(
      `UPDATE income_entries SET amount_paise=?,source=?,account_id=?,income_date=?,notes=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND version=?`,
    )
      .bind(
        x.amount_paise,
        x.source.trim(),
        x.account_id || null,
        x.income_date,
        x.notes || "",
        id,
        x.version,
      )
      .run();
    if (!r.meta.changes)
      return bad("Income changed elsewhere; refresh and retry", 409);
    return json({ ok: true });
  }
  if (!id && request.method === "GET") {
    const month = url.searchParams.get("month") || "";
    if (month && !validMonthKey(month)) return bad("Invalid month");
    const q = month
      ? `SELECT i.id,i.amount_paise,i.source,i.account_id,COALESCE(a.name,'') account_name,i.income_date,i.notes,i.version,i.created_at,i.updated_at FROM income_entries i LEFT JOIN accounts a ON a.id=i.account_id WHERE i.income_date>=? AND i.income_date<? ORDER BY i.income_date DESC,i.id DESC`
      : `SELECT i.id,i.amount_paise,i.source,i.account_id,COALESCE(a.name,'') account_name,i.income_date,i.notes,i.version,i.created_at,i.updated_at FROM income_entries i LEFT JOIN accounts a ON a.id=i.account_id ORDER BY i.income_date DESC,i.id DESC`;
    let r;
    if (month) {
      const start = `${month}-01`;
      const d = new Date(`${start}T00:00:00Z`);
      const next = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1),
      )
        .toISOString()
        .slice(0, 10);
      r = await env.DB.prepare(q).bind(start, next).all<any>();
    } else r = await env.DB.prepare(q).all<any>();
    const total = r.results.reduce(
      (sum: any, x: any) => sum + Number(x.amount_paise || 0),
      0,
    );
    return json({ items: r.results, total_paise: total });
  }
  if (!id && request.method === "POST") {
    const x: any = await readJSON(request);
    if (
      !Number.isInteger(x.amount_paise) ||
      x.amount_paise <= 0 ||
      typeof x.source !== "string" ||
      !x.source.trim() ||
      x.source.length > 120 ||
      !validDate(x.income_date)
    )
      return bad("Invalid income");
    if (
      x.account_id &&
      !(await env.DB.prepare("SELECT 1 FROM accounts WHERE id=?")
        .bind(x.account_id)
        .first())
    )
      return bad("Invalid account");
    const r = await env.DB.prepare(
      "INSERT INTO income_entries(amount_paise,source,account_id,income_date,notes) VALUES(?,?,?,?,?)",
    )
      .bind(
        x.amount_paise,
        x.source.trim(),
        x.account_id || null,
        x.income_date,
        x.notes || "",
      )
      .run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  return bad("Method not allowed", 405);
}

async function handleBudget(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (request.method === "GET") {
    const month = url.searchParams.get("month") || "";
    if (!validMonthKey(month)) return bad("Invalid month");
    const start = `${month}-01`;
    const startDate = new Date(`${start}T00:00:00Z`);
    const next = new Date(
      Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 1),
    )
      .toISOString()
      .slice(0, 10);
    const results = await env.DB.batch([
      env.DB.prepare(
        "SELECT expected_income_paise,spending_limit_paise,savings_target_paise FROM monthly_budgets WHERE month_key=?",
      ).bind(month),
      env.DB.prepare(
        `SELECT c.id category_id,c.name category_name,COALESCE(cb.limit_paise,0) limit_paise,COALESCE(SUM(t.amount_paise),0) spent_paise FROM categories c LEFT JOIN category_budgets cb ON cb.category_id=c.id AND cb.month_key=? LEFT JOIN transactions t ON t.category_id=c.id AND t.transaction_date>=? AND t.transaction_date<? WHERE c.enabled=1 GROUP BY c.id ORDER BY c.name`,
      ).bind(month, start, next),
    ]);
    const base: any = results[0]?.results?.[0] || null;
    return json({
      month,
      expected_income_paise: Number(base?.expected_income_paise || 0),
      spending_limit_paise: Number(base?.spending_limit_paise || 0),
      savings_target_paise: Number(base?.savings_target_paise || 0),
      categories: results[1]?.results || [],
    });
  }
  if (request.method !== "PUT") return bad("Method not allowed", 405);
  const x: any = await readJSON(request);
  if (
    !validMonthKey(x.month) ||
    !Number.isInteger(x.expected_income_paise) ||
    x.expected_income_paise < 0 ||
    !Number.isInteger(x.spending_limit_paise) ||
    x.spending_limit_paise < 0 ||
    !Number.isInteger(x.savings_target_paise) ||
    x.savings_target_paise < 0 ||
    !Array.isArray(x.categories) ||
    x.categories.length > 200
  )
    return bad("Invalid budget");
  const statements = [
    env.DB.prepare(
      `INSERT INTO monthly_budgets(month_key,expected_income_paise,spending_limit_paise,savings_target_paise) VALUES(?,?,?,?) ON CONFLICT(month_key) DO UPDATE SET expected_income_paise=excluded.expected_income_paise,spending_limit_paise=excluded.spending_limit_paise,savings_target_paise=excluded.savings_target_paise,updated_at=CURRENT_TIMESTAMP`,
    ).bind(
      x.month,
      x.expected_income_paise,
      x.spending_limit_paise,
      x.savings_target_paise,
    ),
    env.DB.prepare("DELETE FROM category_budgets WHERE month_key=?").bind(
      x.month,
    ),
  ];
  for (const c of x.categories) {
    if (!c.limit_paise) continue;
    if (
      !Number.isInteger(c.category_id) ||
      c.category_id <= 0 ||
      !Number.isInteger(c.limit_paise) ||
      c.limit_paise < 0
    )
      return bad("Invalid category budget");
    statements.push(
      env.DB.prepare(
        "INSERT INTO category_budgets(month_key,category_id,limit_paise) VALUES(?,?,?)",
      ).bind(x.month, c.category_id, c.limit_paise),
    );
  }
  await env.DB.batch(statements);
  return json({ ok: true });
}

async function handleStats(env: Env, url: URL): Promise<Response> {
  const date = validDate(url.searchParams.get("date") || "")
    ? url.searchParams.get("date")!
    : new Date().toISOString().slice(0, 10);
  const d = new Date(`${date}T00:00:00Z`);
  const current = date.slice(0, 7);
  const monthStart = `${current}-01`;
  const nextMonthDate = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1),
  );
  const nextMonth = nextMonthDate.toISOString().slice(0, 10);
  const monthEnd = new Date(nextMonthDate.getTime() - 86400000)
    .toISOString()
    .slice(0, 10);
  const prevMonthStart = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1),
  )
    .toISOString()
    .slice(0, 10);
  const sixMonthStartDate = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 5, 1),
  );
  const sixMonthStart = sixMonthStartDate.toISOString().slice(0, 10);

  const statements = [
    env.DB.prepare(
      "SELECT COALESCE(SUM(amount_paise),0) this_month_paise,COUNT(*) transaction_count FROM transactions WHERE transaction_date>=? AND transaction_date<?",
    ).bind(monthStart, nextMonth),
    env.DB.prepare(
      "SELECT COALESCE(SUM(amount_paise),0) value FROM transactions WHERE transaction_date=?",
    ).bind(date),
    env.DB.prepare(
      "SELECT COALESCE(SUM(amount_paise),0) value FROM transactions WHERE transaction_date>=? AND transaction_date<?",
    ).bind(prevMonthStart, monthStart),
    env.DB.prepare(
      "SELECT COALESCE(SUM(amount_paise),0) value FROM income_entries WHERE income_date>=? AND income_date<?",
    ).bind(monthStart, nextMonth),
    env.DB.prepare(
      "SELECT expected_income_paise,spending_limit_paise,savings_target_paise FROM monthly_budgets WHERE month_key=?",
    ).bind(current),
    env.DB.prepare(
      "SELECT transaction_date date,SUM(amount_paise) total_paise FROM transactions WHERE transaction_date>=? AND transaction_date<? GROUP BY transaction_date ORDER BY transaction_date",
    ).bind(monthStart, nextMonth),
    env.DB.prepare(
      `SELECT c.id,c.name,SUM(t.amount_paise) total_paise,COALESCE(cb.limit_paise,0) budget_paise FROM transactions t JOIN categories c ON c.id=t.category_id LEFT JOIN category_budgets cb ON cb.category_id=c.id AND cb.month_key=? WHERE t.transaction_date>=? AND t.transaction_date<? GROUP BY c.id ORDER BY total_paise DESC`,
    ).bind(current, monthStart, nextMonth),
    env.DB.prepare(
      "SELECT p.name,SUM(t.amount_paise) total_paise FROM transactions t JOIN payment_methods p ON p.id=t.payment_method_id WHERE t.transaction_date>=? AND t.transaction_date<? GROUP BY p.id ORDER BY total_paise DESC",
    ).bind(monthStart, nextMonth),
    env.DB.prepare(
      "SELECT description,amount_paise FROM transactions WHERE transaction_date>=? AND transaction_date<? ORDER BY amount_paise DESC LIMIT 1",
    ).bind(monthStart, nextMonth),
    env.DB.prepare(
      "SELECT amount_paise,frequency,anchor_day,next_date FROM recurring_expenses WHERE enabled=1 AND next_date<=?",
    ).bind(monthEnd),
    env.DB.prepare(
      "SELECT substr(transaction_date,1,7) month,SUM(amount_paise) value FROM transactions WHERE transaction_date>=? AND transaction_date<? GROUP BY month",
    ).bind(sixMonthStart, nextMonth),
    env.DB.prepare(
      "SELECT substr(income_date,1,7) month,SUM(amount_paise) value FROM income_entries WHERE income_date>=? AND income_date<? GROUP BY month",
    ).bind(sixMonthStart, nextMonth),
    env.DB.prepare(
      `SELECT c.id category_id,c.name category_name,cb.limit_paise,COALESCE(SUM(t.amount_paise),0) spent_paise FROM category_budgets cb JOIN categories c ON c.id=cb.category_id LEFT JOIN transactions t ON t.category_id=c.id AND t.transaction_date>=? AND t.transaction_date<? WHERE cb.month_key=? GROUP BY c.id ORDER BY c.name`,
    ).bind(monthStart, nextMonth, current),
  ];
  const results = await env.DB.batch(statements);
  const rows = <T = any>(index: number): T[] =>
    (results[index]?.results || []) as T[];
  const first = <T = any>(index: number): T | null => rows<T>(index)[0] || null;

  const totals: any = first(0);
  const today: any = first(1);
  const previous: any = first(2);
  const income: any = first(3);
  const budget: any = first(4);
  const daily = rows(5);
  const categories = rows<any>(6);
  const payments = rows(7);
  const largest: any = first(8);
  const recurring = rows<any>(9);
  const expenseMonths = new Map(
    rows<any>(10).map((x) => [String(x.month), Number(x.value || 0)]),
  );
  const incomeMonths = new Map(
    rows<any>(11).map((x) => [String(x.month), Number(x.value || 0)]),
  );
  const categoryBudgets = rows<any>(12);

  let upcoming = 0;
  for (const item of recurring) {
    let next = String(item.next_date);
    while (next <= monthEnd) {
      if (next > date) upcoming += Number(item.amount_paise || 0);
      const following = nextRecurringDate(
        next,
        String(item.frequency),
        Number(item.anchor_day),
      );
      if (following === next) break;
      next = following;
    }
  }

  const expense = Number(totals?.this_month_paise || 0);
  const incomeTotal = Number(income?.value || 0);
  const expected = Number(budget?.expected_income_paise || 0);
  const limit = Number(budget?.spending_limit_paise || 0);
  const target = Number(budget?.savings_target_paise || 0);
  const net = incomeTotal - expense;
  const savingsGap = nonNegative(target - net);
  const cashAfter = nonNegative(incomeTotal - expense - target - upcoming);
  const budgetRemaining = limit ? nonNegative(limit - expense) : null;
  const free = limit
    ? Math.min(cashAfter, nonNegative((budgetRemaining || 0) - upcoming))
    : cashAfter;
  const daysInMonth = Number(monthEnd.slice(8, 10));
  const daysElapsed = Math.max(1, Number(date.slice(8, 10)));
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed + 1);
  const dailyAvg = Math.floor(expense / daysElapsed);
  const safeDaily = daysRemaining ? Math.floor(free / daysRemaining) : 0;

  const cashflow: any[] = [];
  for (let i = 5; i >= 0; i--) {
    const monthDate = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1),
    );
    const month = monthDate.toISOString().slice(0, 7);
    const monthIncome = incomeMonths.get(month) || 0;
    const monthExpense = expenseMonths.get(month) || 0;
    cashflow.push({
      month,
      name: monthDate.toLocaleString("en", { month: "short", timeZone: "UTC" }),
      income_paise: monthIncome,
      expense_paise: monthExpense,
      net_paise: monthIncome - monthExpense,
    });
  }

  const top = categories[0];
  return json({
    date,
    month: current,
    this_month_paise: expense,
    today_paise: Number(today?.value || 0),
    daily_average_paise: dailyAvg,
    transaction_count: Number(totals?.transaction_count || 0),
    previous_month_paise: Number(previous?.value || 0),
    income_paise: incomeTotal,
    expected_income_paise: expected,
    spending_limit_paise: limit,
    savings_target_paise: target,
    net_savings_paise: net,
    savings_gap_paise: savingsGap,
    budget_remaining_paise: budgetRemaining,
    upcoming_commitments_paise: upcoming,
    free_to_spend_paise: free,
    safe_daily_paise: safeDaily,
    days_remaining: daysRemaining,
    projected_month_end_paise: dailyAvg * daysInMonth,
    top_category: top?.name || "",
    top_category_paise: Number(top?.total_paise || 0),
    largest_expense: largest?.description || "",
    largest_expense_paise: Number(largest?.amount_paise || 0),
    daily,
    categories,
    payments,
    cashflow,
    category_budgets: categoryBudgets.map((x) => ({
      ...x,
      remaining_paise: nonNegative(
        Number(x.limit_paise) - Number(x.spent_paise),
      ),
    })),
  });
}

async function handleBootstrap(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return bad("Method not allowed", 405);
  const results = await env.DB.batch([
    env.DB.prepare("SELECT key,value FROM settings ORDER BY key"),
    env.DB.prepare(
      "SELECT id,name,icon,color,enabled FROM categories ORDER BY enabled DESC,name",
    ),
    env.DB.prepare(
      "SELECT id,name,enabled FROM payment_methods ORDER BY enabled DESC,name",
    ),
    env.DB.prepare(
      "SELECT id,name,enabled FROM accounts ORDER BY enabled DESC,name",
    ),
    env.DB.prepare(
      "SELECT COALESCE(MAX(version),0) version FROM schema_version",
    ),
  ]);
  const settings = Object.fromEntries(
    (results[0]?.results || []).map((x: any) => [x.key, x.value]),
  );
  const normalize = (items: any[]) =>
    items.map((x) => ({ ...x, enabled: !!x.enabled }));
  return json({
    version: APP_VERSION,
    schema_version: Number((results[4]?.results?.[0] as any)?.version || 0),
    mode: "cloud",
    settings,
    categories: normalize(results[1]?.results || []),
    payments: normalize(results[2]?.results || []),
    accounts: normalize(results[3]?.results || []),
  });
}

async function handleSettings(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT key,value FROM settings",
    ).all<any>();
    return json(
      Object.fromEntries(result.results.map((x: any) => [x.key, x.value])),
    );
  }
  if (request.method !== "PUT") return bad("Method not allowed", 405);
  const payload: any = await readJSON(request);
  const allowed = new Set(["start_page", "theme", "compact_rows"]);
  const statements = [];
  for (const [key, value] of Object.entries(payload)) {
    if (!allowed.has(key)) return bad(`Unknown setting: ${key}`);
    statements.push(
      env.DB.prepare(
        "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP",
      ).bind(key, String(value)),
    );
  }
  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true });
}

async function handleFavorites(
  request: Request,
  env: Env,
  id?: number,
): Promise<Response> {
  if (id && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM favorites WHERE id=?").bind(id).run();
    return json({ ok: true });
  }
  if (!id && request.method === "GET") {
    const r = await env.DB.prepare(
      `SELECT f.id,f.description,f.amount_paise,f.category_id,COALESCE(c.name,'') category_name,f.payment_method_id,COALESCE(p.name,'') payment_name,f.account_id,COALESCE(a.name,'') account_name FROM favorites f LEFT JOIN categories c ON c.id=f.category_id LEFT JOIN payment_methods p ON p.id=f.payment_method_id LEFT JOIN accounts a ON a.id=f.account_id ORDER BY f.id DESC`,
    ).all();
    return json({ items: r.results });
  }
  if (!id && request.method === "POST") {
    const x: any = await readJSON(request);
    if (typeof x.description !== "string" || !x.description.trim())
      return bad("Invalid description");
    const r = await env.DB.prepare(
      "INSERT INTO favorites(description,amount_paise,category_id,payment_method_id,account_id) VALUES(?,?,?,?,?)",
    )
      .bind(
        x.description.trim(),
        x.amount_paise || null,
        x.category_id || null,
        x.payment_method_id || null,
        x.account_id || null,
      )
      .run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  return bad("Method not allowed", 405);
}

async function handleRules(
  request: Request,
  env: Env,
  id?: number,
): Promise<Response> {
  if (!id && request.method === "GET") {
    const r = await env.DB.prepare(
      "SELECT r.*,c.name category_name FROM categorization_rules r JOIN categories c ON c.id=r.category_id ORDER BY priority,id",
    ).all();
    return json({
      items: r.results.map((x: any) => ({ ...x, enabled: !!x.enabled })),
    });
  }
  const x: any =
    request.method === "POST" || request.method === "PUT"
      ? await readJSON(request)
      : null;
  if (!id && request.method === "POST") {
    if (!x.keyword?.trim() && !x.merchant?.trim())
      return bad("Keyword or merchant is required");
    const r = await env.DB.prepare(
      "INSERT INTO categorization_rules(keyword,merchant,category_id,priority,enabled) VALUES(?,?,?,?,?)",
    )
      .bind(
        (x.keyword || "").trim(),
        (x.merchant || "").trim(),
        x.category_id,
        x.priority || 100,
        x.enabled === false ? 0 : 1,
      )
      .run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  if (id && request.method === "PUT") {
    await env.DB.prepare(
      "UPDATE categorization_rules SET keyword=?,merchant=?,category_id=?,priority=?,enabled=? WHERE id=?",
    )
      .bind(
        (x.keyword || "").trim(),
        (x.merchant || "").trim(),
        x.category_id,
        x.priority || 100,
        x.enabled === false ? 0 : 1,
        id,
      )
      .run();
    return json({ ok: true });
  }
  if (id && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM categorization_rules WHERE id=?")
      .bind(id)
      .run();
    return json({ ok: true });
  }
  return bad("Method not allowed", 405);
}

function clampedDate(year: number, month: number, day: number): Date {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(Math.max(day, 1), last)));
}

function nextRecurringDate(
  current: string,
  frequency: string,
  anchor: number,
): string {
  const d = new Date(`${current}T00:00:00Z`);
  if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === "yearly")
    return clampedDate(
      d.getUTCFullYear() + 1,
      d.getUTCMonth(),
      anchor || d.getUTCDate(),
    )
      .toISOString()
      .slice(0, 10);
  else
    return clampedDate(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      anchor || d.getUTCDate(),
    )
      .toISOString()
      .slice(0, 10);
  return d.toISOString().slice(0, 10);
}

async function handleRecurring(
  request: Request,
  env: Env,
  id?: number,
): Promise<Response> {
  if (!id && request.method === "GET") {
    const r = await env.DB.prepare(
      `SELECT r.*,c.name category_name,p.name payment_name,COALESCE(a.name,'') account_name FROM recurring_expenses r JOIN categories c ON c.id=r.category_id JOIN payment_methods p ON p.id=r.payment_method_id LEFT JOIN accounts a ON a.id=r.account_id ORDER BY r.enabled DESC,r.next_date`,
    ).all();
    return json({
      items: r.results.map((x: any) => ({ ...x, enabled: !!x.enabled })),
    });
  }
  const x: any =
    request.method === "POST" || request.method === "PUT"
      ? await readJSON(request)
      : null;
  if (
    (request.method === "POST" || request.method === "PUT") &&
    (!x.description?.trim() ||
      !Number.isInteger(x.amount_paise) ||
      x.amount_paise <= 0 ||
      !["weekly", "monthly", "yearly"].includes(x.frequency) ||
      !validDate(x.next_date))
  )
    return bad("Invalid recurring expense");
  const anchor = x
    ? Number(x.anchor_day || new Date(`${x.next_date}T00:00:00Z`).getUTCDate())
    : 0;
  if (!id && request.method === "POST") {
    const r = await env.DB.prepare(
      "INSERT INTO recurring_expenses(description,amount_paise,category_id,payment_method_id,account_id,frequency,anchor_day,next_date,enabled) VALUES(?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        x.description.trim(),
        x.amount_paise,
        x.category_id,
        x.payment_method_id,
        x.account_id || null,
        x.frequency,
        anchor,
        x.next_date,
        x.enabled === false ? 0 : 1,
      )
      .run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  if (id && request.method === "PUT") {
    await env.DB.prepare(
      "UPDATE recurring_expenses SET description=?,amount_paise=?,category_id=?,payment_method_id=?,account_id=?,frequency=?,anchor_day=?,next_date=?,enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(
        x.description.trim(),
        x.amount_paise,
        x.category_id,
        x.payment_method_id,
        x.account_id || null,
        x.frequency,
        anchor,
        x.next_date,
        x.enabled === false ? 0 : 1,
        id,
      )
      .run();
    return json({ ok: true });
  }
  if (id && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM recurring_expenses WHERE id=?")
      .bind(id)
      .run();
    return json({ ok: true });
  }
  return bad("Method not allowed", 405);
}

async function processRecurring(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return bad("Method not allowed", 405);
  const x = await readJSON<{ until: string }>(request);
  const until = validDate(x.until)
    ? x.until
    : new Date().toISOString().slice(0, 10);
  const due = await env.DB.prepare(
    "SELECT * FROM recurring_expenses WHERE enabled=1 AND next_date<=? ORDER BY next_date",
  )
    .bind(until)
    .all<any>();
  let created = 0;
  for (const r of due.results) {
    let date = String(r.next_date);
    while (date <= until) {
      const tx = {
        amount_paise: Number(r.amount_paise),
        description: r.description,
        category_id: Number(r.category_id),
        payment_method_id: Number(r.payment_method_id),
        account_id: r.account_id ? Number(r.account_id) : null,
        transaction_date: date,
        notes: "",
        raw_input: `recurring:${r.id}`,
        source: "recurring",
      };
      try {
        await createTransaction(env, tx, false);
        created++;
      } catch (e: any) {
        if (e.status !== 409) throw e;
      }
      date = nextRecurringDate(date, r.frequency, Number(r.anchor_day));
    }
    await env.DB.prepare(
      "UPDATE recurring_expenses SET next_date=?,last_generated_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(date, until, r.id)
      .run();
  }
  return json({ created });
}

async function handlePending(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const r = await env.DB.prepare(
      "SELECT * FROM pending_entries WHERE status<>'SAVED' ORDER BY id DESC LIMIT 200",
    ).all<any>();
    return json({
      items: r.results.map((x: any) => ({
        ...x,
        payload: JSON.parse(x.payload_json || "{}"),
      })),
    });
  }
  if (request.method !== "PUT") return bad("Method not allowed", 405);
  const x: any = await readJSON(request);
  if (!["RAW", "PARSED", "REVIEW_NEEDED", "SAVED"].includes(x.status))
    return bad("Invalid pending entry");
  const payload = JSON.stringify(x.payload ?? {});
  if (x.id) {
    await env.DB.prepare(
      "UPDATE pending_entries SET status=?,raw_input=?,payload_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(x.status, x.raw_input || "", payload, x.id)
      .run();
    return json({ id: x.id });
  }
  const r = await env.DB.prepare(
    "INSERT INTO pending_entries(status,raw_input,payload_json) VALUES(?,?,?)",
  )
    .bind(x.status, x.raw_input || "", payload)
    .run();
  return json({ id: r.meta.last_row_id }, 201);
}

async function handleExport(env: Env): Promise<Response> {
  const r = await env.DB.prepare(
    `SELECT t.transaction_date,t.amount_paise,t.description,c.name category,p.name payment,COALESCE(a.name,'') account,t.notes FROM transactions t JOIN categories c ON c.id=t.category_id JOIN payment_methods p ON p.id=t.payment_method_id LEFT JOIN accounts a ON a.id=t.account_id ORDER BY t.transaction_date,t.id`,
  ).all<any>();
  const lines = ["Date,Amount,Description,Category,Payment,Account,Notes"];
  for (const x of r.results)
    lines.push(
      [
        x.transaction_date,
        formatPaise(Number(x.amount_paise)),
        x.description,
        x.category,
        x.payment,
        x.account,
        x.notes,
      ]
        .map((v: any) => csvSafe(String(v ?? "")))
        .join(","),
    );
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": 'attachment; filename="expenseflow.csv"',
    },
  });
}

async function handleImport(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return bad("Method not allowed", 405);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return bad("CSV file is required");
  if (file.size > 2_097_152) return bad("Import file is too large", 413);
  const rows = parseCSV(await file.text());
  if (rows.length < 2) return bad("CSV has no data");
  const header = new Map(rows[0].map((v, i) => [norm(v), i]));
  for (const col of ["date", "amount", "description", "category", "payment"])
    if (!header.has(col)) return bad(`Missing CSV column: ${col}`);
  const [cats, pays, accounts] = await Promise.all([
    lookupMap(env, "categories"),
    lookupMap(env, "payment_methods"),
    lookupMap(env, "accounts"),
  ]);
  const other = cats.get("other") || 0,
    cash = pays.get("cash") || 0,
    defaultAcct = accounts.get("cash") || null;
  const items: any[] = [],
    warnings: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i],
      get = (name: string) => String(row[header.get(name)!] ?? "").trim(),
      amount = parsePaise(get("amount")),
      date = get("date");
    if (!amount) {
      warnings.push(`Row ${i + 1} invalid amount`);
      continue;
    }
    if (!validDate(date)) {
      warnings.push(`Row ${i + 1} invalid date`);
      continue;
    }
    let cat = cats.get(norm(get("category"))) || other;
    if (!cats.get(norm(get("category"))))
      warnings.push(`Row ${i + 1} unknown category; set to Other`);
    let pay = pays.get(paymentAlias(get("payment"))) || cash;
    if (!pays.get(paymentAlias(get("payment"))))
      warnings.push(`Row ${i + 1} unknown payment; set to Cash`);
    const acct = accounts.get(norm(get("account"))) || defaultAcct;
    items.push({
      amount_paise: amount,
      description: get("description"),
      category_id: cat,
      payment_method_id: pay,
      account_id: acct,
      transaction_date: date,
      notes: get("notes"),
      raw_input: row.join(","),
      source: "csv",
    });
  }
  return json({ items, warnings, preview_only: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const loginPage =
        url.pathname === "/login" || url.pathname === "/login.html";
      if (
        (url.pathname.startsWith("/api/") || loginPage) &&
        isMutation(request) &&
        !sameOrigin(request)
      ) {
        return secure(bad("Cross-site request rejected", 403));
      }

      if (url.pathname === "/api/health") {
        return secure(
          json({
            ok: true,
            database: true,
            version: APP_VERSION,
            mode: "cloud",
            auth_configured: authConfigured(env),
          }),
        );
      }
      if (url.pathname === "/api/auth/status")
        return secure(await authStatus(request, env));
      if (url.pathname === "/api/auth/login")
        return secure(await login(request, env));
      if (url.pathname === "/api/auth/logout") return secure(logout(request));

      const ready = authConfigured(env);
      const authenticated = ready && (await isAuthenticated(request, env));

      if (loginPage) {
        if (authenticated)
          return secure(
            Response.redirect(new URL("/", request.url).toString(), 302),
          );
        const loginURL = new URL("/login.html", request.url);
        const response = await env.ASSETS.fetch(new Request(loginURL, request));
        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "no-store");
        return secure(
          new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          }),
        );
      }

      if (!ready) {
        if (url.pathname.startsWith("/api/"))
          return secure(
            json(
              {
                error: "Authentication is not configured",
                code: "AUTH_NOT_CONFIGURED",
              },
              503,
            ),
          );
        return secure(
          Response.redirect(new URL("/login", request.url).toString(), 302),
        );
      }
      if (!authenticated) {
        if (url.pathname.startsWith("/api/")) return secure(authRequired());
        return secure(
          Response.redirect(new URL("/login", request.url).toString(), 302),
        );
      }

      let response: Response;
      if (url.pathname === "/api/bootstrap")
        response = await handleBootstrap(request, env);
      else if (url.pathname === "/api/parse")
        response = await handleParse(request, env);
      else if (url.pathname === "/api/transactions/bulk")
        response = await handleBulk(request, env);
      else if (url.pathname === "/api/transactions/bulk-delete")
        response = await handleBulkDelete(request, env);
      else if (url.pathname === "/api/transactions")
        response = await handleTransactions(request, env, url);
      else if (/^\/api\/transactions\/\d+$/.test(url.pathname))
        response = await handleTransactionByID(
          request,
          env,
          Number(url.pathname.split("/").pop()),
        );
      else if (url.pathname === "/api/stats")
        response = await handleStats(env, url);
      else if (url.pathname === "/api/income")
        response = await handleIncome(request, env, url);
      else if (/^\/api\/income\/\d+$/.test(url.pathname))
        response = await handleIncome(
          request,
          env,
          url,
          Number(url.pathname.split("/").pop()),
        );
      else if (url.pathname === "/api/budget")
        response = await handleBudget(request, env, url);
      else if (url.pathname === "/api/settings")
        response = await handleSettings(request, env);
      else if (url.pathname === "/api/favorites")
        response = await handleFavorites(request, env);
      else if (/^\/api\/favorites\/\d+$/.test(url.pathname))
        response = await handleFavorites(
          request,
          env,
          Number(url.pathname.split("/").pop()),
        );
      else if (url.pathname === "/api/rules")
        response = await handleRules(request, env);
      else if (/^\/api\/rules\/\d+$/.test(url.pathname))
        response = await handleRules(
          request,
          env,
          Number(url.pathname.split("/").pop()),
        );
      else if (url.pathname === "/api/recurring/process")
        response = await processRecurring(request, env);
      else if (url.pathname === "/api/recurring")
        response = await handleRecurring(request, env);
      else if (/^\/api\/recurring\/\d+$/.test(url.pathname))
        response = await handleRecurring(
          request,
          env,
          Number(url.pathname.split("/").pop()),
        );
      else if (url.pathname === "/api/pending")
        response = await handlePending(request, env);
      else if (url.pathname === "/api/export" && request.method === "GET")
        response = await handleExport(env);
      else if (url.pathname === "/api/import")
        response = await handleImport(request, env);
      else if (url.pathname.startsWith("/api/ai/"))
        response = bad("AI is local-only in this release", 404);
      else {
        const match = url.pathname.match(
          /^\/api\/(categories|payment-methods|accounts)(?:\/(\d+))?$/,
        );
        if (match) {
          const table =
            match[1] === "payment-methods" ? "payment_methods" : match[1];
          response = await handleLookups(
            request,
            env,
            table,
            match[2] ? Number(match[2]) : undefined,
          );
        } else if (url.pathname.startsWith("/api/"))
          response = bad("Not found", 404);
        else response = await env.ASSETS.fetch(request);
      }
      return secure(response);
    } catch (error: any) {
      return secure(
        bad(error?.message || "Unexpected server error", error?.status || 500),
      );
    }
  },
};
