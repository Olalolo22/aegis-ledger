import { Redis } from "@upstash/redis";
import { randomUUID } from "crypto";

/**
 * Lazy singleton Upstash Redis client. Reads UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN from environment variables automatically.
 * Lazy initialization prevents build-time crashes during stuff like  static page generation.
 */
let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = Redis.fromEnv();
  }
  return _redis;
}

// ─── Distributed Mutex (SET NX) ─────────────────────────────────
// Used to protect UTXO selection in the Cloak shielded pool.
// Every API route that touches the pool MUST acquire this mutex
// before selecting UTXOs, preventing double-spend races.

const LOCK_PREFIX = "aegis:lock:";

export interface MutexHandle {
  acquired: boolean;
  lockValue: string;
  key: string;
}

/**
 * Attempts to acquire a distributed mutex using Redis SET NX with TTL.
 *
 * @param resource - Unique identifier for the resource to lock (e.g., "utxo-selection:{org_id}")
 * @param ttlSeconds - Lock TTL in seconds. Prevents deadlocks if the holder crashes.
 * @returns MutexHandle with `acquired: true` if the lock was obtained.
 */
export async function acquireMutex(
  resource: string,
  ttlSeconds: number = 10
): Promise<MutexHandle> {
  const redis = getRedis();
  const lockValue = randomUUID();
  const key = `${LOCK_PREFIX}${resource}`;
  const result = await redis.set(key, lockValue, { nx: true, ex: ttlSeconds });
  return { acquired: result === "OK", lockValue, key };
}

/**
 * Releases a distributed mutex. Uses an atomic Lua script to ensure
 * we only delete the key if its value matches our lockValue — preventing
 * accidental release of another caller's lock.
 *
 * @param key - The full Redis key (returned from acquireMutex)
 * @param lockValue - The UUID value set during acquisition
 */
export async function releaseMutex(
  key: string,
  lockValue: string
): Promise<void> {
  const redis = getRedis();
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  await redis.eval(script, [key], [lockValue]);
}
