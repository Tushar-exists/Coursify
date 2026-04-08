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

function getQuery() {
  const u = new URL(window.location.href);
  return {
    list: u.searchParams.get("list") ?? "",
    url: u.searchParams.get("url") ?? ""
  };
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

function progressKey(playlistId) {
  return `ytcourse:progress:${playlistId}`;
}

function loadProgress(playlistId) {
  try {
    const raw = localStorage.getItem(progressKey(playlistId));
    if (!raw) return { completed: [], lastVideoId: null };
    const json = JSON.parse(raw);
    return {
      completed: Array.isArray(json.completed) ? json.completed : [],
      lastVideoId: typeof json.lastVideoId === "string" ? json.lastVideoId : null,
      watchedById: json && typeof json.watchedById === "object" && json.watchedById ? json.watchedById : {}
    };
  } catch {
    return { completed: [], lastVideoId: null, watchedById: {} };
  }
}

function saveProgress(playlistId, progress) {
  localStorage.setItem(progressKey(playlistId), JSON.stringify(progress));
}

function setErr(text) {
  const mount = document.getElementById("err");
  mount.innerHTML = "";
  if (!text) return;
  mount.appendChild(el("div", { class: "alert alertErr", text }));
}

function toast(kind, title, msg) {
  const host = document.getElementById("toastHost");
  if (!host) return;
  const t = el("div", { class: `toast ${kind}` }, [
    el("div", { class: "toastTitle", text: title }),
    el("div", { class: "toastMsg", text: msg })
  ]);
  host.appendChild(t);
  window.setTimeout(() => t.classList.add("in"), 10);
  window.setTimeout(() => {
    t.classList.remove("in");
    window.setTimeout(() => t.remove(), 180);
  }, 2600);
}

function setLoading(show) {
  document.getElementById("loading").style.display = show ? "" : "none";
  document.getElementById("course").style.display = show ? "none" : "";
}

let ytPlayer = null;
let currentPlaylistId = null;
let courseData = null;
let progress = null;
let currentVideoId = null;
let videoOrder = [];
let videoIndexById = new Map();
let videoNodesById = new Map(); // videoId -> { item, badge }
let filterMode = "all"; // all | todo
let searchQuery = "";
let visibleLessons = null;
let notesTimer = null;
let watchTimer = null;
let lastWatchPersistAt = 0;
let playbackRate = 1;
let focusMode = false;
let sideCollapsed = false;
let currentNotesData = null;

function settingsKey() {
  return "ytcourse:settings";
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(settingsKey());
    const json = raw ? JSON.parse(raw) : {};
    const rate = Number.parseFloat(json.playbackRate ?? "1");
    playbackRate = Number.isFinite(rate) ? rate : 1;
    focusMode = Boolean(json.focusMode);
    sideCollapsed = Boolean(json.sideCollapsed);
  } catch {
    playbackRate = 1;
    focusMode = false;
    sideCollapsed = false;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(settingsKey(), JSON.stringify({ playbackRate, focusMode, sideCollapsed }));
  } catch {
    // ignore
  }
}

function applyLayoutState() {
  const side = document.getElementById("sidePanel");
  const notes = document.querySelector(".notePanel");
  const courseShell = document.getElementById("course");

  const effectiveCollapsed = focusMode ? true : sideCollapsed;
  if (side) side.classList.toggle("collapsed", effectiveCollapsed);
  if (courseShell) courseShell.classList.toggle("sideCollapsed", effectiveCollapsed);
  if (notes) notes.classList.toggle("hidden", focusMode);

  const btn = document.getElementById("focusBtn");
  if (btn) btn.classList.toggle("active", focusMode);

  const toggle = document.getElementById("sideToggleBtn");
  if (toggle) {
    toggle.title = effectiveCollapsed ? "Expand syllabus" : "Collapse syllabus";
    toggle.setAttribute("aria-label", effectiveCollapsed ? "Expand syllabus" : "Collapse syllabus");
  }
}

