import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { EXPECTED_ALIBABA_DIRECT_DOMAINS } from "./fixtures/company-direct-domains";

describe("hosted Alibaba domain set", () => {
  it("keeps the legacy URL compatible for previously imported profiles", async () => {
    const contents = await readFile(
      resolve(process.cwd(), "public/alibaba-domains.list"),
      "utf8",
    );

    expect(contents).toBe(
      `${EXPECTED_ALIBABA_DIRECT_DOMAINS.map((domain) => `.${domain}`).join("\n")}\n`,
    );
  });
});
