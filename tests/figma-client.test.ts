import { describe, it, expect } from "vitest";
import { FigmaClient } from "../src/figma-client.ts";

const TEST_TOKEN = process.env.FIGMA_TOKEN || "figd_test_token_placeholder";
const TEST_FILE_URL = process.env.FIGMA_FILE_URL || "";

describe("FigmaClient", () => {
  it("should initialize with token and base URL", () => {
    const client = new FigmaClient(TEST_TOKEN);
    expect(client).toBeDefined();
  });

  it("should cache responses", async () => {
    const client = new FigmaClient(TEST_TOKEN);
    let fetchCount = 0;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response(JSON.stringify({ data: "test" }), { status: 200 });
    };

    try {
      await client.request("/test");
      await client.request("/test");
      expect(fetchCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should throw on non-ok response", async () => {
    const client = new FigmaClient(TEST_TOKEN);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response("Not Found", { status: 404 });
    };

    try {
      await expect(client.request("/bad")).rejects.toThrow("Figma API 404");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should call onResponse callback", async () => {
    const client = new FigmaClient(TEST_TOKEN);
    let callbackCalled = false;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    client.onResponse = (path, params, data) => {
      callbackCalled = true;
      expect(path).toBe("/test");
    };

    try {
      await client.request("/test");
      expect(callbackCalled).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should skip cache for expired entries", async () => {
    const client = new FigmaClient(TEST_TOKEN);
    (client as any).cacheTTL = 0;
    let fetchCount = 0;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response(JSON.stringify({ n: fetchCount }), { status: 200 });
    };

    try {
      await client.request("/expire-test");
      await client.request("/expire-test");
      expect(fetchCount).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
