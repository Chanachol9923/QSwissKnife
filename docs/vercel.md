# Hosting QSwissKnife on Vercel

The web app is fully static: every tool runs in the visitor's browser on their own CPU/GPU (canvas,
WebCodecs, FFmpeg compiled to WebAssembly, pdf-lib). Vercel only serves the files — nothing is uploaded.

## Deploy

1. Go to <https://vercel.com/new> and import the GitHub repo `Chanachol9923/QSwissKnife`.
2. Keep the project name **qswissknife** — the YouTube helper trusts `https://qswissknife.vercel.app`
   and its preview URLs (`https://qswissknife-*.vercel.app`) out of the box.
3. Deploy. `vercel.json` already sets the build (`npx vite build` → `dist/`) and caching.

Every push to `main` redeploys automatically.

## YouTube Downloader on the hosted site

Vercel can't run yt-dlp (and downloading on a server would be slow, often blocked, and make you the
one serving the files), so the hosted page talks to the **QSwissKnife desktop app on the visitor's own
computer** at `http://127.0.0.1:4317`:

- The page shows a **Download for Windows** button (latest `QSwissKnife-Setup*.exe` from GitHub Releases).
- With the desktop app open, the YouTube tool works on the hosted site too. Chrome/Edge may ask to allow
  access to devices on the local network — choose **Allow**.
- The helper only answers this computer, `*.vercel.app` URLs of this project, and origins listed in the
  `QSK_ALLOWED_ORIGINS` environment variable (comma-separated). Every other website gets `403`.

Using a custom domain? Add it for the helper, e.g. `QSK_ALLOWED_ORIGINS=https://tools.example.com`
(set it as a user environment variable on the PC running the desktop app, then restart the app).

## The "Download for Windows" button

It asks the GitHub API for the latest release and downloads the first asset matching `Setup*.exe`. Until a
release is published it opens the Releases page instead. Publish the installer built by
`npm run package` as a GitHub Release asset.
