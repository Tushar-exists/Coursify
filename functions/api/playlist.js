const playlistCache = new Map(); // playlistId -> { expiresAt:number, data:any }
const rateLimits = new Map(); // ip -> { resetAt:number, count:number }

function json(data, init = {}) {
  const body = JSON.stringify(data);
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(body, { ...init, headers });
}

function getClientIp(request) {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp;
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
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

async function getPlaylistData({ playlistId, apiKey }) {
  const cached = playlistCache.get(playlistId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.data;

  const safeApiKey = encodeURIComponent(apiKey);

  const playlistMetaUrl =
    "https://www.googleapis.com/youtube/v3/playlists" +
    `?part=snippet&id=${encodeURIComponent(playlistId)}` +
    `&key=${safeApiKey}`;

  const metaJson = await fetchYouTubeJson(playlistMetaUrl);
  const playlistTitle = metaJson?.items?.[0]?.snippet?.title ?? "Untitled playlist";

  const videos = [];
  let pageToken = "";

  for (let page = 0; page < 50; page += 1) {
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
    // Best-effort enrichment; still return base playlist items.
  }

  playlistCache.set(playlistId, { expiresAt: now + 10 * 60 * 1000, data });
  return data;
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, { status: 405 });

  const ip = getClientIp(request);
  if (!rateLimitOk(ip)) return json({ error: "Rate limit exceeded. Try again soon." }, { status: 429 });

  const apiKey = env?.YT_API_KEY ?? "";
  if (!apiKey) return json({ error: "Missing YT_API_KEY on the server." }, { status: 500 });

  const url = new URL(request.url);
  const input = url.searchParams.get("url") ?? url.searchParams.get("id") ?? "";
  const playlistId = extractPlaylistId(input);
  if (!playlistId) return json({ error: "Invalid playlist URL or ID." }, { status: 400 });

  try {
    const data = await getPlaylistData({ playlistId, apiKey });
    return json(data, { status: 200 });
  } catch (e) {
    return json({ error: e?.message ?? "Failed to fetch playlist." }, { status: 500 });
  }
}

