import type { Env } from "./db";
import { json } from "./db";

const COOKIE_NAME = "__Host-expenseflow_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const PASSWORD_MAX = 256;

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

function cookieValue(request: Request, name: string): string {
  const cookies = request.headers.get("Cookie") || "";
  for (const item of cookies.split(";")) {
    const index = item.indexOf("=");
    if (index < 0) continue;
    if (item.slice(0, index).trim() === name)
      return item.slice(index + 1).trim();
  }
  return "";
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(value),
  );
  return new Uint8Array(signature);
}

function configured(env: Env): boolean {
  return Boolean(
    env.AUTH_PASSWORD_VERIFIER?.trim() &&
    env.AUTH_PASSWORD_PEPPER?.trim() &&
    env.SESSION_SECRET?.trim(),
  );
}

function passwordVerifierValid(value: string): boolean {
  try {
    return base64UrlToBytes(value).length === 32;
  } catch {
    return false;
  }
}

async function verifyPassword(
  password: string,
  verifier: string,
  pepper: string,
): Promise<boolean> {
  try {
    const expected = base64UrlToBytes(verifier);
    const key = await hmacKey(pepper);
    return await crypto.subtle.verify(
      "HMAC",
      key,
      expected as BufferSource,
      encoder.encode(password),
    );
  } catch {
    return false;
  }
}

async function createSession(secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = bytesToBase64Url(
    encoder.encode(
      JSON.stringify({ v: 1, iat: now, exp: now + SESSION_SECONDS, nonce }),
    ),
  );
  const signature = bytesToBase64Url(await hmac(secret, payload));
  return `${payload}.${signature}`;
}

async function validSession(token: string, secret: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  try {
    const expected = base64UrlToBytes(parts[1]);
    const key = await hmacKey(secret);
    const verified = await crypto.subtle.verify(
      "HMAC",
      key,
      expected as BufferSource,
      encoder.encode(parts[0]),
    );
    if (!verified) return false;
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(parts[0])),
    );
    const now = Math.floor(Date.now() / 1000);
    return (
      payload?.v === 1 &&
      Number.isInteger(payload.iat) &&
      Number.isInteger(payload.exp) &&
      payload.iat <= now + 60 &&
      payload.exp > now &&
      payload.exp - payload.iat <= SESSION_SECONDS + 60
    );
  } catch {
    return false;
  }
}

async function attemptKey(request: Request, secret: string): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = await hmac(secret, `login:${ip}`);
  return bytesToBase64Url(digest);
}

async function loginBlocked(
  request: Request,
  env: Env,
): Promise<{ blocked: boolean; retryAfter: number; key: string }> {
  const key = await attemptKey(request, env.SESSION_SECRET!);
  const row = await env.DB.prepare(
    "SELECT locked_until FROM auth_login_attempts WHERE key=?",
  )
    .bind(key)
    .first<any>();
  if (!row) return { blocked: false, retryAfter: 0, key };
  const lockedUntil = row.locked_until
    ? Date.parse(String(row.locked_until))
    : 0;
  const now = Date.now();
  if (lockedUntil > now)
    return {
      blocked: true,
      retryAfter: Math.max(1, Math.ceil((lockedUntil - now) / 1000)),
      key,
    };
  return { blocked: false, retryAfter: 0, key };
}

async function recordFailure(
  key: string,
  env: Env,
): Promise<{ locked: boolean; retryAfter: number }> {
  const now = Date.now();
  const row = await env.DB.prepare(
    "SELECT failures,window_started FROM auth_login_attempts WHERE key=?",
  )
    .bind(key)
    .first<any>();
  const windowStarted = row?.window_started
    ? Date.parse(String(row.window_started))
    : 0;
  const withinWindow =
    windowStarted > 0 && now - windowStarted <= LOGIN_WINDOW_MS;
  const failures = withinWindow ? Number(row?.failures || 0) + 1 : 1;
  const started = new Date(withinWindow ? windowStarted : now).toISOString();
  const lockedUntil =
    failures >= MAX_FAILURES ? new Date(now + LOCKOUT_MS).toISOString() : null;
  await env.DB.batch([
    env.DB.prepare(
      `
      INSERT INTO auth_login_attempts(key,failures,window_started,locked_until,updated_at)
      VALUES(?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        failures=excluded.failures,
        window_started=excluded.window_started,
        locked_until=excluded.locked_until,
        updated_at=CURRENT_TIMESTAMP
    `,
    ).bind(key, failures, started, lockedUntil),
    env.DB.prepare(
      "DELETE FROM auth_login_attempts WHERE updated_at < datetime('now','-7 days')",
    ),
    env.DB.prepare(
      "DELETE FROM auth_login_attempts WHERE key NOT IN (SELECT key FROM auth_login_attempts ORDER BY updated_at DESC LIMIT 5000)",
    ),
  ]);
  return {
    locked: Boolean(lockedUntil),
    retryAfter: lockedUntil ? Math.ceil(LOCKOUT_MS / 1000) : 0,
  };
}

