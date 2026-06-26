import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, { Env } from "../index";

const env: Env = {
  ALLOWED_ORIGIN: "http://localhost:5173",
  MINDSOLO_API_BASE: "https://api.example.test/api",
  SESSION_SECRET: "test-secret-with-enough-entropy",
};

const originHeaders = { origin: "http://localhost:5173" };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("worker API", () => {
  it("validates a token and sets an encrypted session cookie", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ id: 1 })),
    );

    const response = await worker.fetch(
      new Request("https://worker.test/api/session", {
        method: "POST",
        headers: { ...originHeaders, "content-type": "application/json" },
        body: JSON.stringify({ accessToken: "token-123" }),
      }),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("dvpi_session=");
    expect(response.headers.get("access-control-allow-origin")).toBe(originHeaders.origin);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/api/profile",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "token-123" }),
      }),
    );
  });

  it("proxies authenticated device lookups", async () => {
    const cookie = await createSessionCookie();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ name: "X40" })));

    const response = await worker.fetch(
      new Request("https://worker.test/api/device?appName=dreamehome&deviceId=107265", {
        headers: { ...originHeaders, cookie },
      }),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "X40" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/api/dreamehome/device/107265",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "token-123" }),
      }),
    );
  });

  it("uploads a voice file and sends an install command", async () => {
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ voicepack_settings: { upload_file_naming: "x40-pack" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ payload: { url: "https://cdn/file.pkg", md5: "abc", size: 12 } }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    const cookie = await createSessionCookie();
    vi.stubGlobal("fetch", upstream);
    const body = new FormData();
    body.set("appName", "dreamehome");
    body.set("deviceId", "107265");
    body.set("file", new File(["voice"], "voice.pkg"));

    const response = await worker.fetch(
      new Request("https://worker.test/api/voice/install", {
        method: "POST",
        headers: { ...originHeaders, cookie },
        body,
      }),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(upstream).toHaveBeenNthCalledWith(
      2,
      "https://api.example.test/api/tempfile/upload/x40-pack",
      expect.objectContaining({ method: "POST" }),
    );
    expect(upstream).toHaveBeenNthCalledWith(
      3,
      "https://api.example.test/api/projects/install_command",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          device_id: "107265",
          app_name: "dreamehome",
          upload_voice: true,
          file_url: "https://cdn/file.pkg",
          file_size: 12,
          file_md5: "abc",
        }),
      }),
    );
  });
});

async function createSessionCookie() {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: 1 })));
  const response = await worker.fetch(
    new Request("https://worker.test/api/session", {
      method: "POST",
      headers: { ...originHeaders, "content-type": "application/json" },
      body: JSON.stringify({ accessToken: "token-123" }),
    }),
    env,
    {} as ExecutionContext,
  );
  return response.headers.get("set-cookie")!.split(";")[0];
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

