# QSwissKnife

**by AnnoyingDoggo**

A pocket knife for files: convert, compress, crop and trim images, video, audio and PDFs, plus everyday developer and text tools. Everything runs on your own computer — files are never uploaded. Tools run side by side in tabs, with a Running tasks view for everything in progress.

## Install on Windows (easy way)

1. Go to **[Releases](https://github.com/Chanachol9923/QSwissKnife/releases/latest)** and download **`QSwissKnife-Setup-x.y.z.exe`**.
2. Run it and press **Install**. No admin rights needed — it installs just for you, in `%LOCALAPPDATA%\Programs\QSwissKnife`.
3. QSwissKnife opens. It's on your Desktop and in the Start Menu; right-click → **Pin to taskbar** to keep it there.

The setup includes everything the app needs (its own Node.js runtime and the app files). Windows 10/11 already has the WebView2 engine it uses. Optionally, tick **YouTube Downloader support** to have it install yt-dlp and FFmpeg through winget.

> **"Windows protected your PC"?** The installer isn't code-signed yet, so SmartScreen may warn on first run. Click **More info → Run anyway**. You can compare the file with the `.sha256` checksum published next to it on the release page.

**Uninstall:** Settings → Apps → *QSwissKnife* → Uninstall. It asks whether to keep your settings (favorites, theme, window size).

Quiet install for scripts: `QSwissKnife-Setup-x.y.z.exe /S [/D=<folder>] [/NoDesktop] [/NoStartMenu] [/YouTube] [/NoLaunch]` · quiet uninstall: `uninstall.exe /S [/KeepData]`.

## Web version

The same app can be hosted as a static site (see [docs/vercel.md](docs/vercel.md)). All tools work in the browser; the YouTube Downloader talks to the helper of the installed Windows app on `http://127.0.0.1:4317`, so files still never pass through the website.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/
npm run package    # release/QSwissKnife-Setup-<version>.exe
```

### Building the installer

`npm run package` (Windows) builds the web app, bundles `server/serve.ts` (a small server using only Node's built-ins) into `serve.mjs`, compiles `QSwissKnife.exe` and the uninstaller, copies the local signed `node.exe`, and packs it all into a single self-extracting `QSwissKnife-Setup-<version>.exe` plus a `.sha256` file. It only needs Node/npm and the .NET Framework 4.8 compiler that ships with Windows. The version comes from `package.json`.

### Developer shortcut (run from the repo)

```bash
npm run app:build  # builds launcher/bin/QSwissKnife.exe and Desktop + Start Menu shortcuts
npm run shortcut   # only (re)create the shortcuts
```

`QSwissKnife.exe` is a small native window that shows the app with WebView2 (the Edge engine built into Windows), so it has its own taskbar button and icon. From the repo it starts a hidden `vite preview` server on `http://127.0.0.1:4317` (rebuilding first if the code changed); installed, it runs the bundled Node server and stops it when the window closes. A second launch focuses the open window, and the window remembers its size and position. Use **Stop QSwissKnife server** in the Start Menu to stop the repo server. Logs: `launcher/server.log*`. Regenerate the icon with `npm run icons`.

## YouTube Downloader (local helper)

Browsers can't download from YouTube directly, so a small helper (`server/ytHelper.ts`) runs **yt-dlp** and **FFmpeg** on your computer — inside the installed app, the dev server or `vite preview`.

```bash
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
# macOS: brew install yt-dlp ffmpeg
```

Restart the app or server after installing so it picks up the new PATH, or set `YTDLP_PATH` / `FFMPEG_PATH`. The helper only accepts requests from pages on this computer and the hosted web version.

To use the dev server from a phone or tablet on the same Wi-Fi: `npm run dev -- --host`, then open the shown network address. Anyone on that network can reach the helper while it runs.

Only download videos you own or have permission to use.

## Notes

- Video tools use hardware encoding (WebCodecs) when the browser supports the format, and fall back to FFmpeg compiled to WebAssembly.
- Tools are registered in `src/tools/registry.ts`.
- Bundled third-party software: Node.js (MIT), Microsoft Edge WebView2 SDK, FFmpeg.wasm.
