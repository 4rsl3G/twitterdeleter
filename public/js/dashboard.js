const state = {
  tweets: [],
  selected: new Set(),
  nextToken: null,
  isDeleting: false,
  deletedIds: new Set(),
};

// ─── DOM refs ────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const btnFetch     = $("btnFetch");
const btnLoadMore  = $("btnLoadMore");
const btnDelete    = $("btnDelete");
const btnAbort     = $("btnAbort");
const btnSelectAll = $("btnSelectAll");
const btnDeselectAll = $("btnDeselectAll");
const tweetList    = $("tweetList");
const emptyState   = $("emptyState");
const loadingState = $("loadingState");
const logFeed      = $("logFeed");
const confirmModal = $("confirmModal");
const modalCancel  = $("modalCancel");
const modalConfirm = $("modalConfirm");
const progressSection = $("progressSection");
const ringFill     = $("ringFill");

let abortController = null;

// ─── Init ─────────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch("/api/me");
    const data = await res.json();
    if (data.success) {
      const u = data.user;
      $("userName").textContent = u.name;
      $("userHandle").textContent = "@" + u.username;
      if (u.public_metrics?.tweet_count !== undefined) {
        $("userTweetCount").textContent = u.public_metrics.tweet_count.toLocaleString();
      }
      if (u.profile_image_url) {
        const img = $("userAvatar");
        img.src = u.profile_image_url.replace("_normal", "_400x400");
        img.classList.remove("hidden");
        img.nextElementSibling.style.display = "none";
      }
      appendLog("Connected as @" + u.username, "success");
    } else {
      $("userName").textContent = "API Error";
      appendLog("Auth failed: " + data.error, "error");
    }
  } catch (e) {
    $("userName").textContent = "Offline";
    appendLog("Could not reach API: " + e.message, "error");
  }
}

// ─── Delay slider ──────────────────────────────────────────────────
const delaySlider = $("delaySlider");
const delayVal    = $("delayVal");
delaySlider.addEventListener("input", () => {
  delayVal.textContent = delaySlider.value + "ms";
});

// ─── Fetch tweets ──────────────────────────────────────────────────
async function fetchTweets(loadMore = false) {
  if (!loadMore) {
    state.tweets = [];
    state.selected.clear();
    state.nextToken = null;
    tweetList.innerHTML = "";
    emptyState.classList.add("hidden");
    loadingState.classList.remove("hidden");
    $("btnSelectAll").style.display = "none";
    $("btnDeselectAll").style.display = "none";
  }

  btnFetch.disabled = true;
  btnFetch.innerHTML = '<span class="loader-ring" style="width:16px;height:16px;border-width:2px;margin:0"></span> Loading...';

  const params = new URLSearchParams({
    limit: 100,
    includeReplies: $("inclReplies").checked,
    includeRetweets: $("inclRetweets").checked,
  });
  if (state.nextToken) params.set("paginationToken", state.nextToken);

  try {
    const res = await fetch("/api/tweets?" + params);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    let tweets = data.tweets || [];

    // Client-side filters
    const dateFilter = $("filterDate").value;
    const kwFilter   = $("filterKeyword").value.trim().toLowerCase();

    if (dateFilter) {
      const cutoff = new Date(dateFilter);
      tweets = tweets.filter((t) => new Date(t.created_at) < cutoff);
    }
    if (kwFilter) {
      tweets = tweets.filter((t) => t.text.toLowerCase().includes(kwFilter));
    }

    state.tweets.push(...tweets);
    state.nextToken = data.nextToken;

    loadingState.classList.add("hidden");
    renderTweets(tweets, loadMore);
    updateMiniStats();
    updateDeleteBtn();

    appendLog(`Loaded ${tweets.length} tweets (total: ${state.tweets.length})`, "success");

    if (state.nextToken) {
      btnLoadMore.style.display = "block";
    } else {
      btnLoadMore.style.display = "none";
    }
  } catch (e) {
    appendLog("Fetch error: " + e.message, "error");
    loadingState.classList.add("hidden");
    if (state.tweets.length === 0) emptyState.classList.remove("hidden");
  } finally {
    btnFetch.disabled = false;
    btnFetch.innerHTML = '<i class="ri-refresh-line"></i> Fetch Tweets <span class="btn-shine"></span>';
  }
}

