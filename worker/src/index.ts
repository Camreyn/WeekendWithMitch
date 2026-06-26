export interface Env {
  MINDSOLO_API_BASE?: string;
  MINSOLO_API_BASE?: string;
  ALLOWED_ORIGIN: string;
  SESSION_SECRET: string;
}

type SessionPayload = {
  token: string;
  createdAt: number;
};

type DeviceCandidate = {
  id: string;
  app: string;
  name?: string;
  model?: string;
  country?: string;
  source: string;
};

const COOKIE_NAME = "dvpi_session";
const DEFAULT_API_BASE = "https://api-vacuum.mindsolo.net/api";

const worker: ExportedHandler<Env> = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), request, env);
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === "/api/session" && request.method === "POST") {
        return withCors(await createSession(request, env), request, env);
      }

      if (url.pathname === "/api/session" && request.method === "DELETE") {
        return withCors(clearSession(), request, env);
      }

      if (url.pathname === "/api/device" && request.method === "GET") {
        return withCors(await getDevice(request, env), request, env);
      }

      if (url.pathname === "/api/devices" && request.method === "GET") {
        return withCors(await listDevices(request, env), request, env);
      }

      if (url.pathname === "/api/voice/install" && request.method === "POST") {
        return withCors(await installVoicePack(request, env), request, env);
      }

      return withCors(json({ message: "Not found" }, 404), request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return withCors(json({ message: error.message }, error.status), request, env);
      }
      const message = error instanceof Error ? error.message : "Unexpected error";
      return withCors(json({ message }, 500), request, env);
    }
  },
};

export default worker;

async function createSession(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ accessToken?: string }>().catch(() => null);
  const accessToken = body?.accessToken?.trim();

  if (!accessToken) {
    return json({ message: "Access token is required." }, 400);
  }

  const profileResponse = await upstreamFetch(env, "/profile", {
    headers: upstreamHeaders(accessToken),
  });

  if (!profileResponse.ok) {
    return json(
      { message: "The access token was rejected by the Mindsolo-compatible API." },
      profileResponse.status === 401 ? 401 : 400,
    );
  }

  const cookieValue = await sealSession(
    { token: accessToken, createdAt: Date.now() },
    env.SESSION_SECRET,
  );

  const response = json({ ok: true });
  response.headers.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=604800`,
  );
  return response;
}

function clearSession(): Response {
  const response = json({ ok: true });
  response.headers.append(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`,
  );
  return response;
}

async function getDevice(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env);
  const url = new URL(request.url);
  const appName = requiredParam(url, "appName");
  const deviceId = requiredParam(url, "deviceId");

  const upstream = await upstreamFetch(env, `/${appName}/device/${deviceId}`, {
    headers: upstreamHeaders(session.token),
  });

  return proxyJson(upstream);
}