function notesKey(playlistId, videoId) {
  return `ytcourse:notes:${playlistId}:${videoId}`;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function parseIso8601DurationToSeconds(iso) {
  if (!iso || typeof iso !== "string") return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const h = Number.parseInt(m[1] ?? "0", 10);
  const min = Number.parseInt(m[2] ?? "0", 10);
  const sec = Number.parseInt(m[3] ?? "0", 10);
  if (!Number.isFinite(h) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
  return h * 3600 + min * 60 + sec;
}

function loadNotesData(playlistId, videoId) {
  try {
    const raw = localStorage.getItem(notesKey(playlistId, videoId));
    if (!raw) return { text: "", bookmarks: [] };
    const json = safeJsonParse(raw);
    if (json === null) return { text: raw, bookmarks: [] }; // back-compat
    return {
      text: typeof json.text === "string" ? json.text : "",
      bookmarks: Array.isArray(json.bookmarks) ? json.bookmarks : []
    };
  } catch {
    return { text: "", bookmarks: [] };
  }
}

function saveNotesDataDebounced(playlistId, videoId, data) {
  if (notesTimer) window.clearTimeout(notesTimer);
  notesTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(notesKey(playlistId, videoId), JSON.stringify(data));
    } catch {
      // ignore
    }
  }, 250);
}

function renderBookmarks() {
  const wrap = document.getElementById("bookmarks");
  if (!wrap) return;
  wrap.innerHTML = "";

  const bookmarks = currentNotesData?.bookmarks ?? [];
  if (!currentPlaylistId || !currentVideoId || bookmarks.length === 0) {
    wrap.style.display = "none";
    return;
  }

  wrap.style.display = "";
  const frag = document.createDocumentFragment();
  for (let i = 0; i < bookmarks.length; i += 1) {
    const b = bookmarks[i];
    const t = Number(b.t ?? 0);
    const label = typeof b.label === "string" ? b.label : formatTime(t);

    const row = el("div", { class: "bmRow" }, [
      el(
        "button",
        {
          class: "bmTime",
          text: label,
          onclick: () => {
            if (!ytPlayer || !Number.isFinite(t)) return;
            try {
              ytPlayer.seekTo(t, true);
            } catch {
              // ignore
            }
          }
        },
        []
      ),
      el("div", { class: "bmText", text: typeof b.text === "string" ? b.text : "" }),
      el("button", {
        class: "bmDel",
        text: "×",
        title: "Remove",
        onclick: () => {
          if (!currentNotesData) return;
          currentNotesData.bookmarks = currentNotesData.bookmarks.filter((_, idx) => idx !== i);
          saveNotesDataDebounced(currentPlaylistId, currentVideoId, currentNotesData);
          renderBookmarks();
        }
      })
    ]);
    frag.appendChild(row);
  }
  wrap.appendChild(frag);
}

