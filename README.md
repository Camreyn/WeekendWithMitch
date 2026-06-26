# Dreame Voice-Pack Installer

A GitHub Pages webapp plus Cloudflare Worker API for installing a user-provided Dreame voice-pack file through the Mindsolo-compatible API flow.

## Local development

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a Worker secret for local development:

   ```sh
   npx wrangler secret put SESSION_SECRET
   ```

3. Start the Worker:

   ```sh
   npm run worker:dev
   ```

4. Start the frontend:

   ```sh
   npm run dev
   ```

The frontend defaults to `http://localhost:8787` for API calls. Set `VITE_API_BASE_URL` when using a deployed Worker.

## Deployment

Set these GitHub repository values before deploying:

- Actions variable `VITE_API_BASE_URL`: deployed Worker URL, for example `https://dreame-voicepack-installer-api.example.workers.dev`.
- Actions secret `CLOUDFLARE_API_TOKEN`: Cloudflare token with Worker deploy permissions.

Set these Cloudflare Worker values:

- Secret `SESSION_SECRET`: long random string for encrypted session cookies.
- Variable `ALLOWED_ORIGIN`: GitHub Pages URL for this repository.
- Variable `MINDSOLO_API_BASE`: defaults to `https://api-vacuum.mindsolo.net/api`.

## Notes

This app does not mirror or redistribute Mindsolo voice packs. It only uploads and installs a voice-pack file selected by the user.
