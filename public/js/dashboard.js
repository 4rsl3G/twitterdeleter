/* dashboard.js — TweetReaper v2 (OAuth) */

// ─── State ───────────────────────────────────────────────────────────
const state = {
  tweets:     [],
  selected:   new Set(),
  deletedIds: new Set(),
  nextToken:  null,
  isDeleting: false,
};

// ─── DOM refs ────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const btnFetch      = $("btnFetch");
const btnLoadMore   = $("btnLoadMore");
const btnDelete     = $("btnDelete");
const btnAbort      = $("btnAbort");
const btnSelectAll  = $("btnSelectAll");
const btnDeselectAll = $("btnDeselectAll");
const tweetList     = $("tweetList");
const emptyState    = $("emptyState");
const loadingState  = $("loadingState");
const logFeed       = $("logFeed");
const confirmModal  = $("confirmModal");
const progressSection = $("progressSection");
const ratelimitBox  = $("ratelimitBox");
const ringFill      = $("ringFill");

let rlTimer = null;

// ─── Slider ──────────────────────────────────────────────────────────
$("delaySlider").addEventListener("input", () => {
  $("delayVal").textContent = $("delaySlider").value + "ms";
});

// ─── Fetch tweets ─────────────────────────────────────────────────────
async function fetchTweets(loadMore = false) {
  if (!loadMore) {
    state.tweets = [];
    state.selected.clear();
    state.nextToken = null;
    state.deletedIds.clear();
    tweetList.innerHTML = "";
    emptyState.classList.add("hidden");
    loadingState.classList.remove("hidden");
    btnSelectAll.style.display = "none";
    btnDeselectAll.style.display = "none";
    $("miniStats").style.display = "none";
  }

  btnFetch.disabled = true;
  btnFetch.innerHTML = '<span class="loader-ring" style="width:16px;height:16px;border-width:2px;margin:0"></span> Loading...';

  const params = new URLSearchParams({
    limit: 100,
    includeReplies:   $("inclReplies").checked,
    includeRetweets:  $("inclRetweets").checked,
  });
  if (state.nextToken) params.set("paginationToken", state.nextToken);

  try {
    const res  = await fetch("/api/tweets?" + params);
    const data = await res.json();

    if (res.status === 401) {
      appendLog("Session expired. Please reconnect Twitter.", "error");
      setTimeout(() => window.location.href = "/", 2000);
      return;
    }

    if (!data.success) throw new Error(data.error);

    let tweets = data.tweets || [];

    // Client-side filter
    const dateKw = $("filterDate").value;
    const kw     = $("filterKeyword").value.trim().toLowerCase();
    if (dateKw) { const cutoff = new Date(dateKw); tweets = tweets.filter(t => new Date(t.created_at) < cutoff); }
    if (kw)     { tweets = tweets.filter(t => t.text.toLowerCase().includes(kw)); }

    state.tweets.push(...tweets);
    state.nextToken = data.nextToken;

    loadingState.classList.add("hidden");
    renderTweets(tweets);
    updateMiniStats();
    updateDeleteBtn();
    appendLog(`Loaded ${tweets.length} tweets (total: ${state.tweets.length})`, "success");

    btnLoadMore.style.display = state.nextToken ? "block" : "none";
  } catch (e) {
    appendLog("Fetch error: " + e.message, "error");
    loadingState.classList.add("hidden");
    if (state.tweets.length === 0) emptyState.classList.remove("hidden");
  } finally {
    btnFetch.disabled = false;
    btnFetch.innerHTML = '<i class="ri-refresh-line"></i> Fetch Tweets <span class="btn-shine"></span>';
  }
}

