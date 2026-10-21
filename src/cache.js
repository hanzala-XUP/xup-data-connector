// Small in-memory cache: identical questions inside the TTL share one Shopify call,
// and concurrent identical calls share one in-flight request.
const entries = new Map();

export async function memo(key, ttlMs, fn) {
  const now = Date.now(), hit = entries.get(key);
  if (hit && hit.value !== undefined && now - hit.at < ttlMs) return hit.value;
  if (hit && hit.pending) return hit.pending;
  const pending = fn().then(value => { entries.set(key, { value, at: Date.now() }); return value; },
    err => { entries.delete(key); throw err; });
  entries.set(key, { ...(hit || {}), pending });
  return pending;
}

export function clearCache() { entries.clear(); }