async function clearFailures(key: string, env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_login_attempts WHERE key=?").bind(key),
    env.DB.prepare(
      "DELETE FROM auth_login_attempts WHERE updated_at < datetime('now','-7 days')",
    ),
  ]);
}

function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

function expiredSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function authConfigured(env: Env): boolean {
  return (
    configured(env) &&
    passwordVerifierValid(env.AUTH_PASSWORD_VERIFIER!) &&
    (env.AUTH_PASSWORD_PEPPER?.length || 0) >= 32 &&
    (env.SESSION_SECRET?.length || 0) >= 32
  );
}

export async function isAuthenticated(
  request: Request,
  env: Env,
): Promise<boolean> {
  if (!authConfigured(env)) return false;
  const token = cookieValue(request, COOKIE_NAME);
  return Boolean(token && (await validSession(token, env.SESSION_SECRET!)));
}

export async function authStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  const ready = authConfigured(env);
  return json({
    configured: ready,
    authenticated: ready ? await isAuthenticated(request, env) : false,
  });
}

export async function login(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  if (!authConfigured(env))
    return json(
      {
        error: "Authentication is not configured",
        code: "AUTH_NOT_CONFIGURED",
      },
      503,
    );

  let blocked;
  try {
    blocked = await loginBlocked(request, env);
  } catch {
    return json(
      {
        error: "Authentication setup is incomplete. Apply the D1 migrations.",
        code: "AUTH_MIGRATION_REQUIRED",
      },
      503,
    );
  }
  if (blocked.blocked) {
    const response = json(
      {
        error: "Too many failed attempts. Try again later.",
        code: "AUTH_RATE_LIMITED",
      },
      429,
    );
    response.headers.set("Retry-After", String(blocked.retryAfter));
    return response;
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 2048) return json({ error: "Request too large" }, 413);
  let body: any;
  try {
    const text = await request.text();
    if (text.length > 2048) return json({ error: "Request too large" }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || password.length > PASSWORD_MAX)
    return json({ error: "Incorrect password", code: "AUTH_INVALID" }, 401);

  if (
    !(await verifyPassword(
      password,
      env.AUTH_PASSWORD_VERIFIER!,
      env.AUTH_PASSWORD_PEPPER!,
    ))
  ) {
    let failure;
    try {
      failure = await recordFailure(blocked.key, env);
    } catch {
      return json(
        {
          error: "Authentication setup is incomplete. Apply the D1 migrations.",
          code: "AUTH_MIGRATION_REQUIRED",
        },
        503,
      );
    }
    const response = json(
      {
        error: failure.locked
          ? "Too many failed attempts. Try again later."
          : "Incorrect password",
        code: failure.locked ? "AUTH_RATE_LIMITED" : "AUTH_INVALID",
      },
      failure.locked ? 429 : 401,
    );
    if (failure.retryAfter)
      response.headers.set("Retry-After", String(failure.retryAfter));
    return response;
  }

  try {
    await clearFailures(blocked.key, env);
  } catch {
    return json(
      {
        error: "Authentication setup is incomplete. Apply the D1 migrations.",
        code: "AUTH_MIGRATION_REQUIRED",
      },
      503,
    );
  }
  const response = json({ ok: true });
  response.headers.set(
    "Set-Cookie",
    sessionCookie(await createSession(env.SESSION_SECRET!)),
  );
  return response;
}

export function logout(request: Request): Response {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  const response = json({ ok: true });
  response.headers.set("Set-Cookie", expiredSessionCookie());
  return response;
}

export function authRequired(): Response {
  return json({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);
}
