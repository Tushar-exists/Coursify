# Coursify

Turn YouTube playlists into **focused courses** for studying — with a clean syllabus, progress, and notes.

<p align="center">
  <img src="public/assets/coursify-readme.png" alt="Coursify" width="720" />
</p>

## Features

- **Dashboard**: save courses on-device
- **Course player**: clean syllabus + Prev/Next + focus mode
- **Progress tracking**: completion + watch % (saved locally)
- **Study notes**: per-lesson notes + timestamps/bookmarks
- **Export/Import**: move your progress/notes between devices (JSON)
- **Free + no account**: everything stored in your browser (localStorage)

## How to use

1) Paste a YouTube playlist link
2) Coursify builds a course view (lessons + player)
3) Watch, take notes, and track progress — distraction-free

## Privacy

- No accounts.
- Progress, notes, and saved courses are stored locally in your browser (localStorage).
- Export/Import stays on your device (download/upload a JSON file).

## Limitations

- Some videos can’t be embedded (uploader restrictions). Use **Open YouTube** in the course when that happens.
- Playlist imports depend on YouTube Data API quota limits.

## Deploy (free) on Cloudflare Pages

Cloudflare Pages is the recommended free host (fast, always-on; no cold-start “server down” issues).

1) Cloudflare Dashboard → **Workers & Pages** → **Create application** → **Pages**
2) Connect this GitHub repo
3) Build settings:
   - Framework preset: **None**
   - Build command: *(empty)*
   - Output directory: `public`
4) In **Settings → Environment variables**, add `YT_API_KEY`
5) Redeploy and open your Pages URL

## Self-hosting (optional)

Coursify also runs as a small Node server + static frontend.

- Requirements: Node.js 18+ and a YouTube Data API v3 key
- Set `YT_API_KEY` as an environment variable
- Start: `node server.mjs`