// ─── Render tweets ────────────────────────────────────────────────────
function renderTweets(tweets) {
  if (state.tweets.length === 0) {
    emptyState.classList.remove("hidden");
    $("tweetPanelCount").textContent = "No tweets found";
    return;
  }

  emptyState.classList.add("hidden");
  $("tweetPanelCount").textContent = `${state.tweets.length} tweet${state.tweets.length !== 1 ? "s" : ""} loaded`;
  btnSelectAll.style.display = "flex";
  btnDeselectAll.style.display = "flex";
  $("miniStats").style.display = "flex";

  tweets.forEach((tweet, i) => {
    const card = document.createElement("div");
    card.className = "tweet-card";
    card.dataset.id = tweet.id;
    card.style.animationDelay = `${Math.min(i, 30) * 25}ms`;

    const date = new Date(tweet.created_at).toLocaleDateString("id-ID", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
    });

    const isRT    = tweet.text.startsWith("RT @");
    const isReply = tweet.text.startsWith("@") && !isRT;
    const likes   = tweet.public_metrics?.like_count || 0;
    const rts     = tweet.public_metrics?.retweet_count || 0;

    card.innerHTML = `
      <div class="tweet-check"></div>
      <div class="tweet-body">
        <div class="tweet-text">${escapeHtml(tweet.text)}</div>
        <div class="tweet-meta">
          <span class="tweet-date">${date}</span>
          ${isRT ? '<span class="tweet-badge retweet">RT</span>' : ""}
          ${isReply ? '<span class="tweet-badge reply">Reply</span>' : ""}
          ${likes > 0 ? `<span class="tweet-likes">♥ ${likes}</span>` : ""}
          ${rts > 0 ? `<span class="tweet-likes">↺ ${rts}</span>` : ""}
        </div>
      </div>
    `;

    card.addEventListener("click", () => toggleSelect(tweet.id, card));
    tweetList.appendChild(card);
  });
}

// ─── Selection ────────────────────────────────────────────────────────
function toggleSelect(id, card) {
  if (state.selected.has(id)) {
    state.selected.delete(id);
    card.classList.remove("selected");
  } else {
    state.selected.add(id);
    card.classList.add("selected");
  }
  updateMiniStats();
  updateDeleteBtn();
}

btnSelectAll.addEventListener("click", () => {
  state.tweets.forEach(t => {
    if (!state.deletedIds.has(t.id)) state.selected.add(t.id);
  });
  document.querySelectorAll(".tweet-card:not(.deleted)").forEach(c => c.classList.add("selected"));
  updateMiniStats();
  updateDeleteBtn();
});

btnDeselectAll.addEventListener("click", () => {
  state.selected.clear();
  document.querySelectorAll(".tweet-card").forEach(c => c.classList.remove("selected"));
  updateMiniStats();
  updateDeleteBtn();
});

// ─── UI updates ───────────────────────────────────────────────────────
function updateMiniStats() {
  $("msLoaded").textContent   = state.tweets.length;
  $("msSelected").textContent = state.selected.size;
}

function updateDeleteBtn() {
  const n    = state.selected.size;
  const isDry = $("dryRun").checked;
  $("dsNum").textContent = n;
  btnDelete.disabled = n === 0 || state.isDeleting;
  $("btnDeleteLabel").textContent = isDry ? `Preview ${n} Tweets` : `Delete ${n} Tweets`;
}
$("dryRun").addEventListener("change", updateDeleteBtn);

// ─── Delete flow ──────────────────────────────────────────────────────
btnDelete.addEventListener("click", () => {
  if (state.selected.size === 0) return;
  const isDry = $("dryRun").checked;
  const n     = state.selected.size;
  $("modalBody").innerHTML = isDry
    ? `<strong>DRY RUN:</strong> Preview ${n} tweets — nothing will be deleted.`
    : `You are about to permanently delete <strong>${n}</strong> tweets. This action <strong>cannot be undone.</strong>`;
  confirmModal.classList.add("open");
});

$("modalCancel").addEventListener("click", () => confirmModal.classList.remove("open"));
confirmModal.addEventListener("click", e => { if (e.target === confirmModal) confirmModal.classList.remove("open"); });
$("modalConfirm").addEventListener("click", () => { confirmModal.classList.remove("open"); startDeletion(); });

