# Coursify

Turn YouTube playlists into **focused courses** for studying — with syllabus, progress, and notes.

![Coursify](public/assets/coursify-readme.png)

## Features

- **Dashboard**: save courses on-device
- **Course player**: clean syllabus + Prev/Next + focus mode
- **Progress tracking**: completion + watch % (saved locally)
- **Study notes**: per-lesson notes + timestamps/bookmarks
- **Export/Import**: move your progress/notes between devices (JSON)
- **Free + no account**: everything stored in your browser (localStorage)

## Pages (local)

- Home: `http://localhost:3000/`
- Dashboard: `http://localhost:3000/dashboard.html`
- Course: `http://localhost:3000/course.html?list=PLAYLIST_ID`
- About: `http://localhost:3000/about.html`

## Requirements

- Node.js 18+ (this uses built-in `fetch`)
- A YouTube Data API v3 key

## Quick Start (local)

1) Create a YouTube Data API key (Google Cloud Console) and enable **YouTube Data API v3**.
2) Set an env var:

PowerShell:
```powershell
$env:YT_API_KEY="YOUR_KEY"
```

3) Run:
```powershell
node server.mjs
```

Open `http://localhost:3000`.

## Deploy (Render)

This repo includes a `render.yaml` Blueprint and a `Dockerfile`.

1) Push this project to GitHub.
2) In Render: **New** → **Blueprint** → select your repo.
3) Add the `YT_API_KEY` environment variable in Render (keep it secret).
4) Deploy and open:
- `/` (home)
- `/dashboard.html` (dashboard)
- `/api/health` (health check)

## Dev (auto-reload)

```powershell
node --watch server.mjs
```

## Privacy

- No accounts.
- Progress, notes, and saved courses live in your browser (localStorage).
- Use **Export/Import** from the dashboard to move data between devices.

## Notes / production

- The server keeps the API key secret and caches playlist responses for 10 minutes.
- Basic rate limiting is enabled on `/api/*`.
- Some videos cannot be embedded (uploader restrictions). Use **Open YouTube** in the course when that happens.

## Deploy checklist (quick)

- Set `YT_API_KEY` as a secret in your host (Render/Fly/Railway/VPS).
- Set `PORT` if your host requires it (default: `3000`).
- Restrict the API key in Google Cloud Console (recommended): only enable **YouTube Data API v3**, and scope usage as tightly as possible.
- Expect quota limits: large playlists and frequent imports will consume YouTube API quota.

## Roadmap (nice-to-have)

- Better “resume” (seek to last watched timestamp automatically)
- Optional course sharing page (view-only, no progress sync)
- Better lesson metadata (durations shown everywhere, sorting, etc.)