// ─── Render tweets ─────────────────────────────────────────────────
function renderTweets(tweets, append = false) {
  if (!append) tweetList.innerHTML = "";

  if (state.tweets.length === 0) {
    emptyState.classList.remove("hidden");
    $("tweetPanelCount").textContent = "No tweets found";
    return;
  }

  emptyState.classList.add("hidden");
  $("tweetPanelCount").textContent = `${state.tweets.length} tweet${state.tweets.length !== 1 ? "s" : ""} loaded`;
  $("btnSelectAll").style.display = "flex";
  $("btnDeselectAll").style.display = "flex";
  $("miniStats").style.display = "flex";

  tweets.forEach((tweet, i) => {
    const card = document.createElement("div");
    card.className = "tweet-card";
    card.dataset.id = tweet.id;
    card.style.animationDelay = `${Math.min(i, 20) * 30}ms`;

    const date = new Date(tweet.created_at).toLocaleDateString("id-ID", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
    });

    const isReply = tweet.text.startsWith("@");
    const isRT    = tweet.text.startsWith("RT @");
    const likes   = tweet.public_metrics?.like_count || 0;

    card.innerHTML = `
      <div class="tweet-check"></div>
      <div class="tweet-body">
        <div class="tweet-text">${escapeHtml(tweet.text)}</div>
        <div class="tweet-meta">
          <span class="tweet-date">${date}</span>
          ${isRT ? '<span class="tweet-badge retweet">RT</span>' : ""}
          ${isReply && !isRT ? '<span class="tweet-badge reply">Reply</span>' : ""}
          ${likes > 0 ? `<span class="tweet-likes">♥ ${likes}</span>` : ""}
        </div>
      </div>
    `;

    card.addEventListener("click", () => toggleSelect(tweet.id, card));
    tweetList.appendChild(card);
  });
}

// ─── Selection ─────────────────────────────────────────────────────
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
  state.tweets.forEach((t) => {
    if (!state.deletedIds.has(t.id)) {
      state.selected.add(t.id);
    }
  });
  document.querySelectorAll(".tweet-card:not(.deleted)").forEach((c) => c.classList.add("selected"));
  updateMiniStats();
  updateDeleteBtn();
});

btnDeselectAll.addEventListener("click", () => {
  state.selected.clear();
  document.querySelectorAll(".tweet-card").forEach((c) => c.classList.remove("selected"));
  updateMiniStats();
  updateDeleteBtn();
});

// ─── UI updaters ───────────────────────────────────────────────────
function updateMiniStats() {
  $("msLoaded").textContent   = state.tweets.length;
  $("msSelected").textContent = state.selected.size;
  const kwF  = $("filterKeyword").value.trim();
  const dateF = $("filterDate").value;
  $("msFiltered").textContent = (kwF || dateF) ? state.tweets.length : "—";
}

function updateDeleteBtn() {
  const n = state.selected.size;
  $("dsNum").textContent = n;
  const isDry = $("dryRun").checked;
  btnDelete.disabled = n === 0 || state.isDeleting;
  $("btnDeleteLabel").textContent = isDry ? `Preview ${n} Tweets` : `Delete ${n} Tweets`;
}

$("dryRun").addEventListener("change", updateDeleteBtn);

// ─── Delete flow ───────────────────────────────────────────────────
btnDelete.addEventListener("click", () => {
  if (state.selected.size === 0) return;
  const isDry = $("dryRun").checked;
  $("modalCount").textContent = state.selected.size;
  const body = isDry
    ? `<strong>DRY RUN</strong>: This will preview ${state.selected.size} tweets without deleting anything.`
    : `You are about to permanently delete <strong>${state.selected.size}</strong> tweets. This action <strong>cannot be undone.</strong>`;
  $("modalBody").innerHTML = body;
  confirmModal.classList.add("open");
});

modalCancel.addEventListener("click", () => {
  confirmModal.classList.remove("open");
});

confirmModal.addEventListener("click", (e) => {
  if (e.target === confirmModal) confirmModal.classList.remove("open");
});

modalConfirm.addEventListener("click", () => {
  confirmModal.classList.remove("open");
  startDeletion();
});

