const STORAGE_KEY = "latest-subscription-url";

export interface SubscriptionUrlStorage {
  getItem(key: string): Promise<string | undefined>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SubscriptionUrlStore {
  load(): Promise<string | undefined>;
  save(value: string): Promise<void>;
  clear(): Promise<void>;
}

function normalizeSubscriptionUrl(value: string): string | undefined {
  const normalized = value.trim();
  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:"
      ? normalized
      : undefined;
  } catch {
    return undefined;
  }
}

export function createSubscriptionUrlStore(
  storage: SubscriptionUrlStorage,
): SubscriptionUrlStore {
  return {
    async load() {
      const value = await storage.getItem(STORAGE_KEY);
      if (!value) return undefined;

      const normalized = normalizeSubscriptionUrl(value);
      if (!normalized) {
        await storage.removeItem(STORAGE_KEY);
        return undefined;
      }
      return normalized;
    },
    async save(value) {
      const normalized = normalizeSubscriptionUrl(value);
      if (!normalized) throw new Error("订阅地址无效");
      await storage.setItem(STORAGE_KEY, normalized);
    },
    async clear() {
      await storage.removeItem(STORAGE_KEY);
    },
  };
}
