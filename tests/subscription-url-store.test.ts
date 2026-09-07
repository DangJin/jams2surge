import { describe, expect, it } from "vitest";

import {
  createSubscriptionUrlStore,
  type SubscriptionUrlStorage,
} from "../src/subscription/subscription-url-store";

function createMemoryStorage(initialValue?: string): {
  storage: SubscriptionUrlStorage;
  read: () => string | undefined;
} {
  let value = initialValue;
  return {
    storage: {
      async getItem() {
        return value;
      },
      async setItem(_key, nextValue) {
        value = nextValue;
      },
      async removeItem() {
        value = undefined;
      },
    },
    read: () => value,
  };
}

describe("subscriptionUrlStore", () => {
  it("loads the most recently saved HTTP subscription URL", async () => {
    const memory = createMemoryStorage("https://example.com/sub?token=private");
    const store = createSubscriptionUrlStore(memory.storage);

    await expect(store.load()).resolves.toBe(
      "https://example.com/sub?token=private",
    );
  });

  it("trims the URL before replacing the previously saved value", async () => {
    const memory = createMemoryStorage("https://old.example/sub");
    const store = createSubscriptionUrlStore(memory.storage);

    await store.save("  https://new.example/sub  ");

    expect(memory.read()).toBe("https://new.example/sub");
  });

  it("removes a cached value that is no longer a valid HTTP URL", async () => {
    const memory = createMemoryStorage("file:///private/subscription");
    const store = createSubscriptionUrlStore(memory.storage);

    await expect(store.load()).resolves.toBeUndefined();
    expect(memory.read()).toBeUndefined();
  });

  it("clears the saved URL", async () => {
    const memory = createMemoryStorage("https://example.com/sub");
    const store = createSubscriptionUrlStore(memory.storage);

    await store.clear();

    expect(memory.read()).toBeUndefined();
  });
});