function computePct() {
  const total = courseData?.videos?.length ?? 0;
  const done = progress?.completed?.length ?? 0;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function refreshProgressUI() {
  const pct = computePct();
  document.getElementById("pct").textContent = `${pct}%`;
  document.getElementById("barFill").style.width = `${pct}%`;
}

function isDone(videoId) {
  return progress.completed.includes(videoId);
}

function watchedPct(videoId) {
  const w = progress?.watchedById?.[videoId];
  if (!w) return 0;
  const d = Number(w.durationSeconds ?? 0);
  const t = Number(w.watchedSeconds ?? 0);
  if (!Number.isFinite(d) || d <= 0 || !Number.isFinite(t) || t <= 0) return 0;
  return clamp(t / d, 0, 1);
}

function setDone(videoId, done) {
  const set = new Set(progress.completed);
  if (done) set.add(videoId);
  else set.delete(videoId);
  progress.completed = Array.from(set);
  progress.lastVideoId = videoId;
  saveProgress(currentPlaylistId, progress);
}

function updateWatch(videoId, currentTimeSeconds, durationSeconds) {
  if (!progress.watchedById) progress.watchedById = {};
  const cur = progress.watchedById[videoId] ?? {};
  const watchedSeconds = Math.max(Number(cur.watchedSeconds ?? 0), Number(currentTimeSeconds ?? 0));
  const next = {
    watchedSeconds: Number.isFinite(watchedSeconds) ? watchedSeconds : 0,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : Number(cur.durationSeconds ?? 0),
    lastTimeSeconds: Number.isFinite(Number(currentTimeSeconds ?? 0)) ? Number(currentTimeSeconds ?? 0) : 0,
    updatedAt: Date.now()
  };
  progress.watchedById[videoId] = next;

  const pct = watchedPct(videoId);
  if (pct >= 0.9 && !isDone(videoId)) {
    // Mark complete when mostly watched.
    const set = new Set(progress.completed);
    set.add(videoId);
    progress.completed = Array.from(set);
  }
}

function persistProgressThrottled(force = false) {
  const now = Date.now();
  if (!force && now - lastWatchPersistAt < 5000) return;
  lastWatchPersistAt = now;
  saveProgress(currentPlaylistId, progress);
}

function startWatchPolling() {
  if (watchTimer) window.clearInterval(watchTimer);
  watchTimer = window.setInterval(() => {
    if (!ytPlayer || !currentPlaylistId || !currentVideoId || !progress) return;
    let t = 0;
    let d = 0;
    try {
      t = Number(ytPlayer.getCurrentTime?.() ?? 0);
      d = Number(ytPlayer.getDuration?.() ?? 0);
    } catch {
      return;
    }
    if (!Number.isFinite(t) || t < 0) return;
    if (!Number.isFinite(d) || d <= 0) return;
    updateWatch(currentVideoId, t, d);
    persistProgressThrottled(false);
    updateListBadgesAndActive();
    setMetaText();
    refreshProgressUI();
  }, 3000);
}

function stopWatchPolling() {
  if (!watchTimer) return;
  window.clearInterval(watchTimer);
  watchTimer = null;
}

function updateToggleDoneButton() {
  const btn = document.getElementById("toggleDoneBtn");
  if (!currentVideoId) {
    btn.disabled = true;
    btn.textContent = "Mark done";
    const copyBtn = document.getElementById("copyLessonBtn");
    if (copyBtn) copyBtn.disabled = true;
    const stampBtn = document.getElementById("addStampBtn");
    if (stampBtn) stampBtn.disabled = true;
    const openYt = document.getElementById("openYtBtn");
    if (openYt) openYt.setAttribute("aria-disabled", "true");
    return;
  }
  btn.disabled = false;
  btn.textContent = isDone(currentVideoId) ? "Mark not done" : "Mark done";
  const copyBtn = document.getElementById("copyLessonBtn");
  if (copyBtn) copyBtn.disabled = false;
  const stampBtn = document.getElementById("addStampBtn");
  if (stampBtn) stampBtn.disabled = false;
  const openYt = document.getElementById("openYtBtn");
  if (openYt) openYt.setAttribute("aria-disabled", "false");
}

function buildList() {
  const list = document.getElementById("list");
  list.innerHTML = "";
  videoNodesById = new Map();
  videoIndexById = new Map();

  const videos = courseData?.videos ?? [];
  videoOrder = videos.map((v) => v.videoId);
  for (let i = 0; i < videoOrder.length; i += 1) videoIndexById.set(videoOrder[i], i);

  if (videos.length === 0) {
    list.appendChild(
      el("div", { class: "alert alertOk", text: "No playable videos found in this playlist." })
    );
    return;
  }

  const frag = document.createDocumentFragment();
  for (let idx = 0; idx < videos.length; idx += 1) {
    const v = videos[idx];

    const badge = el("div", { class: "statusPill", text: "Todo" });
    const item = el(
      "div",
      {
        class: "lessonItem",
        tabindex: "0",
        role: "button",
        "data-video-id": v.videoId,
        "data-title": (v.title ?? "").toLowerCase()
      },
      [
        el("div", { class: "thumb" }, [
          v.thumbnail ? el("img", { src: v.thumbnail, alt: "" }) : el("div", {})
        ]),
        el("div", { class: "meta" }, [
          el("p", { class: "title", text: v.title }),
          el("p", {
            class: "subt",
            text: `Lesson ${idx + 1} of ${videos.length}${
              v.duration ? ` • ${formatTime(parseIso8601DurationToSeconds(v.duration) ?? 0)}` : ""
            }`
          })
        ]),
        badge
      ]
    );

    videoNodesById.set(v.videoId, { item, badge });
    frag.appendChild(item);
  }
  list.appendChild(frag);
}

function updateListBadgesAndActive() {
  for (const [videoId, nodes] of videoNodesById.entries()) {
    const done = isDone(videoId);
    const pct = watchedPct(videoId);
    if (done) {
      nodes.badge.textContent = "Done";
      nodes.badge.className = "statusPill done";
    } else if (pct >= 0.05) {
      nodes.badge.textContent = `${Math.round(pct * 100)}%`;
      nodes.badge.className = "statusPill";
    } else {
      nodes.badge.textContent = "Todo";
      nodes.badge.className = "statusPill";
    }
    nodes.item.classList.toggle("active", videoId === currentVideoId);
  }
}

function applyListVisibility() {
  const q = searchQuery.trim().toLowerCase();
  let visible = 0;
  for (const [videoId, nodes] of videoNodesById.entries()) {
    const title = nodes.item.getAttribute("data-title") ?? "";
    const matchesText = q.length === 0 || title.includes(q);
    const matchesMode = filterMode === "all" ? true : !isDone(videoId);
    const show = matchesText && matchesMode;
    nodes.item.style.display = show ? "" : "none";
    if (show) visible += 1;
  }
  visibleLessons = visible;
}

function setMetaText() {
  const total = courseData?.videos?.length ?? 0;
  const done = progress?.completed?.length ?? 0;
  const filtered = typeof visibleLessons === "number" && visibleLessons !== total;
  const watchedOverall = (() => {
    if (!progress?.watchedById) return 0;
    let sum = 0;
    for (const v of courseData?.videos ?? []) {
      const p = watchedPct(v.videoId);
      sum += p;
    }
    if (total <= 0) return 0;
    return Math.round((sum / total) * 100);
  })();
  document.getElementById("meta").textContent = filtered
    ? `${done}/${total} completed • ${watchedOverall}% watched • ${visibleLessons} shown`
    : `${done}/${total} completed • ${watchedOverall}% watched`;

  const idx = currentVideoId ? (videoIndexById.get(currentVideoId) ?? null) : null;
  const videoPos = idx === null ? "-" : `${idx + 1}/${total}`;
  document.getElementById("videoMeta").textContent =
    currentVideoId ? `Lesson ${videoPos}` : "Select a lesson";
}

function updateNavButtons() {
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const idx = currentVideoId ? (videoIndexById.get(currentVideoId) ?? -1) : -1;
  prevBtn.disabled = idx <= 0;
  nextBtn.disabled = idx < 0 || idx >= videoOrder.length - 1;
}

function setFilterButtons() {
  const allBtn = document.getElementById("showAllBtn");
  const todoBtn = document.getElementById("showTodoBtn");
  allBtn.classList.toggle("active", filterMode === "all");
  todoBtn.classList.toggle("active", filterMode === "todo");
}

function syncAllUI() {
  document.getElementById("courseTitle").textContent = courseData.title ?? "Course";
  const pill = document.getElementById("coursePill");
  if (pill) {
    if (!currentPlaylistId) {
      pill.textContent = "Course";
      pill.title = "Course";
    } else {
      const short =
        currentPlaylistId.length > 14
          ? `${currentPlaylistId.slice(0, 8)}…${currentPlaylistId.slice(-4)}`
          : currentPlaylistId;
      pill.textContent = `Playlist ${short}`;
      pill.title = `Playlist ${currentPlaylistId}`;
    }
  }
  updateListBadgesAndActive();
  applyListVisibility();
  setMetaText();
  refreshProgressUI();
  updateNavButtons();
  setFilterButtons();
  updateToggleDoneButton();
}

function ensurePlayer(videoId) {
  const mount = document.getElementById("playerMount");
  mount.innerHTML = "";
  mount.appendChild(el("div", { id: "ytPlayer" }));

  ytPlayer = new YT.Player("ytPlayer", {
    host: "https://www.youtube-nocookie.com",
    height: "100%",
    width: "100%",
    videoId,
    playerVars: {
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      iv_load_policy: 3,
      fs: 1,
      origin: window.location.origin
    },
    events: {
      onReady: () => {
        if (!ytPlayer) return;
        try {
          ytPlayer.setPlaybackRate(playbackRate);
        } catch {
          // ignore
        }
      },
      onError: (evt) => {
        const code = evt?.data;
        if (code === 101 || code === 150) {
          setErr("This video can’t be played inside the course (embed disabled by uploader). Use “Open YouTube”.");
          toast("err", "Embed blocked", "Open this lesson on YouTube.");
        } else {
          setErr("Video failed to load. Try another lesson or open in YouTube.");
        }
      },
      onStateChange: (evt) => {
        if (evt.data === YT.PlayerState.PLAYING) startWatchPolling();
        if (evt.data === YT.PlayerState.PAUSED) persistProgressThrottled(true);
        if (evt.data === YT.PlayerState.ENDED && currentVideoId) {
          setDone(currentVideoId, true);
          persistProgressThrottled(true);
          syncAllUI();
          // Auto-advance
          goNext(true);
        }
      }
    }
  });
}

function getVideoAt(offset) {
  if (!currentVideoId) return null;
  const idx = videoIndexById.get(currentVideoId);
  if (typeof idx !== "number") return null;
  const nextIdx = idx + offset;
  if (nextIdx < 0 || nextIdx >= videoOrder.length) return null;
  return videoOrder[nextIdx] ?? null;
}

function goPrev() {
  const id = getVideoAt(-1);
  if (id) loadVideo(id);
}

function goNext(preferNotDone = false) {
  if (!currentVideoId) return;
  const idx = videoIndexById.get(currentVideoId);
  if (typeof idx !== "number") return;

  if (!preferNotDone) {
    const id = getVideoAt(1);
    if (id) loadVideo(id);
    return;
  }

  // Prefer next not-done; fallback to next in order; then first not-done in the course.
  for (let i = idx + 1; i < videoOrder.length; i += 1) {
    const id = videoOrder[i];
    if (id && !isDone(id)) {
      loadVideo(id);
      return;
    }
  }
  const next = getVideoAt(1);
  if (next) {
    loadVideo(next);
    return;
  }
  for (let i = 0; i < videoOrder.length; i += 1) {
    const id = videoOrder[i];
    if (id && !isDone(id)) {
      loadVideo(id);
      return;
    }
  }
}

function loadVideo(videoId) {
  currentVideoId = videoId;
  progress.lastVideoId = videoId;
  saveProgress(currentPlaylistId, progress);

  const video = (courseData?.videos ?? []).find((v) => v.videoId === videoId);
  document.getElementById("videoTitle").textContent = video?.title ?? "Video";
  setErr("");
  setMetaText();

  if (typeof YT !== "undefined" && typeof YT.Player === "function") {
    if (!ytPlayer) ensurePlayer(videoId);
    else {
      ytPlayer.loadVideoById(videoId);
      try {
        ytPlayer.setPlaybackRate(playbackRate);
      } catch {
        // ignore
      }
    }
  } else {
    const mount = document.getElementById("playerMount");
    mount.innerHTML = "";
    mount.appendChild(
      el("iframe", {
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
          videoId
        )}?rel=0&modestbranding=1&iv_load_policy=3&playsinline=1`,
        allow:
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
        allowfullscreen: "true",
        title: "YouTube video"
      })
    );
  }
  updateListBadgesAndActive();
  updateNavButtons();
  updateToggleDoneButton();

  // Notes + lesson link actions
  const notes = document.getElementById("notesInput");
  const copyBtn = document.getElementById("copyLessonBtn");
  if (notes) {
    notes.disabled = false;
    currentNotesData = loadNotesData(currentPlaylistId, currentVideoId);
    notes.value = currentNotesData.text;
  }
  if (copyBtn) {
    copyBtn.disabled = false;
  }

  const openYt = document.getElementById("openYtBtn");
  if (openYt) {
    openYt.href = `https://www.youtube.com/watch?v=${encodeURIComponent(
      currentVideoId
    )}&list=${encodeURIComponent(currentPlaylistId)}`;
    openYt.setAttribute("aria-disabled", "false");
  }

  renderBookmarks();

  // Restart watch polling for the new lesson (once playing it will kick in).
  stopWatchPolling();
}

async function fetchCourse(playlistId) {
  const res = await fetch(`/api/playlist?id=${encodeURIComponent(playlistId)}`, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? "Failed to load playlist");
  return json;
}

function wireActions() {
  document.getElementById("list").addEventListener("click", (e) => {
    const item = e.target?.closest?.(".lessonItem");
    const videoId = item?.getAttribute?.("data-video-id");
    if (videoId) loadVideo(videoId);
  });
  document.getElementById("list").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const item = e.target?.closest?.(".lessonItem");
    const videoId = item?.getAttribute?.("data-video-id");
    if (videoId) {
      e.preventDefault();
      loadVideo(videoId);
    }
  });

  document.getElementById("searchInput").addEventListener("input", (e) => {
    searchQuery = e.target.value ?? "";
    applyListVisibility();
    setMetaText();
  });

  document.getElementById("showAllBtn").addEventListener("click", () => {
    filterMode = "all";
    applyListVisibility();
    setMetaText();
    setFilterButtons();
  });
  document.getElementById("showTodoBtn").addEventListener("click", () => {
    filterMode = "todo";
    applyListVisibility();
    setMetaText();
    setFilterButtons();
  });

  document.getElementById("prevBtn").addEventListener("click", goPrev);
  document.getElementById("nextBtn").addEventListener("click", () => goNext(false));

  const sideToggle = document.getElementById("sideToggleBtn");
  const sidePanel = document.getElementById("sidePanel");
  if (sideToggle && sidePanel) {
    sideToggle.addEventListener("click", () => {
      sideCollapsed = !sideCollapsed;
      saveSettings();
      applyLayoutState();
    });
  }

  const focusBtn = document.getElementById("focusBtn");
  if (focusBtn) {
    focusBtn.addEventListener("click", () => {
      focusMode = !focusMode;
      saveSettings();
      applyLayoutState();
      toast("ok", "Focus mode", focusMode ? "Enabled." : "Disabled.");
    });
  }

  document.getElementById("toggleDoneBtn").addEventListener("click", () => {
    if (!currentVideoId) return;
    setDone(currentVideoId, !isDone(currentVideoId));
    syncAllUI();
    toast("ok", "Saved", isDone(currentVideoId) ? "Marked as done." : "Marked as todo.");
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    if (!currentPlaylistId) return;
    if (!window.confirm("Reset completion for this course on this device?")) return;
    progress = { completed: [], lastVideoId: currentVideoId ?? null };
    saveProgress(currentPlaylistId, progress);
    syncAllUI();
    toast("ok", "Reset", "Course progress reset.");
  });

  const notes = document.getElementById("notesInput");
  if (notes) {
    notes.addEventListener("input", (e) => {
      if (!currentPlaylistId || !currentVideoId) return;
      if (!currentNotesData) currentNotesData = { text: "", bookmarks: [] };
      currentNotesData.text = e.target.value ?? "";
      saveNotesDataDebounced(currentPlaylistId, currentVideoId, currentNotesData);
    });
  }

  const stampBtn = document.getElementById("addStampBtn");
  if (stampBtn) {
    stampBtn.addEventListener("click", () => {
      if (!currentPlaylistId || !currentVideoId) return;
      if (!currentNotesData) currentNotesData = { text: "", bookmarks: [] };
      let t = 0;
      try {
        t = ytPlayer ? Number(ytPlayer.getCurrentTime?.() ?? 0) : 0;
      } catch {
        t = 0;
      }
      if (!Number.isFinite(t)) t = 0;
      const label = formatTime(t);
      currentNotesData.bookmarks = Array.isArray(currentNotesData.bookmarks) ? currentNotesData.bookmarks : [];
      currentNotesData.bookmarks.unshift({ t: Math.floor(t), label, createdAt: Date.now() });
      saveNotesDataDebounced(currentPlaylistId, currentVideoId, currentNotesData);
      renderBookmarks();
      toast("ok", "Timestamp saved", label);
    });
  }

  const speed = document.getElementById("speedSelect");
  if (speed) {
    speed.addEventListener("change", () => {
      const v = Number.parseFloat(speed.value);
      if (ytPlayer && Number.isFinite(v)) {
        try {
          ytPlayer.setPlaybackRate(v);
        } catch {
          // ignore
        }
      }
      if (Number.isFinite(v)) {
        playbackRate = v;
        saveSettings();
      }
    });
  }

  const copyBtn = document.getElementById("copyLessonBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      if (!currentPlaylistId || !currentVideoId) return;
      const url = `${window.location.origin}/course.html?list=${encodeURIComponent(
        currentPlaylistId
      )}#v=${encodeURIComponent(currentVideoId)}`;
      try {
        await navigator.clipboard.writeText(url);
        toast("ok", "Copied", "Lesson link copied.");
      } catch {
        toast("err", "Copy failed", "Could not copy the link.");
      }
    });
  }

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable))
      return;
    if (e.key === "/") {
      const s = document.getElementById("searchInput");
      if (s) {
        e.preventDefault();
        s.focus();
      }
    } else if (e.key === "ArrowLeft") {
      goPrev();
    } else if (e.key === "ArrowRight") {
      goNext(false);
    } else if (e.key.toLowerCase() === "d") {
      const btn = document.getElementById("toggleDoneBtn");
      if (btn && !btn.disabled) btn.click();
    }
  });
}

