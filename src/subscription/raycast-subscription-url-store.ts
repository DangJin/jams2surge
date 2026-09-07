import { LocalStorage } from "@raycast/api";

import {
  createSubscriptionUrlStore,
  type SubscriptionUrlStorage,
} from "./subscription-url-store";

const raycastStorage: SubscriptionUrlStorage = {
  getItem: (key) => LocalStorage.getItem<string>(key),
  setItem: (key, value) => LocalStorage.setItem(key, value),
  removeItem: (key) => LocalStorage.removeItem(key),
};

export const subscriptionUrlStore = createSubscriptionUrlStore(raycastStorage);