async function startDeletion() {
  if (state.selected.size === 0 || state.isDeleting) return;
  state.isDeleting = true;
  btnDelete.disabled = true;
  btnAbort.style.display = "block";
  progressSection.style.display = "block";
  $("logSection").style.display = "block";

  const isDry  = $("dryRun").checked;
  const delay  = parseInt(delaySlider.value);
  const ids    = [...state.selected];
  let deleted  = 0;
  let failed   = 0;

  setProgress(0, ids.length);
  appendLog(`Starting ${isDry ? "DRY RUN" : "deletion"} of ${ids.length} tweets...`, "warn");

  if (isDry) {
    // Simulate dry run
    for (let i = 0; i < ids.length; i++) {
      if (!state.isDeleting) break;
      await sleep(Math.min(delay / 4, 200));
      const card = document.querySelector(`.tweet-card[data-id="${ids[i]}"]`);
      const snippet = card?.querySelector(".tweet-text")?.textContent?.slice(0, 50) || ids[i];
      appendLog(`[DRY] Would delete: "${snippet}..."`, "info");
      deleted++;
      setProgress(i + 1, ids.length, deleted, failed);
      $("pcDeleted").textContent = deleted;
    }
    appendLog(`DRY RUN complete. Would have deleted ${deleted} tweets.`, "success");
  } else {
    // Use SSE for real deletions
    const body = JSON.stringify({ tweetIds: ids, delayMs: delay });
    abortController = new AbortController();

    try {
      const res = await fetch("/api/tweets/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: abortController.signal,
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
            handleSSEEvent(evt, ids);
            if (evt.deleted !== undefined) deleted = evt.deleted;
            if (evt.failed  !== undefined) failed  = evt.failed;
            if (evt.type === "complete") break;
          } catch (_) {}
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        appendLog("Connection error: " + e.message, "error");
      } else {
        appendLog("Deletion aborted by user.", "warn");
      }
    }
  }

  state.isDeleting = false;
  btnAbort.style.display = "none";
  updateDeleteBtn();
  appendLog("Operation finished.", "info");
}

function handleSSEEvent(evt, ids) {
  switch (evt.type) {
    case "start":
      appendLog(`Processing ${evt.total} tweets...`, "info");
      break;
    case "progress":
      setProgress(evt.current, evt.total, evt.deleted, evt.failed);
      $("pcDeleted").textContent = evt.deleted;
      $("pcFailed").textContent  = evt.failed;
      if (evt.status === "deleted") {
        const card = document.querySelector(`.tweet-card[data-id="${evt.tweetId}"]`);
        if (card) { card.classList.add("deleted"); state.selected.delete(evt.tweetId); state.deletedIds.add(evt.tweetId); }
        const snippet = card?.querySelector(".tweet-text")?.textContent?.slice(0, 45) || evt.tweetId;
        appendLog(`✓ Deleted: "${snippet}..."`, "success");
      } else {
        appendLog(`✗ Failed ${evt.tweetId}: ${evt.error || "unknown"}`, "error");
      }
      break;
    case "ratelimit":
      appendLog("⚠ Rate limit hit! Waiting 60s...", "ratelimit");
      break;
    case "complete":
      appendLog(`Complete! ${evt.deleted} deleted, ${evt.failed} failed.`, "success");
      setProgress(evt.total, evt.total, evt.deleted, evt.failed);
      break;
    case "error":
      appendLog("Error: " + evt.message, "error");
      break;
  }
}

btnAbort.addEventListener("click", () => {
  state.isDeleting = false;
  if (abortController) abortController.abort();
});

// ─── Progress ring ─────────────────────────────────────────────────
function setProgress(current, total, deleted = 0, failed = 0) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  $("prcPct").textContent = pct + "%";
  const circumference = 314;
  ringFill.style.strokeDashoffset = circumference - (pct / 100) * circumference;
  if (deleted !== undefined) $("pcDeleted").textContent = deleted;
  if (failed !== undefined)  $("pcFailed").textContent  = failed;
}

// ─── Log ───────────────────────────────────────────────────────────
function appendLog(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `log-entry log-${type}`;
  const ts = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  el.textContent = `[${ts}] ${msg}`;
  logFeed.appendChild(el);
  logFeed.scrollTop = logFeed.scrollHeight;
  // Keep log trimmed
  while (logFeed.children.length > 200) logFeed.removeChild(logFeed.firstChild);
}

// ─── Buttons ───────────────────────────────────────────────────────
btnFetch.addEventListener("click", () => fetchTweets(false));
btnLoadMore.addEventListener("click", () => fetchTweets(true));

// ─── Utils ─────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Boot ──────────────────────────────────────────────────────────
init();
