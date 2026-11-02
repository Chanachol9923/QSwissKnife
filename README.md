# QSwissKnife

A pocket knife for files: convert, compress, crop and trim images, video, audio and PDFs, plus everyday developer and text tools. Everything runs in the browser — files never leave your device. The only exception is the YouTube Downloader, which uses a local helper on your own machine.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/
```

## Desktop shortcut (Windows)

```bash
npm run app:build  # builds launcher/bin/QSwissKnife.exe and the Desktop + Start Menu shortcuts
npm run shortcut   # only (re)create the shortcuts
```

`QSwissKnife.exe` is a small native window that shows the app with WebView2 (the Edge engine built into Windows), so it has its own taskbar button and icon — pin it like any program (right-click the shortcut → **Pin to taskbar**). It needs nothing beyond Windows 10/11: the build uses the built-in .NET Framework compiler and fetches Microsoft's WebView2 SDK DLLs once from nuget.org (signature-checked). Without the exe, the shortcut falls back to an Edge app window, which Windows groups under Edge.

Opening it starts a hidden local server on `http://127.0.0.1:4317` (rebuilding first if the code changed since the last build) and loads QSwissKnife. A second launch just focuses the open window, and the window remembers its size and position. The server keeps running in the background so the next launch is instant; use **Stop QSwissKnife server** in the Start Menu to shut it down. Logs: `launcher/server.log*`. Regenerate the icon with `npm run icons`.

## YouTube Downloader (local helper)

Browsers can't download from YouTube directly, so the dev/preview server includes a small helper (`server/ytHelper.ts`) that runs **yt-dlp** and **FFmpeg** installed on your computer.

```bash
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
# macOS: brew install yt-dlp ffmpeg
```

Then run `npm run dev` (or `npm run build && npm run preview`). Restart the server after installing so it picks up the new PATH, or set `YTDLP_PATH` / `FFMPEG_PATH`. The helper only exists on those servers — a static `dist/` hosted elsewhere shows setup instructions instead.

To use it from a phone or tablet on the same Wi-Fi: `npm run dev -- --host`, then open the shown network address. Anyone on that network can reach the helper while it runs.

Only download videos you own or have permission to use.

## Notes

- Video tools use hardware encoding (WebCodecs) when the browser supports the format, and fall back to FFmpeg compiled to WebAssembly.
- Tools are registered in `src/tools/registry.ts`.
