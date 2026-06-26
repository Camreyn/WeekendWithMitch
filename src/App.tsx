import {
  CheckCircle2,
  LogOut,
  PlugZap,
  RefreshCcw,
  Send,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import {
  clearSession,
  createSession,
  DeviceConfig,
  DeviceResponse,
  getDevice,
  installVoicePack,
} from "./api";

const DEFAULT_CONFIG: DeviceConfig = {
  appName: "dreamehome",
  deviceId: "107265",
};

type Status = {
  tone: "neutral" | "success" | "danger";
  text: string;
};

export function App() {
  const [accessToken, setAccessToken] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [config, setConfig] = useState<DeviceConfig>(() => loadConfig());
  const [device, setDevice] = useState<DeviceResponse | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>({
    tone: "neutral",
    text: "Ready",
  });
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const deviceName = useMemo(() => {
    const payload = device?.payload ?? device;
    return payload?.name || payload?.model || "Dreame X40";
  }, [device]);

  async function handleSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("session", async () => {
      await createSession(accessToken);
      setIsAuthenticated(true);
      setAccessToken("");
      setStatus({ tone: "success", text: "Session active" });
    });
  }

  async function handleDeviceCheck(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    persistConfig(config);
    await runAction("device", async () => {
      const nextDevice = await getDevice(config);
      setDevice(nextDevice);
      setStatus({ tone: "success", text: "Device connected" });
    });
  }

  async function handleInstall() {
    if (!file) {
      setStatus({ tone: "danger", text: "Choose a voice-pack file first" });
      return;
    }

    persistConfig(config);
    await runAction("install", async () => {
      const result = await installVoicePack(config, file);
      if (result.success === false || result.message) {
        setStatus({
          tone: result.success === false ? "danger" : "success",
          text: result.message || "Install command sent",
        });
        return;
      }
      setStatus({ tone: "success", text: "Install command sent" });
    });
  }

  async function handleLogout() {
    await runAction("logout", async () => {
      await clearSession();
      setIsAuthenticated(false);
      setDevice(null);
      setStatus({ tone: "neutral", text: "Session cleared" });
    });
  }

  async function runAction(action: string, callback: () => Promise<void>) {
    setBusyAction(action);
    setStatus({ tone: "neutral", text: "Working" });
    try {
      await callback();
    } catch (error) {
      setStatus({
        tone: "danger",
        text: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="shell">
      <section className="topbar" aria-label="Application header">
        <div>
          <p className="eyebrow">Dreame X40</p>
          <h1>Voice-pack installer</h1>
        </div>
        <StatusPill status={status} />
      </section>

      <section className="workspace">
        <form className="panel auth-panel" onSubmit={handleSession}>
          <div className="panel-title">
            <ShieldCheck aria-hidden="true" />
            <h2>Session</h2>
          </div>
          <label>
            Access token
            <input
              autoComplete="off"
              disabled={busyAction === "session"}
              onChange={(event) => setAccessToken(event.target.value)}
              placeholder="Paste token"
              type="password"
              value={accessToken}
            />
          </label>
          <div className="button-row">
            <button disabled={!accessToken || busyAction === "session"} type="submit">
              <PlugZap aria-hidden="true" />
              Connect
            </button>
            <button
              className="secondary"
              disabled={busyAction === "logout"}
              onClick={handleLogout}
              type="button"
            >
              <LogOut aria-hidden="true" />
              Clear
            </button>
          </div>
        </form>

        <form className="panel" onSubmit={handleDeviceCheck}>
          <div className="panel-title">
            <RefreshCcw aria-hidden="true" />
            <h2>Device</h2>
          </div>
          <div className="field-grid">
            <label>
              App
              <input
                onChange={(event) =>
                  setConfig((current) => ({ ...current, appName: event.target.value }))
                }
                value={config.appName}
              />
            </label>
            <label>
              Device ID
              <input
                inputMode="numeric"
                onChange={(event) =>
                  setConfig((current) => ({ ...current, deviceId: event.target.value }))
                }
                value={config.deviceId}
              />
            </label>
          </div>
          <button disabled={!isAuthenticated || busyAction === "device"} type="submit">
            <RefreshCcw aria-hidden="true" />
            Check device
          </button>
          <div className="device-strip">
            <span>{device ? deviceName : "No device loaded"}</span>
            {device ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
          </div>
        </form>

        <section className="panel install-panel">
          <div className="panel-title">
            <Upload aria-hidden="true" />
            <h2>Voice pack</h2>
          </div>
          <label className="file-picker">
            <input
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              type="file"
            />
            <Upload aria-hidden="true" />
            <span>{file ? file.name : "Choose file"}</span>
          </label>
          {file ? (
            <div className="file-meta">
              <span>{(file.size / 1024 / 1024).toFixed(2)} MiB</span>
              <span>{file.type || "binary"}</span>
            </div>
          ) : null}
          <button
            className="primary-wide"
            disabled={!isAuthenticated || !file || busyAction === "install"}
            onClick={handleInstall}
            type="button"
          >
            <Send aria-hidden="true" />
            Send to robot
          </button>
        </section>
      </section>
    </main>
  );
}

function StatusPill({ status }: { status: Status }) {
  return <div className={`status status-${status.tone}`}>{status.text}</div>;
}

function loadConfig(): DeviceConfig {
  const raw = window.localStorage.getItem("dreame-device-config");
  if (!raw) {
    return DEFAULT_CONFIG;
  }

  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function persistConfig(config: DeviceConfig) {
  window.localStorage.setItem("dreame-device-config", JSON.stringify(config));
}
