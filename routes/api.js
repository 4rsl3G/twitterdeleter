const express = require("express");
const router = express.Router();
const { TwitterApi } = require("twitter-api-v2");

function getClient() {
  if (
    !process.env.TWITTER_API_KEY ||
    !process.env.TWITTER_API_SECRET ||
    !process.env.TWITTER_ACCESS_TOKEN ||
    !process.env.TWITTER_ACCESS_SECRET
  ) {
    throw new Error("Twitter API credentials not configured in .env");
  }
  return new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
  });
}

// GET /api/me — get current user info
router.get("/me", async (req, res) => {
  try {
    const client = getClient();
    const me = await client.v2.me({ "user.fields": ["public_metrics", "profile_image_url", "description"] });
    res.json({ success: true, user: me.data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/tweets — fetch user tweets with pagination
router.get("/tweets", async (req, res) => {
  try {
    const client = getClient();
    const me = await client.v2.me();
    const userId = me.data.id;

    const params = {
      max_results: parseInt(req.query.limit) || 100,
      "tweet.fields": ["created_at", "text", "public_metrics"],
    };

    // exclude replies/retweets unless requested
    const includeReplies = req.query.includeReplies === "true";
    const includeRetweets = req.query.includeRetweets === "true";

    const excludes = [];
    if (!includeReplies) excludes.push("replies");
    if (!includeRetweets) excludes.push("retweets");
    if (excludes.length > 0) params.exclude = excludes;

    if (req.query.paginationToken) {
      params.pagination_token = req.query.paginationToken;
    }

    const response = await client.v2.userTimeline(userId, params);
    const tweets = response.data?.data || [];
    const nextToken = response.data?.meta?.next_token || null;
    const totalCount = response.data?.meta?.result_count || 0;

    res.json({ success: true, tweets, nextToken, totalCount, userId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/tweets/:id — delete a single tweet
router.delete("/tweets/:id", async (req, res) => {
  try {
    const client = getClient();
    await client.v2.deleteTweet(req.params.id);
    res.json({ success: true, deleted: req.params.id });
  } catch (err) {
    if (err.code === 429) {
      res.status(429).json({ success: false, error: "Rate limit exceeded", retryAfter: 60 });
    } else {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// POST /api/tweets/bulk-delete — delete multiple tweets
router.post("/tweets/bulk-delete", async (req, res) => {
  // SSE for real-time progress
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const client = getClient();
    const { tweetIds, delayMs = 1000 } = req.body;

    if (!tweetIds || !Array.isArray(tweetIds) || tweetIds.length === 0) {
      send({ type: "error", message: "No tweet IDs provided" });
      res.end();
      return;
    }

    send({ type: "start", total: tweetIds.length });

    let deleted = 0;
    let failed = 0;

    for (let i = 0; i < tweetIds.length; i++) {
      const id = tweetIds[i];
      try {
        await client.v2.deleteTweet(id);
        deleted++;
        send({
          type: "progress",
          current: i + 1,
          total: tweetIds.length,
          deleted,
          failed,
          tweetId: id,
          status: "deleted",
        });
      } catch (err) {
        if (err.code === 429) {
          send({ type: "ratelimit", message: "Rate limit, waiting 60s...", current: i + 1, total: tweetIds.length });
          await new Promise((r) => setTimeout(r, 60000));
          i--; // retry
          continue;
        }
        failed++;
        send({
          type: "progress",
          current: i + 1,
          total: tweetIds.length,
          deleted,
          failed,
          tweetId: id,
          status: "failed",
          error: err.message,
        });
      }

      if (i < tweetIds.length - 1) {
        await new Promise((r) => setTimeout(r, parseInt(delayMs)));
      }
    }

    send({ type: "complete", deleted, failed, total: tweetIds.length });
    res.end();
  } catch (err) {
    send({ type: "error", message: err.message });
    res.end();
  }
});

module.exports = router;
