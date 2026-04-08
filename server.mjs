import { createServer } from "node:http";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const PUBLIC_DIR = path.join(__dirname, "public");
const YT_API_KEY = process.env.YT_API_KEY ?? "";

const playlistCache = new Map(); // playlistId -> { expiresAt:number, data:any }
const rateLimits = new Map(); // ip -> { resetAt:number, count:number }

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(text);
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' https://i.ytimg.com data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' https://www.youtube.com https://www.gstatic.com",
      "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
      "connect-src 'self'"
    ].join("; ")
  );
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

function rateLimitOk(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 120;
  const entry = rateLimits.get(ip);
  if (!entry || entry.resetAt <= now) {
    rateLimits.set(ip, { resetAt: now + windowMs, count: 1 });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count += 1;
  return true;
}

function extractPlaylistId(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed) && !trimmed.includes("http")) return trimmed;
  try {
    const u = new URL(trimmed);
    const list = u.searchParams.get("list");
    if (list) return list;
    const match = trimmed.match(/[?&]list=([^&]+)/);
    return match?.[1] ?? null;
  } catch {
    const match = trimmed.match(/[?&]list=([^&]+)/);
    return match?.[1] ?? null;
  }
}

async function fetchYouTubeJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`YouTube API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function getPlaylistData(playlistId) {
  const cached = playlistCache.get(playlistId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.data;

  if (!YT_API_KEY) throw new Error("Missing YT_API_KEY on the server.");

  const safeApiKey = encodeURIComponent(YT_API_KEY);

  const playlistMetaUrl =
    "https://www.googleapis.com/youtube/v3/playlists" +
    `?part=snippet&id=${encodeURIComponent(playlistId)}` +
    `&key=${safeApiKey}`;

  const metaJson = await fetchYouTubeJson(playlistMetaUrl);
  const playlistTitle = metaJson?.items?.[0]?.snippet?.title ?? "Untitled playlist";

  const videos = [];
  let pageToken = "";
  for (let i = 0; i < 50; i += 1) {
    const playlistItemsUrl =
      "https://www.googleapis.com/youtube/v3/playlistItems" +
      `?part=snippet,contentDetails&maxResults=50&playlistId=${encodeURIComponent(playlistId)}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "") +
      `&key=${safeApiKey}`;

    const json = await fetchYouTubeJson(playlistItemsUrl);
    const items = Array.isArray(json.items) ? json.items : [];

    for (const item of items) {
      const videoId = item?.contentDetails?.videoId;
      const title = item?.snippet?.title ?? "";
      if (!videoId || title === "Private video" || title === "Deleted video") continue;
      videos.push({
        videoId,
        title,
        position: item?.snippet?.position ?? videos.length,
        thumbnail:
          item?.snippet?.thumbnails?.medium?.url ??
          item?.snippet?.thumbnails?.default?.url ??
          null
      });
    }

    pageToken = json.nextPageToken ?? "";
    if (!pageToken) break;
  }

  const data = { playlistId, title: playlistTitle, videos };

  // Enrich with durations/channel using videos.list (batch 50) — improves UX and progress tracking.
  try {
    const ids = videos.map((v) => v.videoId).filter(Boolean);
    const metaById = new Map();
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const url =
        "https://www.googleapis.com/youtube/v3/videos" +
        `?part=contentDetails,snippet&id=${encodeURIComponent(batch.join(","))}` +
        `&key=${safeApiKey}`;
      const json = await fetchYouTubeJson(url);
      const items = Array.isArray(json.items) ? json.items : [];
      for (const item of items) {
        const id = item?.id;
        if (!id) continue;
        metaById.set(id, {
          duration: item?.contentDetails?.duration ?? null,
          channelTitle: item?.snippet?.channelTitle ?? null,
          publishedAt: item?.snippet?.publishedAt ?? null
        });
      }
    }
    for (const v of videos) {
      const meta = metaById.get(v.videoId);
      if (!meta) continue;
      v.duration = meta.duration;
      v.channelTitle = meta.channelTitle;
      v.publishedAt = meta.publishedAt;
    }
  } catch {
    // If enrichment fails, still return the base playlist items.
  }

  playlistCache.set(playlistId, { expiresAt: now + 10 * 60 * 1000, data });
  return data;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

async function serveStatic(req, res, pathname) {
  let safePath = pathname;
  if (safePath === "/") safePath = "/index.html";

  const resolved = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendText(res, 400, "Bad path");
    return;
  }

  try {
    const s = await stat(resolved);
    if (!s.isFile()) {
      sendText(res, 404, "Not found");
      return;
    }

    const etag = `W/"${s.size}-${Math.trunc(s.mtimeMs)}"`;
    res.setHeader("ETag", etag);
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304);
      res.end();
      return;
    }

    const buf = await readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const cacheControl =
      ext === ".html"
        ? "no-store"
        : ext === ".css" || ext === ".js"
          ? "public, max-age=0, must-revalidate"
          : "public, max-age=604800";

    res.writeHead(200, {
      "Content-Type": contentTypeFor(resolved),
      "Cache-Control": cacheControl
    });
    res.end(buf);
  } catch {
    sendText(res, 404, "Not found");
  }
}

process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("unhandledRejection", reason);
});
process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("uncaughtException", err);
  process.exit(1);
});

const server = createServer(async (req, res) => {
  setSecurityHeaders(res);
  res.setHeader("Server", "yt-playlist-courses");

  const ip = getClientIp(req);
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  if (pathname.startsWith("/api/")) {
    if (!rateLimitOk(ip)) {
      sendJson(res, 429, { error: "Rate limit exceeded. Try again soon." });
      return;
    }

    if (pathname === "/api/health") {
      sendJson(res, 200, { ok: true, time: new Date().toISOString() });
      return;
    }

    if (pathname === "/api/playlist" && req.method === "GET") {
      const input = url.searchParams.get("url") ?? url.searchParams.get("id") ?? "";
      const playlistId = extractPlaylistId(input);
      if (!playlistId) {
        sendJson(res, 400, { error: "Invalid playlist URL or ID." });
        return;
      }
      try {
        const data = await getPlaylistData(playlistId);
        sendJson(res, 200, data);
      } catch (e) {
        sendJson(res, 500, { error: e?.message ?? "Failed to fetch playlist." });
      }
      return;
    }

    sendJson(res, 404, { error: "Not found" });
    return;
  }

  await serveStatic(req, res, pathname);
});

server.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("server error", err);
  process.exit(1);
});

// Listen on IPv6 any; typically accepts IPv4 too (v4-mapped), improving edge connectivity.
server.listen(PORT, "::", () => {
  console.log(`Server running on port ${PORT} (node ${process.version})`);
});
