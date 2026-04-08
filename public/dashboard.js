function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, String(v));
  }
  for (const c of children) node.appendChild(c);
  return node;
}

function toast(kind, title, msg) {
  const host = document.getElementById("toastHost");
  const t = el("div", { class: `toast ${kind}` }, [
    el("div", { class: "toastTitle", text: title }),
    el("div", { class: "toastMsg", text: msg })
  ]);
  host.appendChild(t);
  window.setTimeout(() => t.classList.add("in"), 10);
  window.setTimeout(() => {
    t.classList.remove("in");
    window.setTimeout(() => t.remove(), 180);
  }, 3200);
}

function setMsg(mountId, kind, text) {
  const mount = document.getElementById(mountId);
  mount.innerHTML = "";
  if (!text) return;
  mount.appendChild(el("div", { class: kind === "error" ? "alert alertErr" : "alert alertOk", text }));
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

function coursesKey() {
  return "ytcourse:courses";
}

function progressKey(playlistId) {
  return `ytcourse:progress:${playlistId}`;
}

function settingsKey() {
  return "ytcourse:settings";
}

function notesKeyPrefix() {
  return "ytcourse:notes:";
}

function dataExportVersion() {
  return 1;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function collectNotesForPlaylists(playlistIds) {
  const out = {};
  for (const pid of playlistIds) out[pid] = {};

  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(notesKeyPrefix())) continue;
    const parts = k.split(":"); // ytcourse:notes:<playlistId>:<videoId>
    const playlistId = parts[2] ?? "";
    const videoId = parts.slice(3).join(":") ?? "";
    if (!playlistId || !videoId || !out[playlistId]) continue;
    out[playlistId][videoId] = localStorage.getItem(k) ?? "";
  }
  return out;
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function mergeCourses(importedCourses) {
  const current = loadCourses();
  const byId = new Map(current.map((c) => [c.playlistId, c]));
  for (const c of importedCourses) {
    if (!c?.playlistId) continue;
    const prev = byId.get(c.playlistId);
    if (!prev) {
      byId.set(c.playlistId, c);
    } else {
      byId.set(c.playlistId, {
        ...prev,
        ...c,
        createdAt: prev.createdAt ?? c.createdAt,
        updatedAt: Math.max(prev.updatedAt ?? 0, c.updatedAt ?? 0)
      });
    }
  }
  const merged = Array.from(byId.values());
  saveCourses(merged);
}

function mergeProgress(progressByPlaylist) {
  for (const [playlistId, pr] of Object.entries(progressByPlaylist ?? {})) {
    if (!playlistId || !pr) continue;
    const key = progressKey(playlistId);
    const current = safeJsonParse(localStorage.getItem(key) ?? "") ?? {};
    const next = {
      ...current,
      ...pr,
      completed: Array.isArray(pr.completed)
        ? Array.from(new Set([...(Array.isArray(current.completed) ? current.completed : []), ...pr.completed]))
        : current.completed
    };
    localStorage.setItem(key, JSON.stringify(next));
  }
}

function mergeNotes(notesByPlaylist) {
  for (const [playlistId, videos] of Object.entries(notesByPlaylist ?? {})) {
    if (!playlistId || !videos) continue;
    for (const [videoId, raw] of Object.entries(videos ?? {})) {
      if (!videoId) continue;
      const k = `${notesKeyPrefix()}${playlistId}:${videoId}`;
      if (!localStorage.getItem(k)) localStorage.setItem(k, String(raw ?? ""));
    }
  }
}

function importSettings(rawSettings) {
  if (!rawSettings) return;
  const cur = safeJsonParse(localStorage.getItem(settingsKey()) ?? "") ?? {};
  localStorage.setItem(settingsKey(), JSON.stringify({ ...cur, ...rawSettings }));
}

function loadProgress(playlistId) {
  try {
    const raw = localStorage.getItem(progressKey(playlistId));
    if (!raw) return { completed: [] };
    const json = JSON.parse(raw);
    return {
      completed: Array.isArray(json.completed) ? json.completed : [],
      lastVideoId: typeof json.lastVideoId === "string" ? json.lastVideoId : null
    };
  } catch {
    return { completed: [], lastVideoId: null };
  }
}

function loadCourses() {
  try {
    const raw = localStorage.getItem(coursesKey());
    const json = raw ? JSON.parse(raw) : [];
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

function saveCourses(courses) {
  localStorage.setItem(coursesKey(), JSON.stringify(courses));
}

function upsertCourse(c) {
  const courses = loadCourses();
  const idx = courses.findIndex((x) => x.playlistId === c.playlistId);
  const now = Date.now();
  const next = {
    playlistId: c.playlistId,
    title: c.title ?? "Untitled",
    videoCount: c.videoCount ?? 0,
    createdAt: idx >= 0 ? courses[idx].createdAt : now,
    updatedAt: now
  };
  if (idx >= 0) courses[idx] = next;
  else courses.unshift(next);
  saveCourses(courses);
  return next;
}

function removeCourse(playlistId) {
  const courses = loadCourses().filter((c) => c.playlistId !== playlistId);
  saveCourses(courses);
}

function pct(done, total) {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

async function fetchPlaylist(playlistId) {
  const res = await fetch(`/api/playlist?id=${encodeURIComponent(playlistId)}`, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? "Failed to load playlist");
  return json;
}

let sortMode = "recent"; // recent | name | progress
let searchQuery = "";

function setSortButtons() {
  document.getElementById("sortRecentBtn").classList.toggle("active", sortMode === "recent");
  document.getElementById("sortNameBtn").classList.toggle("active", sortMode === "name");
  document.getElementById("sortProgressBtn").classList.toggle("active", sortMode === "progress");
}

function getSortedCourses(courses) {
  const list = [...courses];
  if (sortMode === "name") list.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
  if (sortMode === "recent") list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  if (sortMode === "progress") {
    const doneById = new Map();
    for (const c of list) doneById.set(c.playlistId, loadProgress(c.playlistId)?.completed?.length ?? 0);
    list.sort((a, b) => {
      const pa = doneById.get(a.playlistId) ?? 0;
      const pb = doneById.get(b.playlistId) ?? 0;
      return pb - pa;
    });
  }
  return list;
}

function render() {
  const cards = document.getElementById("cards");
  const meta = document.getElementById("cardsMeta");
  const empty = document.getElementById("empty");
  cards.innerHTML = "";

  const all = loadCourses();
  const q = searchQuery.trim().toLowerCase();
  const filtered = all.filter((c) => (c.title ?? "").toLowerCase().includes(q));
  const list = getSortedCourses(filtered);

  meta.textContent = `${list.length} course${list.length === 1 ? "" : "s"}`;
  empty.style.display = list.length === 0 ? "" : "none";

  const frag = document.createDocumentFragment();
  for (const c of list) {
    const pr = loadProgress(c.playlistId);
    const done = pr?.completed?.length ?? 0;
    const total = c.videoCount ?? 0;
    const p = pct(done, total);

    const card = el("div", { class: "courseCard" }, [
      el("div", { class: "courseTop" }, [
        el("div", { class: "courseTitle2", text: c.title ?? "Untitled course" }),
        el("div", { class: "chip", text: `${total} lessons` })
      ]),
      el("div", { class: "courseMeta" }, [
        el("div", { class: "muted", text: `${done}/${total} completed` }),
        el("div", { class: "muted", text: `${p}%` })
      ]),
      el("div", { class: "progressBar2" }, [el("div", { style: `width:${p}%` })]),
      el("div", { class: "courseActions" }, [
        el(
          "a",
          { class: "btnGhost", href: `/course.html?list=${encodeURIComponent(c.playlistId)}` },
          [document.createTextNode("Open")]
        ),
        el(
          "a",
          {
            class: "btnGhost",
            href:
              pr?.lastVideoId
                ? `/course.html?list=${encodeURIComponent(c.playlistId)}#v=${encodeURIComponent(pr.lastVideoId)}`
                : `/course.html?list=${encodeURIComponent(c.playlistId)}`
          },
          [document.createTextNode(pr?.lastVideoId ? "Resume" : "Start")]
        ),
        el("button", {
          class: "btnGhost",
          text: "Copy link",
          onclick: async () => {
            const url = `${window.location.origin}/course.html?list=${encodeURIComponent(c.playlistId)}`;
            try {
              await navigator.clipboard.writeText(url);
              toast("ok", "Copied", "Course link copied to clipboard.");
            } catch {
              toast("err", "Copy failed", "Could not copy to clipboard.");
            }
          }
        }),
        el("button", {
          class: "btnGhost btnDanger",
          text: "Remove",
          onclick: () => {
            if (!window.confirm("Remove this course from your dashboard?")) return;
            removeCourse(c.playlistId);
            toast("ok", "Removed", "Course removed.");
            render();
          }
        })
      ])
    ]);
    frag.appendChild(card);
  }
  cards.appendChild(frag);
}

async function onImport() {
  const input = document.getElementById("playlistInput");
  const btn = document.getElementById("importBtn");
  const playlistId = extractPlaylistId(input.value);
  if (!playlistId) {
    setMsg("importMsg", "error", "Paste a valid YouTube playlist link (with ?list=...).");
    return;
  }

  btn.disabled = true;
  btn.classList.add("loading");
  setMsg("importMsg", null, "");
  try {
    const data = await fetchPlaylist(playlistId);
    const c = upsertCourse({
      playlistId,
      title: data.title,
      videoCount: Array.isArray(data.videos) ? data.videos.length : 0
    });
    toast("ok", "Imported", `Saved “${c.title}”.`);
    input.value = "";
    render();
  } catch (e) {
    setMsg("importMsg", "error", e?.message ?? "Failed to import playlist.");
  } finally {
    btn.disabled = false;
    btn.classList.remove("loading");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setSortButtons();
  render();

  document.getElementById("importBtn").addEventListener("click", onImport);
  document.getElementById("playlistInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") onImport();
  });

  document.getElementById("courseSearch").addEventListener("input", (e) => {
    searchQuery = e.target.value ?? "";
    render();
  });

  document.getElementById("sortRecentBtn").addEventListener("click", () => {
    sortMode = "recent";
    setSortButtons();
    render();
  });
  document.getElementById("sortNameBtn").addEventListener("click", () => {
    sortMode = "name";
    setSortButtons();
    render();
  });
  document.getElementById("sortProgressBtn").addEventListener("click", () => {
    sortMode = "progress";
    setSortButtons();
    render();
  });

  document.getElementById("exportBtn").addEventListener("click", () => {
    const courses = loadCourses();
    const playlistIds = courses.map((c) => c.playlistId).filter(Boolean);
    const progressByPlaylist = {};
    for (const pid of playlistIds) {
      progressByPlaylist[pid] = safeJsonParse(localStorage.getItem(progressKey(pid)) ?? "") ?? {};
    }
    const notesByPlaylist = collectNotesForPlaylists(playlistIds);
    const settings = safeJsonParse(localStorage.getItem(settingsKey()) ?? "") ?? {};

    downloadJson(`playlist-to-course-export.json`, {
      type: "playlist-to-course-export",
      version: dataExportVersion(),
      exportedAt: new Date().toISOString(),
      courses,
      progressByPlaylist,
      notesByPlaylist,
      settings
    });
    toast("ok", "Exported", "Downloaded your data as JSON.");
  });

  document.getElementById("importFile").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const text = await f.text();
      const json = safeJsonParse(text);
      if (!json || json.type !== "playlist-to-course-export") throw new Error("Invalid export file.");
      mergeCourses(Array.isArray(json.courses) ? json.courses : []);
      mergeProgress(json.progressByPlaylist ?? {});
      mergeNotes(json.notesByPlaylist ?? {});
      importSettings(json.settings ?? {});
      toast("ok", "Imported", "Your data has been imported.");
      render();
    } catch (err) {
      toast("err", "Import failed", err?.message ?? "Could not import file.");
    }
  });
});