async function startDeletion() {
  if (!state.selected.size || state.isDeleting) return;
  state.isDeleting = true;
  btnDelete.disabled = true;
  btnAbort.style.display = "block";
  progressSection.style.display = "block";

  const isDry  = $("dryRun").checked;
  const delay  = parseInt($("delaySlider").value);
  const ids    = [...state.selected];
  let deleted  = 0, failed = 0;

  setProgress(0, ids.length, 0, 0);
  appendLog(`Starting ${isDry ? "DRY RUN" : "deletion"} — ${ids.length} tweets...`, "warn");

  if (isDry) {
    for (let i = 0; i < ids.length; i++) {
      if (!state.isDeleting) break;
      await sleep(Math.min(delay / 5, 150));
      const card = document.querySelector(`.tweet-card[data-id="${ids[i]}"]`);
      const snip = card?.querySelector(".tweet-text")?.textContent?.slice(0, 50) || ids[i];
      appendLog(`[DRY] Would delete: "${snip}..."`, "info");
      deleted++;
      setProgress(i + 1, ids.length, deleted, failed);
    }
    appendLog(`DRY RUN complete. Would have deleted ${deleted} tweets.`, "success");
    state.isDeleting = false;
    btnAbort.style.display = "none";
    updateDeleteBtn();
    return;
  }

  // Real deletion via SSE
  try {
    const res = await fetch("/api/tweets/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tweetIds: ids, delayMs: delay }),
    });

    if (res.status === 401) {
      appendLog("Session expired during deletion. Please reconnect.", "error");
      setTimeout(() => window.location.href = "/", 2500);
      return;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          handleSSE(evt, ids);
        } catch (_) {}
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") appendLog("Stream error: " + e.message, "error");
  }

  state.isDeleting = false;
  btnAbort.style.display = "none";
  updateDeleteBtn();
}

function handleSSE(evt, ids) {
  switch (evt.type) {
    case "start":
      appendLog(`Streaming ${evt.total} deletions...`, "info");
      break;
    case "progress": {
      setProgress(evt.current, evt.total, evt.deleted, evt.failed);
      if (evt.status === "deleted") {
        const card = document.querySelector(`.tweet-card[data-id="${evt.tweetId}"]`);
        if (card) { card.classList.add("deleted"); state.selected.delete(evt.tweetId); state.deletedIds.add(evt.tweetId); }
        const snip = card?.querySelector(".tweet-text")?.textContent?.slice(0, 48) || evt.tweetId;
        appendLog(`✓ ${snip}...`, "success");
      } else {
        appendLog(`✗ Failed ${evt.tweetId}: ${evt.error}`, "error");
      }
      break;
    }
    case "ratelimit":
      showRatelimit(evt.waitSec);
      appendLog(`⚡ Rate limit hit — waiting ${evt.waitSec}s`, "ratelimit");
      break;
    case "complete":
      setProgress(evt.total, evt.total, evt.deleted, evt.failed);
      appendLog(`✓ Done! ${evt.deleted} deleted, ${evt.failed} failed.`, "success");
      hideRatelimit();
      break;
    case "aborted":
      appendLog(`Aborted. ${evt.deleted} deleted before stop.`, "warn");
      break;
    case "error":
      appendLog("Error: " + evt.message, "error");
      break;
  }
}

btnAbort.addEventListener("click", () => {
  state.isDeleting = false;
  appendLog("Abort requested...", "warn");
});

// ─── Rate limit UI ────────────────────────────────────────────────────
function showRatelimit(secs) {
  ratelimitBox.classList.remove("hidden");
  let remaining = secs;
  $("rlCountdown").textContent = remaining;
  clearInterval(rlTimer);
  rlTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) { clearInterval(rlTimer); hideRatelimit(); }
    else $("rlCountdown").textContent = remaining;
  }, 1000);
}
function hideRatelimit() { ratelimitBox.classList.add("hidden"); clearInterval(rlTimer); }

// ─── Progress ring ────────────────────────────────────────────────────
function setProgress(current, total, deleted = 0, failed = 0) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  $("prcPct").textContent = pct + "%";
  ringFill.style.strokeDashoffset = 314 - (pct / 100) * 314;
  $("pcDeleted").textContent = deleted;
  $("pcFailed").textContent  = failed;
}

// ─── Log ─────────────────────────────────────────────────────────────
function appendLog(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `log-entry log-${type}`;
  const ts = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  el.textContent = `[${ts}] ${msg}`;
  logFeed.appendChild(el);
  logFeed.scrollTop = logFeed.scrollHeight;
  while (logFeed.children.length > 300) logFeed.removeChild(logFeed.firstChild);
}

// ─── Wire up buttons ──────────────────────────────────────────────────
btnFetch.addEventListener("click", () => fetchTweets(false));
btnLoadMore.addEventListener("click", () => fetchTweets(true));

// ─── Utils ───────────────────────────────────────────────────────────
function escapeHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Init ─────────────────────────────────────────────────────────────
appendLog("Connected as @" + (window.__username || document.querySelector(".user-handle")?.textContent?.replace("@","") || "user"), "success");
