import { afterEach, describe, expect, it, vi } from "vitest";
import * as https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { ClientRequest, IncomingMessage } from "node:http";
import {
  downloadPublicHttpsText,
  type RequestTransport,
  type TransportResponse,
} from "../src/service/safe-download";
import type { Resolver } from "../src/service/public-address";

// A hoisted module mock ensures the default-transport test cannot open sockets.
vi.mock("node:https", () => ({ request: vi.fn() }));

const publicAddress = { address: "93.184.216.34", family: 4 as const };
const resolver: Resolver = async () => [publicAddress];

function response(
  statusCode = 200,
  headers: TransportResponse["headers"] = {},
  chunks: Uint8Array[] = [Buffer.from("ss://fixture")],
): TransportResponse {
  return {
    statusCode,
    headers,
    body: (async function* () {
      yield* chunks;
    })(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("downloadPublicHttpsText", () => {
  it.each([
    { timeoutMs: 15_001 },
    { maxBytes: 4_194_305 },
    { maxRedirects: 4 },
  ])("rejects an override above the hard cap: %j", async (override) => {
    const lookup = vi.fn<Resolver>(resolver);
    const transport = vi.fn<RequestTransport>(async () => response());
    await expect(
      downloadPublicHttpsText("https://upstream.test/sub", {
        ...override,
        resolver: lookup,
        transport,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(lookup).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("downloads UTF-8 using validated addresses and only fixed headers", async () => {
    const resolvedHostnames: string[] = [];
    const transport = vi.fn<RequestTransport>(async () => response());
    expect(
      await downloadPublicHttpsText("https://upstream.test/sub?token=secret", {
        resolver: async (hostname) => {
          resolvedHostnames.push(hostname);
          return [publicAddress];
        },
        transport,
      }),
    ).toBe("ss://fixture");
    expect(resolvedHostnames).toEqual(["upstream.test"]);
    const [url, request] = transport.mock.calls[0];
    expect(url.hostname).toBe("upstream.test");
    expect(request.addresses).toEqual([publicAddress]);
    expect(request.headers).toEqual({
      accept: "text/plain,*/*;q=0.1",
      "user-agent": "jams2surge/1.0",
    });
    expect(request.headers).not.toHaveProperty("authorization");
    expect(request.headers).not.toHaveProperty("cookie");
  });

  it("validates and pins DNS again for each relative or cross-host redirect", async () => {
    const lookup = vi
      .fn<Resolver>()
      .mockResolvedValueOnce([publicAddress])
      .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }])
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]);
    const transport = vi
      .fn<RequestTransport>()
      .mockResolvedValueOnce(
        response(302, { location: "https://second.test/sub" }),
      )
      .mockResolvedValueOnce(response(307, { location: "/next" }))
      .mockResolvedValueOnce(response());
    await expect(
      downloadPublicHttpsText("https://first.test/sub", {
        resolver: lookup,
        transport,
      }),
    ).resolves.toBe("ss://fixture");
    expect(lookup.mock.calls).toEqual([
      ["first.test"],
      ["second.test"],
      ["second.test"],
    ]);
    expect(
      transport.mock.calls.map(([url, request]) => [
        url.href,
        request.addresses,
      ]),
    ).toEqual([
      ["https://first.test/sub", [publicAddress]],
      ["https://second.test/sub", [{ address: "1.1.1.1", family: 4 }]],
      ["https://second.test/next", [{ address: "8.8.8.8", family: 4 }]],
    ]);
    expect(
      transport.mock.calls.every(([, request]) => request.signal.aborted),
    ).toBe(true);
  });

  it.each([
    "http://second.test/sub",
    "https://127.0.0.1/sub",
    "https://user:secret@second.test/sub",
  ])("rejects unsafe redirect %s", async (location) => {
    const transport = vi.fn<RequestTransport>(async () =>
      response(302, { location }),
    );
    await expect(
      downloadPublicHttpsText("https://first.test/sub", {
        resolver,
        transport,
      }),
    ).rejects.toMatchObject({ code: "unsafe" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects a redirect whose fresh DNS lookup is private", async () => {
    const lookup = vi
      .fn<Resolver>()
      .mockResolvedValueOnce([publicAddress])
      .mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
    const transport = vi.fn<RequestTransport>(async () =>
      response(302, { location: "https://second.test/sub" }),
    );
    await expect(
      downloadPublicHttpsText("https://first.test/sub", {
        resolver: lookup,
        transport,
      }),
    ).rejects.toMatchObject({ code: "unsafe" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("permits three redirects and rejects the fourth", async () => {
    const transport = vi.fn<RequestTransport>(async () =>
      response(302, { location: "/next" }),
    );
    await expect(
      downloadPublicHttpsText("https://first.test/sub", {
        resolver,
        transport,
      }),
    ).rejects.toMatchObject({ code: "redirect" });
    expect(transport).toHaveBeenCalledTimes(4);
    transport
      .mockReset()
      .mockResolvedValueOnce(response(301, { location: "/1" }))
      .mockResolvedValueOnce(response(303, { location: "/2" }))
      .mockResolvedValueOnce(response(308, { location: "/3" }))
      .mockResolvedValueOnce(response());
    await expect(
      downloadPublicHttpsText("https://first.test/sub", {
        resolver,
        transport,
      }),
    ).resolves.toBe("ss://fixture");
  });

  it("rejects redirects without Location", async () => {
    await expect(
      downloadPublicHttpsText("https://first.test/sub", {
        resolver,
        transport: async () => response(302),
      }),
    ).rejects.toMatchObject({ code: "redirect" });
  });

  it("maps HTTP errors without disclosing the URL", async () => {
    const error = await downloadPublicHttpsText(
      "https://first.test/sub?token=secret",
      { resolver, transport: async () => response(404) },
    ).catch((error: unknown) => error);
    expect(error).toMatchObject({ name: "SafeDownloadError", code: "http" });
    expect(String(error)).not.toMatch(/first\.test|token|secret/);
  });

  it("rejects declared bodies over 4 MiB before reading them", async () => {
    const read = vi.fn();
    await expect(
      downloadPublicHttpsText("https://first.test/sub", {
        resolver,
        transport: async () => ({
          statusCode: 200,
          headers: { "content-length": "4194305" },
          body: (async function* () {
            read();
            yield Buffer.from("small");
          })(),
        }),
      }),
    ).rejects.toMatchObject({ code: "too-large" });
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects accumulated bytes over 4 MiB even if Content-Length lies", async () => {
    const transport: RequestTransport = async () =>
      response(200, { "content-length": "1" }, [
        Buffer.alloc(4 * 1024 * 1024, 97),
        Buffer.from("a"),
      ]);
    await expect(
      downloadPublicHttpsText("https://first.test/sub", {
        resolver,
        transport,
      }),
    ).rejects.toMatchObject({ code: "too-large" });
  });

  it("accepts exactly the byte limit and UTF-8 split across chunks", async () => {
    await expect(
      downloadPublicHttpsText("https://first.test/sub", {
        resolver,
        maxBytes: 3,
        transport: async () =>
          response(200, {}, [
            new Uint8Array([0xe4, 0xb8]),
            new Uint8Array([0xad]),
          ]),
      }),
    ).resolves.toBe("中");
  });

  it.each([
    [0xc3, 0x28],
    [0xe4, 0xb8],
  ])("rejects invalid or truncated UTF-8 %j", async (...bytes) => {
    await expect(
      downloadPublicHttpsText("https://first.test/sub", {
        resolver,
        transport: async () => response(200, {}, [new Uint8Array(bytes)]),
      }),
    ).rejects.toMatchObject({ code: "encoding" });
  });

  it.each(["dns", "headers", "body"])(
    "enforces the 15-second overall deadline while stalled at %s",
    async (stage) => {
      vi.useFakeTimers();
      const never = new Promise<never>(() => {});
      const transport = vi.fn<RequestTransport>(async () =>
        stage === "headers"
          ? never
          : {
              statusCode: 200,
              headers: {},
              body: (async function* () {
                await never;
                yield Buffer.from("late");
              })(),
            },
      );
      let settled = false;
      const result = downloadPublicHttpsText("https://first.test/sub", {
        resolver: stage === "dns" ? async () => never : resolver,
        transport,
      });
      void result.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      const assertion = expect(result).rejects.toMatchObject({
        code: "timeout",
      });
      await vi.advanceTimersByTimeAsync(14_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await assertion;
      if (stage !== "dns")
        expect(transport.mock.calls[0][1].signal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("uses one deadline across redirects", async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn<RequestTransport>()
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        return response(302, { location: "/next" });
      })
      .mockImplementationOnce(async () => new Promise(() => {}));
    const result = downloadPublicHttpsText("https://first.test/sub", {
      resolver,
      transport,
    });
    const assertion = expect(result).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each(["dns", "transport", "body"])(
    "redacts %s failure messages",
    async (stage) => {
      const fail = () => {
        throw new Error("https://private.test/sub?secret=hidden");
      };
      const error = await downloadPublicHttpsText("https://first.test/sub", {
        resolver: stage === "dns" ? async () => fail() : resolver,
        transport: async () =>
          stage === "transport"
            ? fail()
            : {
                statusCode: 200,
                headers: {},
                body: (async function* () {
                  fail();
                  yield Buffer.from("");
                })(),
              },
      }).catch((error: unknown) => error);
      expect(error).toMatchObject({ code: "network" });
      expect(String(error)).not.toMatch(/private|secret|hidden/);
      expect(error).not.toHaveProperty("cause");
    },
  );

  it("classifies malformed initial URLs without contacting transport", async () => {
    const transport = vi.fn<RequestTransport>();
    await expect(
      downloadPublicHttpsText("invalid", { resolver, transport }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("pins the real HTTPS request lookup while retaining hostname and TLS verification", async () => {
    const requestSpy = vi.mocked(https.request).mockImplementation(((
      _url: URL,
      _options: https.RequestOptions,
      callback: (response: IncomingMessage) => void,
    ) => {
      const body = Object.assign(Readable.from([Buffer.from("ss://fixture")]), {
        statusCode: 200,
        headers: {},
      }) as IncomingMessage;
      return Object.assign(new EventEmitter(), {
        end: () => callback(body),
      }) as ClientRequest;
    }) as typeof https.request);
    await expect(
      downloadPublicHttpsText("https://upstream.test/sub", { resolver }),
    ).resolves.toBe("ss://fixture");
    const [url, options] = requestSpy.mock.calls[0] as unknown as [
      URL,
      https.RequestOptions,
    ];
    expect(url.hostname).toBe("upstream.test");
    expect(options).toMatchObject({
      method: "GET",
      agent: false,
      rejectUnauthorized: true,
    });
    const lookup = options.lookup!;
    const single = vi.fn();
    lookup("upstream.test", { family: 0, hints: 0 }, single);
    await Promise.resolve();
    expect(single).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    const all = vi.fn();
    lookup("upstream.test", { family: 0, hints: 0, all: true }, all);
    await Promise.resolve();
    expect(all).toHaveBeenCalledWith(null, [publicAddress]);
    expect(options.signal?.aborted).toBe(true);
  });
});
