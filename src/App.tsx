import {
  Coffee,
  ArrowLeft,
  ArrowRight,
  Hand,
  Pause,
  Play,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";

type Inputs = {
  left: boolean;
  right: boolean;
};

type SimState = {
  angle: number;
  angularVelocity: number;
  best: number;
  crowdHeat: number;
  difficulty: number;
  gameOver: boolean;
  gust: number;
  gustTimer: number;
  message: string;
  paused: boolean;
  score: number;
  stumbleSeed: number;
  time: number;
};

type Snapshot = Pick<
  SimState,
  "angle" | "best" | "crowdHeat" | "difficulty" | "gameOver" | "message" | "paused" | "score"
>;

type MitchFaceState = "idle" | "steady" | "warningLeft" | "warningRight" | "fallen";

type GameConfig = {
  faces?: {
    mitch?: Partial<Record<MitchFaceState, string>>;
    leftHandler?: string;
    rightHandler?: string;
  };
  music?: {
    src?: string;
    loop?: boolean;
    startMuted?: boolean;
    volume?: number;
  };
};

type GameAssets = {
  faces: {
    mitch: Partial<Record<MitchFaceState, HTMLImageElement>>;
    leftHandler?: HTMLImageElement;
    rightHandler?: HTMLImageElement;
  };
};

const EMPTY_ASSETS: GameAssets = {
  faces: {
    mitch: {},
  },
};

const START_STATE: SimState = {
  angle: 0.04,
  angularVelocity: 0,
  best: Number(window.localStorage.getItem("mitch-best-score") ?? 0),
  crowdHeat: 0,
  difficulty: 1,
  gameOver: false,
  gust: 0.15,
  gustTimer: 0.9,
  message: "Keep Mitch casual.",
  paused: false,
  score: 0,
  stumbleSeed: Math.random() * 1000,
  time: 0,
};

const FALL_LIMIT = 0.72;
const WARNING_LIMIT = 0.44;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number>();
  const previousTimeRef = useRef<number>();
  const simRef = useRef<SimState>({ ...START_STATE });
  const inputRef = useRef<Inputs>({ left: false, right: false });
  const assetsRef = useRef<GameAssets>(EMPTY_ASSETS);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => createSnapshot(simRef.current));
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [musicReady, setMusicReady] = useState(false);

  const tiltPercent = useMemo(
    () => Math.min(100, Math.round((Math.abs(snapshot.angle) / FALL_LIMIT) * 100)),
    [snapshot.angle],
  );

  const resetGame = useCallback(() => {
    const best = simRef.current.best;
    simRef.current = {
      ...START_STATE,
      angle: (Math.random() > 0.5 ? 1 : -1) * 0.05,
      best,
      gust: (Math.random() - 0.5) * 0.35,
      stumbleSeed: Math.random() * 1000,
    };
    inputRef.current = { left: false, right: false };
    setSnapshot(createSnapshot(simRef.current));
  }, []);

  const togglePause = useCallback(() => {
    const sim = simRef.current;
    if (sim.gameOver) {
      resetGame();
      return;
    }
    sim.paused = !sim.paused;
    sim.message = sim.paused ? "Frozen mid-wobble." : "Back in character.";
    setSnapshot(createSnapshot(sim));
  }, [resetGame]);

  const toggleMusic = useCallback(() => {
    const music = musicRef.current;
    if (!music) {
      return;
    }

    if (musicEnabled) {
      music.pause();
      setMusicEnabled(false);
      return;
    }

    music.play()
      .then(() => setMusicEnabled(true))
      .catch(() => setMusicEnabled(false));
  }, [musicEnabled]);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      try {
        const response = await fetch(assetUrl("/game-config.json"), { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const config = (await response.json()) as GameConfig;
        const nextAssets = await loadGameAssets(config);
        if (cancelled) {
          return;
        }

        assetsRef.current = nextAssets;

        if (config.music?.src && await assetExists(config.music.src)) {
          const music = new Audio(assetUrl(config.music.src));
          music.loop = config.music.loop ?? true;
          music.volume = clamp(config.music.volume ?? 0.45, 0, 1);
          music.preload = "auto";
          musicRef.current = music;
          setMusicReady(true);
          setMusicEnabled(false);
        }
      } catch {
        assetsRef.current = EMPTY_ASSETS;
      }
    }

    loadConfig();
    return () => {
      cancelled = true;
      musicRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }

      if (event.key === "a" || event.key === "A" || event.key === "ArrowLeft") {
        inputRef.current.left = true;
      }
      if (event.key === "d" || event.key === "D" || event.key === "ArrowRight") {
        inputRef.current.right = true;
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (simRef.current.gameOver) {
          resetGame();
        } else {
          togglePause();
        }
      }
      if (event.key === "r" || event.key === "R") {
        resetGame();
      }
      if (event.key === "m" || event.key === "M") {
        toggleMusic();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "a" || event.key === "A" || event.key === "ArrowLeft") {
        inputRef.current.left = false;
      }
      if (event.key === "d" || event.key === "D" || event.key === "ArrowRight") {
        inputRef.current.right = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [resetGame, toggleMusic, togglePause]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let snapshotAccumulator = 0;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      canvas.width = Math.round(bounds.width * ratio);
      canvas.height = Math.round(bounds.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const tick = (time: number) => {
      const previousTime = previousTimeRef.current ?? time;
      previousTimeRef.current = time;
      const dt = Math.min(0.032, (time - previousTime) / 1000);
      const sim = simRef.current;

      if (!sim.paused && !sim.gameOver) {
        updateSimulation(sim, inputRef.current, dt);
      }

      drawGame(context, canvas, sim, inputRef.current, assetsRef.current);

      snapshotAccumulator += dt;
      if (snapshotAccumulator > 0.08 || sim.gameOver || sim.paused) {
        setSnapshot(createSnapshot(sim));
        snapshotAccumulator = 0;
      }

      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      observer.disconnect();
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  const setInput = (side: keyof Inputs, value: boolean) => {
    inputRef.current[side] = value;
  };

  const holdButton = (event: PointerEvent<HTMLButtonElement>, side: keyof Inputs) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setInput(side, true);
  };

  const releaseButton = (event: PointerEvent<HTMLButtonElement>, side: keyof Inputs) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setInput(side, false);
  };

  return (
    <main className="game-shell">
      <section className="hero-band" aria-label="Game header">
        <div className="title-block">
          <p className="eyebrow">Sidewalk party survival</p>
          <h1>Weekend With Mitch</h1>
          <a className="tip-link" href="https://ko-fi.com/camreyn" rel="noreferrer" target="_blank">
            <Coffee aria-hidden="true" />
            <span>Tips</span>
          </a>
        </div>
        <div className="scoreboard" aria-label="Scoreboard">
          <div>
            <span>Score</span>
            <strong>{Math.floor(snapshot.score)}</strong>
          </div>
          <div>
            <span>Best</span>
            <strong>{Math.floor(snapshot.best)}</strong>
          </div>
          <div>
            <span>Heat</span>
            <strong>{Math.round(snapshot.crowdHeat)}%</strong>
          </div>
        </div>
      </section>

      <section className="stage-wrap" aria-label="Game stage">
        <canvas ref={canvasRef} className="game-canvas" aria-label="Weekend With Mitch game canvas" />
        <div className="status-panel" aria-live="polite">
          <div>
            <span>Status</span>
            <strong>{snapshot.message}</strong>
          </div>
          <div className="tilt-track" aria-label={`Tilt danger ${tiltPercent} percent`}>
            <span style={{ width: `${tiltPercent}%` }} />
          </div>
        </div>
      </section>

      <section className="controls" aria-label="Game controls">
        <button
          className="control-button"
          onPointerCancel={(event) => releaseButton(event, "left")}
          onPointerDown={(event) => holdButton(event, "left")}
          onPointerLeave={(event) => releaseButton(event, "left")}
          onPointerUp={(event) => releaseButton(event, "left")}
          type="button"
        >
          <ArrowLeft aria-hidden="true" />
          <span>Left handler</span>
        </button>
        <button className="round-button" onClick={togglePause} type="button">
          {snapshot.paused || snapshot.gameOver ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          <span>{snapshot.gameOver ? "Again" : snapshot.paused ? "Resume" : "Pause"}</span>
        </button>
        <button className="round-button" disabled={!musicReady} onClick={toggleMusic} type="button">
          {musicEnabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
          <span>Music</span>
        </button>
        <button className="round-button" onClick={resetGame} type="button">
          <RotateCcw aria-hidden="true" />
          <span>Reset</span>
        </button>
        <button
          className="control-button"
          onPointerCancel={(event) => releaseButton(event, "right")}
          onPointerDown={(event) => holdButton(event, "right")}
          onPointerLeave={(event) => releaseButton(event, "right")}
          onPointerUp={(event) => releaseButton(event, "right")}
          type="button"
        >
          <span>Right handler</span>
          <ArrowRight aria-hidden="true" />
        </button>
      </section>

      <section className="briefing" aria-label="Controls and goal">
        <div>
          <Hand aria-hidden="true" />
          <span>Hold A / Left or D / Right to pull Mitch back toward center.</span>
        </div>
        <div>
          <Trophy aria-hidden="true" />
          <span>Survive as long as possible while the crowd gets harder to fool.</span>
        </div>
      </section>

      <footer className="parody-notice">
        <strong>Parody notice:</strong> Weekend With Mitch is an unofficial fair-use parody game for commentary and entertainment. It is not affiliated with, endorsed by, or sponsored by any public figure, campaign, office, or rights holder.
      </footer>
    </main>
  );
}

async function loadGameAssets(config: GameConfig): Promise<GameAssets> {
  const mitchEntries = Object.entries(config.faces?.mitch ?? {}) as Array<[MitchFaceState, string]>;
  const loadedMitch = await Promise.all(
    mitchEntries.map(async ([state, path]) => [state, await loadImage(path)] as const),
  );

  const nextAssets: GameAssets = {
    faces: {
      mitch: {},
      leftHandler: await loadImage(config.faces?.leftHandler),
      rightHandler: await loadImage(config.faces?.rightHandler),
    },
  };

  for (const [state, image] of loadedMitch) {
    if (image) {
      nextAssets.faces.mitch[state] = image;
    }
  }

  return nextAssets;
}

async function assetExists(path: string) {
  try {
    const response = await fetch(assetUrl(path), { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

function loadImage(path?: string): Promise<HTMLImageElement | undefined> {
  if (!path) {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = assetUrl(path);
  });
}

function assetUrl(path: string) {
  if (/^(https?:)?\/\//.test(path) || path.startsWith("data:")) {
    return path;
  }

  if (path.startsWith("/")) {
    return path;
  }

  return new URL(path, window.location.href).toString();
}

function updateSimulation(sim: SimState, inputs: Inputs, dt: number) {
  sim.time += dt;
  sim.gustTimer -= dt;
  sim.difficulty = 1 + Math.min(2.2, sim.score / 280);

  if (sim.gustTimer <= 0) {
    sim.gustTimer = 0.45 + Math.random() * Math.max(0.45, 1.25 - sim.difficulty * 0.18);
    sim.gust = (Math.random() - 0.5) * (0.7 + sim.difficulty * 0.22);
  }

  const left = inputs.left ? 1 : 0;
  const right = inputs.right ? 1 : 0;
  const both = left && right ? 1 : 0;
  const playerTorque = (right - left) * (3.35 + sim.difficulty * 0.18);
  const unstableGravity = sim.angle * (2.35 + sim.difficulty * 0.42);
  const stumble =
    Math.sin(sim.time * (1.6 + sim.difficulty * 0.24) + sim.stumbleSeed) * 0.34 +
    Math.sin(sim.time * 3.1 + sim.stumbleSeed * 0.37) * 0.16;
  const overCorrection = both * Math.sin(sim.time * 18) * 0.55;
  const damping = sim.angularVelocity * (0.92 + both * 1.35);
  const acceleration = unstableGravity + sim.gust + stumble + overCorrection + playerTorque - damping;

  sim.angularVelocity += acceleration * dt;
  sim.angularVelocity = clamp(sim.angularVelocity, -3.6, 3.6);
  sim.angle += sim.angularVelocity * dt;

  const steadiness = 1 - Math.min(1, Math.abs(sim.angle) / FALL_LIMIT);
  const centerBonus = Math.max(0, 1 - Math.abs(sim.angle) / 0.24);
  sim.score += dt * (8 + steadiness * 8 + centerBonus * 7);
  sim.crowdHeat = clamp(sim.crowdHeat + dt * (6 + sim.difficulty * 2.5 - steadiness * 5), 0, 100);

  if (Math.abs(sim.angle) > FALL_LIMIT) {
    sim.gameOver = true;
    sim.message = sim.angle > 0 ? "Mitch folded into the buffet." : "Mitch drifted into the coat check.";
    if (sim.score > sim.best) {
      sim.best = sim.score;
      window.localStorage.setItem("mitch-best-score", String(Math.floor(sim.best)));
    }
    return;
  }

  if (Math.abs(sim.angle) > WARNING_LIMIT) {
    sim.message = sim.angle > 0 ? "Right side is losing him." : "Left side is losing him.";
  } else if (centerBonus > 0.55) {
    sim.message = "Mitch looks almost invited.";
  } else if (both) {
    sim.message = "Too much help looks suspicious.";
  } else {
    sim.message = "Keep Mitch casual.";
  }
}

function drawGame(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  sim: SimState,
  inputs: Inputs,
  assets: GameAssets,
) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  context.clearRect(0, 0, width, height);

  const floorY = height * 0.77;
  drawBackdrop(context, width, height, floorY, sim);

  const centerX = width / 2;
  const supportSpread = Math.min(245, width * 0.28);
  const leftX = centerX - supportSpread;
  const rightX = centerX + supportSpread;
  const lean = sim.angle;
  const mitchX = centerX + Math.sin(lean) * Math.min(100, width * 0.13);
  const mitchY = floorY - 164 + Math.abs(lean) * 28;

  drawArm(context, leftX + 34, floorY - 125, mitchX - 34, mitchY - 55, inputs.left);
  drawArm(context, rightX - 34, floorY - 125, mitchX + 34, mitchY - 55, inputs.right);
  drawHandler(context, leftX, floorY, "left", inputs.left, sim.time, assets.faces.leftHandler);
  drawHandler(context, rightX, floorY, "right", inputs.right, sim.time, assets.faces.rightHandler);
  drawMitch(context, mitchX, mitchY, lean, sim, assets.faces.mitch[getMitchFaceState(sim)]);

  if (sim.paused || sim.gameOver) {
    drawOverlay(context, width, height, sim.gameOver ? "Mitch is down" : "Paused");
  }
}

function drawBackdrop(context: CanvasRenderingContext2D, width: number, height: number, floorY: number, sim: SimState) {
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#172033");
  sky.addColorStop(0.56, "#344050");
  sky.addColorStop(1, "#6f5e48");
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "rgba(255, 218, 128, 0.9)";
  for (let i = 0; i < 9; i += 1) {
    const x = (i / 8) * width;
    const y = 70 + Math.sin(i * 1.7) * 18;
    context.beginPath();
    context.arc(x, y, 4, 0, Math.PI * 2);
    context.fill();
    if (i > 0) {
      context.strokeStyle = "rgba(255, 218, 128, 0.35)";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(((i - 1) / 8) * width, 70 + Math.sin((i - 1) * 1.7) * 18);
      context.quadraticCurveTo(x - width / 16, y + 22, x, y);
      context.stroke();
    }
  }

  context.fillStyle = "rgba(15, 22, 30, 0.44)";
  for (let i = 0; i < 18; i += 1) {
    const x = (i / 17) * width;
    const h = 42 + ((i * 31) % 54);
    context.fillRect(x - 18, floorY - h - 20, 36, h);
    context.fillStyle = i % 2 ? "rgba(244, 191, 92, 0.48)" : "rgba(255, 255, 255, 0.3)";
    context.fillRect(x - 8, floorY - h - 7, 16, 8);
    context.fillStyle = "rgba(15, 22, 30, 0.44)";
  }

  const floor = context.createLinearGradient(0, floorY, 0, height);
  floor.addColorStop(0, "#b07648");
  floor.addColorStop(1, "#66402d");
  context.fillStyle = floor;
  context.fillRect(0, floorY, width, height - floorY);

  context.strokeStyle = "rgba(48, 29, 23, 0.26)";
  context.lineWidth = 2;
  for (let y = floorY + 22; y < height; y += 28) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y + Math.sin(sim.time + y) * 2);
    context.stroke();
  }

  context.fillStyle = "rgba(255, 246, 212, 0.18)";
  context.beginPath();
  context.ellipse(width / 2, floorY + 18, width * 0.32, 28, 0, 0, Math.PI * 2);
  context.fill();
}

function drawHandler(
  context: CanvasRenderingContext2D,
  x: number,
  floorY: number,
  side: "left" | "right",
  active: boolean,
  time: number,
  faceImage?: HTMLImageElement,
) {
  const dir = side === "left" ? 1 : -1;
  const bob = Math.sin(time * 6 + x) * 2;
  const suit = active ? "#1f6f78" : "#22313f";

  context.save();
  context.translate(x, floorY + bob);

  context.strokeStyle = "#1f2427";
  context.lineWidth = 13;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(-15, -72);
  context.lineTo(-24, -9);
  context.moveTo(15, -72);
  context.lineTo(24, -9);
  context.stroke();

  context.fillStyle = suit;
  roundedRect(context, -35, -150, 70, 92, 12);
  context.fill();

  context.fillStyle = "#e7b98f";
  context.beginPath();
  context.arc(0, -176, 29, 0, Math.PI * 2);
  context.fill();

  if (faceImage) {
    drawImageInCircle(context, faceImage, 0, -176, 27);
  }

  context.fillStyle = "#2a201d";
  context.fillRect(-23, -201, 46, 13);
  context.fillRect(-30, -190, 60, 8);

  if (!faceImage) {
    context.fillStyle = "#101820";
    context.beginPath();
    context.arc(-9, -178, 2.5, 0, Math.PI * 2);
    context.arc(10, -178, 2.5, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#8a4c35";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(0, -168, 8, 0.1, Math.PI - 0.1);
    context.stroke();
  }

  context.fillStyle = "#f4efe8";
  context.beginPath();
  context.moveTo(-16, -149);
  context.lineTo(0, -101);
  context.lineTo(16, -149);
  context.fill();
  context.fillStyle = "#b03a2e";
  context.fillRect(-4, -141, 8, 42);

  context.strokeStyle = suit;
  context.lineWidth = 15;
  context.beginPath();
  context.moveTo(dir * 22, -129);
  context.lineTo(dir * 52, -116);
  context.stroke();

  context.restore();
}

function drawMitch(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  sim: SimState,
  faceImage?: HTMLImageElement,
) {
  context.save();
  context.translate(x, y);
  context.rotate(angle);

  context.strokeStyle = "#303236";
  context.lineWidth = 12;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(-18, 78);
  context.lineTo(-32, 156);
  context.moveTo(18, 78);
  context.lineTo(32, 156);
  context.stroke();

  context.fillStyle = "#6b6e78";
  roundedRect(context, -44, -20, 88, 118, 18);
  context.fill();
  context.fillStyle = "#dad8cf";
  context.beginPath();
  context.moveTo(-19, -18);
  context.lineTo(0, 44);
  context.lineTo(19, -18);
  context.fill();

  context.fillStyle = "#c24635";
  context.fillRect(-5, 0, 10, 56);

  context.fillStyle = "#deb996";
  context.beginPath();
  context.arc(0, -56, 31, 0, Math.PI * 2);
  context.fill();

  if (faceImage) {
    drawImageInCircle(context, faceImage, 0, -56, 29);
  }

  context.fillStyle = "#d8d3c2";
  context.beginPath();
  context.arc(-14, -82, 17, Math.PI, Math.PI * 2);
  context.arc(8, -87, 20, Math.PI, Math.PI * 2);
  context.arc(22, -76, 13, Math.PI, Math.PI * 2);
  context.fill();

  if (!faceImage) {
    context.strokeStyle = "rgba(109, 73, 58, 0.62)";
    context.lineWidth = 1.5;
    for (let i = 0; i < 4; i += 1) {
      context.beginPath();
      context.moveTo(-13, -55 + i * 7);
      context.quadraticCurveTo(0, -51 + i * 7, 13, -55 + i * 7);
      context.stroke();
    }

    context.fillStyle = "#161d24";
    context.beginPath();
    context.arc(-10, -61, 2.8, 0, Math.PI * 2);
    context.arc(11, -61, 2.8, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = "#6f493a";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-8, -45);
    context.quadraticCurveTo(0, -39 + Math.sin(sim.time * 9) * 1.5, 10, -45);
    context.stroke();
  }

  context.fillStyle = "#f7ecd1";
  roundedRect(context, -37, -126, 74, 26, 8);
  context.fill();
  context.fillStyle = "#6a4633";
  context.font = "700 15px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText("MITCH", 0, -108);

  context.restore();

  context.save();
  context.globalAlpha = 0.28;
  context.fillStyle = "#17100f";
  context.beginPath();
  context.ellipse(x, y + 159, 55, 15, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawArm(
  context: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  active: boolean,
) {
  context.strokeStyle = active ? "#2f9aa0" : "#303942";
  context.lineWidth = active ? 13 : 10;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(startX, startY);
  context.quadraticCurveTo((startX + endX) / 2, startY - 20, endX, endY);
  context.stroke();

  context.fillStyle = "#deb996";
  context.beginPath();
  context.arc(endX, endY, 8, 0, Math.PI * 2);
  context.fill();
}

function drawOverlay(context: CanvasRenderingContext2D, width: number, height: number, title: string) {
  context.save();
  context.fillStyle = "rgba(14, 18, 24, 0.58)";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#fff6df";
  context.font = "800 40px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText(title, width / 2, height / 2 - 8);
  context.font = "700 16px system-ui, sans-serif";
  context.fillText("Press Space or tap Again", width / 2, height / 2 + 28);
  context.restore();
}

function drawImageInCircle(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  radius: number,
) {
  context.save();
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.clip();
  drawImageCover(context, image, x - radius, y - radius, radius * 2, radius * 2);
  context.restore();

  context.strokeStyle = "rgba(255, 246, 212, 0.82)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.stroke();
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const boxRatio = width / height;
  const sourceWidth = imageRatio > boxRatio ? image.naturalHeight * boxRatio : image.naturalWidth;
  const sourceHeight = imageRatio > boxRatio ? image.naturalHeight : image.naturalWidth / boxRatio;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = (image.naturalHeight - sourceHeight) / 2;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
}

function getMitchFaceState(sim: SimState): MitchFaceState {
  if (sim.gameOver) {
    return "fallen";
  }

  if (Math.abs(sim.angle) > WARNING_LIMIT) {
    return sim.angle > 0 ? "warningRight" : "warningLeft";
  }

  if (Math.abs(sim.angle) < 0.16) {
    return "steady";
  }

  return "idle";
}

function createSnapshot(sim: SimState): Snapshot {
  return {
    angle: sim.angle,
    best: sim.best,
    crowdHeat: sim.crowdHeat,
    difficulty: sim.difficulty,
    gameOver: sim.gameOver,
    message: sim.message,
    paused: sim.paused,
    score: sim.score,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}



