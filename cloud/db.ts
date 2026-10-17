export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AUTH_PASSWORD_VERIFIER?: string;
  AUTH_PASSWORD_PEPPER?: string;
  SESSION_SECRET?: string;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export const bad = (message: string, status = 400) =>
  json({ error: message }, status);
export const norm = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function fingerprint(input: {
  transaction_date: string;
  amount_paise: number;
  description?: string;
  payment_method_id: number;
  account_id?: number | null;
}): Promise<string> {
  return sha256(
    `${input.transaction_date}|${input.amount_paise}|${norm(input.description || "")}|${input.payment_method_id}|${input.account_id || 0}`,
  );
}

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