async function listDevices(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env);
  const candidates: DeviceCandidate[] = [];
  const seen = new Set<string>();
  const paths = [
    "/profile",
    "/profile/auth-app",
    "/profile/wanted-apps",
    "/devices",
    "/profile/devices",
    "/dreamehome/devices",
    "/mihome/devices",
    "/mova/devices",
    "/trouver/devices",
  ];

  for (const path of paths) {
    const response = await upstreamFetch(env, path, {
      headers: upstreamHeaders(session.token),
    });

    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      continue;
    }

    const payload = await response.json().catch(() => null);
    for (const device of extractDeviceCandidates(payload, path)) {
      const key = `${device.app}:${device.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(device);
      }
    }
  }

  return json({
    devices: candidates,
    message: candidates.length
      ? undefined
      : "No devices were found in the accessible Mindsolo API responses. Open the Mindsolo Devices page once, then use the app/device values from the device URL.",
  });
}

async function installVoicePack(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env);
  const form = await request.formData();
  const file = form.get("file");
  const appName = stringFormValue(form, "appName");
  const deviceId = stringFormValue(form, "deviceId");

  if (!(file instanceof File)) {
    return json({ message: "Voice-pack file is required." }, 400);
  }

  const deviceResponse = await upstreamFetch(env, `/${appName}/device/${deviceId}`, {
    headers: upstreamHeaders(session.token),
  });

  if (!deviceResponse.ok) {
    return proxyJson(deviceResponse);
  }

  const devicePayload = await deviceResponse.json<any>();
  const uploadName =
    devicePayload?.voicepack_settings?.upload_file_naming ||
    devicePayload?.payload?.voicepack_settings?.upload_file_naming ||
    "voicepack";

  const uploadForm = new FormData();
  uploadForm.set("file", file, file.name);

  const uploadResponse = await upstreamFetch(
    env,
    `/tempfile/upload/${encodeURIComponent(uploadName)}`,
    {
      method: "POST",
      headers: upstreamHeaders(session.token),
      body: uploadForm,
    },
  );

  if (!uploadResponse.ok) {
    return proxyJson(uploadResponse);
  }

  const uploadPayload = await uploadResponse.json<any>();
  const upload = uploadPayload?.payload ?? uploadPayload;

  if (!upload?.url || !upload?.md5 || !upload?.size) {
    return json({ message: "The upload service returned an incomplete file record." }, 502);
  }

  const installResponse = await upstreamFetch(env, "/projects/install_command", {
    method: "POST",
    headers: {
      ...upstreamHeaders(session.token),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      device_id: deviceId,
      app_name: appName,
      upload_voice: true,
      file_url: upload.url,
      file_size: upload.size,
      file_md5: upload.md5,
    }),
  });

  return proxyJson(installResponse);
}

function extractDeviceCandidates(value: unknown, source: string): DeviceCandidate[] {
  const results: DeviceCandidate[] = [];

  function visit(node: unknown) {
    if (Array.isArray(node)) {
      for (const item of node) {
        const device = normalizeDeviceCandidate(item, source);
        if (device) {
          results.push(device);
        }
        visit(item);
      }
      return;
    }

    if (node && typeof node === "object") {
      for (const child of Object.values(node as Record<string, unknown>)) {
        visit(child);
      }
    }
  }

  visit(value);
  return results;
}

function normalizeDeviceCandidate(value: unknown, source: string): DeviceCandidate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = stringValue(record.id) || stringValue(record.device_id) || stringValue(record.did);
  const app = stringValue(record.app) || stringValue(record.app_name) || stringValue(record.platform);
  const name = stringValue(record.name) || stringValue(record.title) || stringValue(record.device_name);
  const model = stringValue(record.model) || stringValue(record.model_name);

  if (!id || !app || (!name && !model)) {
    return null;
  }

  return {
    id,
    app,
    name,
    model,
    country: stringValue(record.country),
    source,
  };
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function upstreamHeaders(token: string): HeadersInit {
  return {
    authorization: token,
    accept: "application/json",
  };
}

function upstreamFetch(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const configuredBase = env.MINDSOLO_API_BASE || env.MINSOLO_API_BASE || DEFAULT_API_BASE;
  const base = configuredBase.replace(/\/$/, "");
  return fetch(`${base}${path}`, init);
}

async function proxyJson(response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  }

  const text = await response.text().catch(() => "");
  return json(
    { message: text || `Upstream request failed with status ${response.status}.` },
    response.status,
  );
}

async function requireSession(request: Request, env: Env): Promise<SessionPayload> {
  const cookie = parseCookie(request.headers.get("cookie") || "")[COOKIE_NAME];
  if (!cookie) {
    throw new HttpError("Session is missing.", 401);
  }

  return unsealSession(cookie, env.SESSION_SECRET);
}

async function sealSession(payload: SessionPayload, secret: string): Promise<string> {
  if (!secret) {
    throw new HttpError("SESSION_SECRET is not configured.", 500);
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(payload)),
    ),
  );

  const packed = new Uint8Array(iv.length + encrypted.length);
  packed.set(iv, 0);
  packed.set(encrypted, iv.length);
  return base64UrlEncode(packed);
}

async function unsealSession(value: string, secret: string): Promise<SessionPayload> {
  if (!secret) {
    throw new HttpError("SESSION_SECRET is not configured.", 500);
  }

  try {
    const packed = base64UrlDecode(value);
    const iv = packed.slice(0, 12);
    const ciphertext = packed.slice(12);
    const key = await crypto.subtle.importKey(
      "raw",
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(decrypted)) as SessionPayload;
  } catch {
    throw new HttpError("Session is invalid.", 401);
  }
}

function parseCookie(cookieHeader: string): Record<string, string> {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1
          ? [part, ""]
          : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function stringFormValue(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(`${key} is required.`, 400);
  }
  return value.trim();
}

function requiredParam(url: URL, key: string): string {
  const value = url.searchParams.get(key)?.trim();
  if (!value) {
    throw new HttpError(`${key} is required.`, 400);
  }
  return value;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function withCors(response: Response, request: Request, env: Env): Response {
  const origin = request.headers.get("origin");
  const allowedOrigin = env.ALLOWED_ORIGIN || "http://localhost:5173";
  const corsOrigin = origin === allowedOrigin ? origin : allowedOrigin;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", corsOrigin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.append("vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}


