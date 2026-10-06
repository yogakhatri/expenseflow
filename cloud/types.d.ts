interface D1ResultMeta { last_row_id?: number; changes?: number }
interface D1Result<T=unknown> { results: T[]; meta: D1ResultMeta }
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T=unknown>(): Promise<T|null>;
  all<T=unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
interface Fetcher { fetch(input: Request|string, init?: RequestInit): Promise<Response> }
