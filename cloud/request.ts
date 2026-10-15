const API_LIMIT = 1_048_576;

// Count actual bytes as they arrive, including requests with chunked bodies or
// missing/incorrect Content-Length headers. Stop before buffering a large body.
export async function readJSON<T = any>(request: Request): Promise<T> {
  const tooLarge = () => Object.assign(new Error('Request too large'), { status: 413 });
  if (Number(request.headers.get('content-length') || 0) > API_LIMIT) throw tooLarge();
  if (!request.body) throw Object.assign(new Error('Invalid JSON request'), { status: 400 });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > API_LIMIT) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
    return value as T;
  } catch {
    throw Object.assign(new Error('Invalid JSON request'), { status: 400 });
  }
}
