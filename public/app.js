function $(id) {
  return document.getElementById(id);
}

function extractPlaylistId(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed) && !trimmed.includes("http")) return trimmed;
  try {
    const u = new URL(trimmed);
    const list = u.searchParams.get("list");
    if (list) return list;
  } catch {
    // ignore
  }
  const match = trimmed.match(/[?&]list=([^&]+)/);
  return match?.[1] ?? null;
}

async function validatePlaylist(playlistId) {
  const res = await fetch(`/api/playlist?id=${encodeURIComponent(playlistId)}`, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? "Failed to load playlist");
  return json;
}

function setMsg(kind, text) {
  const msg = $("msg");
  msg.innerHTML = "";
  if (!text) return;
  const div = document.createElement("div");
  div.className = kind === "error" ? "alert alertErr" : "alert alertOk";
  div.textContent = text;
  msg.appendChild(div);
}

async function onCreate() {
  const input = $("playlistInput").value;
  const playlistId = extractPlaylistId(input);
  if (!playlistId) {
    setMsg("error", "Paste a valid YouTube playlist URL (with ?list=...).");
    return;
  }

  const btn = $("createBtn");
  btn.disabled = true;
  btn.classList.add("loading");
  btn.setAttribute("aria-busy", "true");
  setMsg(null, "");
  try {
    const data = await validatePlaylist(playlistId);
    const count = Array.isArray(data.videos) ? data.videos.length : 0;
    // Save course to dashboard (local device)
    try {
      const key = "ytcourse:courses";
      const raw = localStorage.getItem(key);
      const courses = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(courses) ? courses : [];
      const now = Date.now();
      const idx = list.findIndex((c) => c?.playlistId === playlistId);
      const entry = {
        playlistId,
        title: data.title ?? "Untitled",
        videoCount: count,
        createdAt: idx >= 0 ? (list[idx].createdAt ?? now) : now,
        updatedAt: now
      };
      if (idx >= 0) list[idx] = entry;
      else list.unshift(entry);
      localStorage.setItem(key, JSON.stringify(list));
    } catch {
      // ignore
    }
    setMsg("ok", `Loaded “${data.title}” (${count} videos). Opening course…`);
    window.location.href = `/course.html?list=${encodeURIComponent(playlistId)}`;
  } catch (e) {
    setMsg("error", e?.message ?? "Failed to import playlist.");
  } finally {
    btn.disabled = false;
    btn.classList.remove("loading");
    btn.removeAttribute("aria-busy");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("createBtn").addEventListener("click", onCreate);
  $("playlistInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") onCreate();
  });
});
