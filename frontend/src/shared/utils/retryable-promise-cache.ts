export function retryableCachedPromise<Key, Value>(
  cache: Map<Key, Promise<Value>>,
  key: Key,
  load: () => Promise<Value>,
): Promise<Value> {
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = Promise.resolve().then(load).catch((error: unknown) => {
    if (cache.get(key) === promise) cache.delete(key);
    throw error;
  });
  cache.set(key, promise);
  return promise;
}
