const express = require("express");
const router = express.Router();
const { TwitterApi } = require("twitter-api-v2");

// Middleware: require authentication
function requireAuth(req, res, next) {
  if (!req.session.accessToken || !req.session.accessSecret) {
    return res.status(401).json({ success: false, error: "Not authenticated. Please login first.", code: "UNAUTHENTICATED" });
  }
  next();
}

// Build authed client from session
function getClientFromSession(req) {
  return new TwitterApi({
    appKey:      process.env.TWITTER_API_KEY,
    appSecret:   process.env.TWITTER_API_SECRET,
    accessToken: req.session.accessToken,
    accessSecret: req.session.accessSecret,
  });
}

// ─── GET /api/me ─────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  try {
    // Return from session cache (no extra API call)
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/me/refresh — refresh user data from API ─────────────────
router.get("/me/refresh", requireAuth, async (req, res) => {
  try {
    const client = getClientFromSession(req);
    const me = await client.v2.me({
      "user.fields": ["public_metrics", "profile_image_url", "description"],
    });
    req.session.user = {
      ...req.session.user,
      tweetCount:     me.data.public_metrics?.tweet_count || 0,
      followersCount: me.data.public_metrics?.followers_count || 0,
    };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/tweets ─────────────────────────────────────────────────
router.get("/tweets", requireAuth, async (req, res) => {
  try {
    const client = getClientFromSession(req);
    const userId = req.session.user.id;

    const maxResults = Math.min(parseInt(req.query.limit) || 100, 100);
    const params = {
      max_results: maxResults,
      "tweet.fields": ["created_at", "text", "public_metrics", "referenced_tweets"],
    };

    const includeReplies   = req.query.includeReplies === "true";
    const includeRetweets  = req.query.includeRetweets === "true";
    const excludes = [];
    if (!includeReplies)  excludes.push("replies");
    if (!includeRetweets) excludes.push("retweets");
    if (excludes.length > 0) params.exclude = excludes;

    if (req.query.paginationToken) {
      params.pagination_token = req.query.paginationToken;
    }

    const response = await client.v2.userTimeline(userId, params);
    const tweets    = response.data?.data || [];
    const nextToken = response.data?.meta?.next_token || null;
    const resultCount = response.data?.meta?.result_count || 0;

    res.json({ success: true, tweets, nextToken, resultCount });
  } catch (err) {
    const status = err.code === 429 ? 429 : 500;
    res.status(status).json({ success: false, error: err.message, code: err.code });
  }
});

// ─── DELETE /api/tweets/:id ───────────────────────────────────────────
router.delete("/tweets/:id", requireAuth, async (req, res) => {
  try {
    const client = getClientFromSession(req);
    await client.v2.deleteTweet(req.params.id);
    res.json({ success: true, deleted: req.params.id });
  } catch (err) {
    const status = err.code === 429 ? 429 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// ─── POST /api/tweets/bulk-delete — SSE streaming delete ─────────────
router.post("/tweets/bulk-delete", requireAuth, async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
  };

  const client = getClientFromSession(req);
  const { tweetIds, delayMs = 1000 } = req.body;

  if (!Array.isArray(tweetIds) || tweetIds.length === 0) {
    send({ type: "error", message: "No tweet IDs provided" });
    return res.end();
  }

  let deleted = 0, failed = 0;
  let aborted = false;

  req.on("close", () => { aborted = true; });

  send({ type: "start", total: tweetIds.length });

  for (let i = 0; i < tweetIds.length; i++) {
    if (aborted) {
      send({ type: "aborted", deleted, failed });
      break;
    }

    const id = tweetIds[i];
    try {
      await client.v2.deleteTweet(id);
      deleted++;
      send({ type: "progress", current: i + 1, total: tweetIds.length, deleted, failed, tweetId: id, status: "deleted" });
    } catch (err) {
      if (err.code === 429) {
        const waitSec = parseInt(err.rateLimit?.reset
          ? Math.max(0, err.rateLimit.reset * 1000 - Date.now()) / 1000
          : 60);
        const wait = Math.min(Math.max(waitSec, 15), 120);
        send({ type: "ratelimit", waitSec: wait, current: i + 1, total: tweetIds.length });
        await new Promise((r) => setTimeout(r, wait * 1000));
        if (!aborted) { i--; continue; }
      } else {
        failed++;
        send({ type: "progress", current: i + 1, total: tweetIds.length, deleted, failed, tweetId: id, status: "failed", error: err.message });
      }
    }

    if (i < tweetIds.length - 1 && !aborted) {
      await new Promise((r) => setTimeout(r, Math.max(parseInt(delayMs), 300)));
    }
  }

  if (!aborted) {
    send({ type: "complete", deleted, failed, total: tweetIds.length });
  }
  res.end();
});

module.exports = router;