window.onYouTubeIframeAPIReady = () => {
  if (currentVideoId && !ytPlayer) ensurePlayer(currentVideoId);
};

async function init() {
  setLoading(true);
  wireActions();
  loadSettings();
  applyLayoutState();

  const speed = document.getElementById("speedSelect");
  if (speed) speed.value = String(playbackRate);

  const q = getQuery();
  const playlistId = extractPlaylistId(q.list || q.url);
  if (!playlistId) {
    setLoading(false);
    setErr("Missing playlist id. Open this page as /course.html?list=YOUR_PLAYLIST_ID");
    return;
  }

  try {
    currentPlaylistId = playlistId;
    courseData = await fetchCourse(playlistId);
    progress = loadProgress(playlistId);

    // Keep dashboard metadata in sync (local device).
    try {
      const key = "ytcourse:courses";
      const raw = localStorage.getItem(key);
      const courses = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(courses) ? courses : [];
      const now = Date.now();
      const count = Array.isArray(courseData.videos) ? courseData.videos.length : 0;
      const idx = list.findIndex((c) => c?.playlistId === playlistId);
      const entry = {
        playlistId,
        title: courseData.title ?? "Untitled",
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

    setLoading(false);
    buildList();
    syncAllUI();

    const hash = window.location.hash ?? "";
    const match = hash.match(/[#&]v=([^&]+)/);
    const hashedVideoId = match?.[1] ? decodeURIComponent(match[1]) : null;

    const startVideoId = progress.lastVideoId ?? courseData?.videos?.[0]?.videoId ?? null;
    const initial = hashedVideoId && videoIndexById.has(hashedVideoId) ? hashedVideoId : startVideoId;
    if (initial) loadVideo(initial);
  } catch (e) {
    setLoading(false);
    setErr(e?.message ?? "Failed to load course.");
  }
}

document.addEventListener("DOMContentLoaded", init);

window.addEventListener("beforeunload", () => {
  try {
    persistProgressThrottled(true);
  } catch {
    // ignore
  }
  stopWatchPolling();
});
