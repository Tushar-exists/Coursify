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

## How It Works

1) Paste a YouTube playlist link  
2) Coursify builds a course view (lessons + player)  
3) Watch, take notes, and track progress — distraction-free

## How To Use

- **Import**: open the Dashboard and paste a playlist URL
- **Study**: use Prev/Next, mark lessons done, and add timestamps to your notes
- **Resume**: come back anytime — progress is saved on this device
- **Move to another device**: Dashboard → Export on one device, Import on another

## Privacy

- No accounts.
- Progress, notes, and saved courses are stored locally in your browser (localStorage).
- Export/Import is optional and stays on your device (it downloads/uploads a JSON file).

## Limitations

- Some videos cannot be embedded (uploader restrictions). Use **Open YouTube** in the course when that happens.
- Playlist imports depend on YouTube Data API quota limits.

## Self-hosting (optional)

Coursify is a small Node server + static frontend.

- Requirements: Node.js 18+ and a YouTube Data API v3 key
- Set `YT_API_KEY` as an environment variable
- Start: `node server.mjs`

If you’re deploying to Render, this repo includes `render.yaml` + a `Dockerfile`.
