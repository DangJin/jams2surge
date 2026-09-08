import { createSubscriptionHandler } from "../src/service/subscription-handler";

const handler = createSubscriptionHandler();

export default {
  fetch(request: Request): Promise<Response> {
    return handler(request);
  },
};
