export type DeviceConfig = {
  appName: string;
  deviceId: string;
};

export type ApiError = {
  message: string;
};

export type DeviceSummary = {
  id: string;
  app: string;
  name?: string;
  model?: string;
  country?: string;
  source?: string;
};

export type DeviceListResponse = {
  devices: DeviceSummary[];
  message?: string;
};

export type DeviceResponse = {
  id?: string | number;
  name?: string;
  model?: string;
  voicepack_settings?: {
    file_type?: string;
    upload_file_naming?: string;
  };
  payload?: DeviceResponse;
  [key: string]: unknown;
};

export type InstallResult = {
  success?: boolean;
  message?: string;
  error_type?: string;
  [key: string]: unknown;
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8787").replace(
  /\/$/,
  "",
);

export async function createSession(accessToken: string): Promise<void> {
  await request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessToken }),
  });
}

export async function clearSession(): Promise<void> {
  await request("/api/session", { method: "DELETE" });
}

export async function findDevices(): Promise<DeviceListResponse> {
  return request<DeviceListResponse>("/api/devices");
}

export async function getDevice(config: DeviceConfig): Promise<DeviceResponse> {
  const params = new URLSearchParams({
    appName: config.appName,
    deviceId: config.deviceId,
  });
  return request<DeviceResponse>(`/api/device?${params}`);
}

export async function installVoicePack(
  config: DeviceConfig,
  file: File,
): Promise<InstallResult> {
  const form = new FormData();
  form.set("appName", config.appName);
  form.set("deviceId", config.deviceId);
  form.set("file", file);

  return request<InstallResult>("/api/voice/install", {
    method: "POST",
    body: form,
  });
}

async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
  });

  const text = await response.text();
  const data = text ? parseJson(text) : null;

  if (!response.ok) {
    const message =
      typeof data === "object" && data && "message" in data
        ? String((data as ApiError).message)
        : `Request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return data as T;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

