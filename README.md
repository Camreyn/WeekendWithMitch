# Weekend With Mitch

A Vite/React canvas game where two handlers try to keep Mitch balanced in the middle.

## Local development

```sh
npm install
npm run dev
```

To test from another device on the same network:

```sh
npm run dev -- --host 0.0.0.0 --port 5173
```

## Changing game assets on GitHub

All production-editable assets live in `public/`. Vite copies that folder as-is during the Vercel build, so a GitHub commit that changes these files will appear after the next Vercel deployment.

The committed `public/game-config.json` starts with blank paths so the game has clean fallbacks. After uploading files, edit it to point at the files you want:

```json
{
  "faces": {
    "mitch": {
      "idle": "/assets/faces/mitch-idle.png",
      "steady": "/assets/faces/mitch-steady.png",
      "warningLeft": "/assets/faces/mitch-warning-left.png",
      "warningRight": "/assets/faces/mitch-warning-right.png",
      "fallen": "/assets/faces/mitch-fallen.png"
    },
    "leftHandler": "/assets/faces/left-handler.png",
    "rightHandler": "/assets/faces/right-handler.png"
  },
  "music": {
    "src": "/assets/audio/music.mp3",
    "loop": true,
    "startMuted": true,
    "volume": 0.45
  }
}
```

Recommended paths:

- Mitch face states: `public/assets/faces/mitch-idle.png`, `mitch-steady.png`, `mitch-warning-left.png`, `mitch-warning-right.png`, `mitch-fallen.png`
- Handler faces: `public/assets/faces/left-handler.png`, `public/assets/faces/right-handler.png`
- Music: `public/assets/audio/music.mp3`

PNG, JPG, WebP, MP3, OGG, and WAV files are fine as long as the config path matches the committed filename. Blank or missing face paths do not break the game; it falls back to the drawn characters. Leave `music.src` blank until an audio file is committed, and the music button stays disabled.

Browsers block autoplay, so music starts only after pressing the Music button or `M`.

## Build

```sh
npm run build
```

