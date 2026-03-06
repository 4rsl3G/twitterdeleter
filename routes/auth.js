const express = require("express");
const router = express.Router();
const { TwitterApi } = require("twitter-api-v2");

function getAppClient() {
  if (!process.env.TWITTER_API_KEY || !process.env.TWITTER_API_SECRET) {
    throw new Error("TWITTER_API_KEY and TWITTER_API_SECRET must be set in .env");
  }
  return new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
  });
}

// GET /auth/login — initiate OAuth 1.0a flow
router.get("/login", async (req, res) => {
  try {
    const client = getAppClient();
    const callbackUrl = `${req.protocol}://${req.get("host")}/auth/callback`;
    const { url, oauth_token, oauth_token_secret } = await client.generateAuthLink(callbackUrl, {
      linkMode: "authorize",
    });

    // Store temp oauth token in session
    req.session.oauthToken = oauth_token;
    req.session.oauthTokenSecret = oauth_token_secret;

    res.redirect(url);
  } catch (err) {
    console.error("Login error:", err);
    res.redirect("/?error=" + encodeURIComponent(err.message));
  }
});

// GET /auth/callback — OAuth callback from Twitter
router.get("/callback", async (req, res) => {
  const { oauth_token, oauth_verifier } = req.query;
  const { oauthToken, oauthTokenSecret } = req.session;

  if (!oauth_token || !oauth_verifier || !oauthToken) {
    return res.redirect("/?error=oauth_failed");
  }

  if (oauth_token !== oauthToken) {
    return res.redirect("/?error=token_mismatch");
  }

  try {
    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: oauth_token,
      accessSecret: oauthTokenSecret,
    });

    const { accessToken, accessSecret, userId, screenName } =
      await client.login(oauth_verifier);

    // Fetch full profile
    const authedClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken,
      accessSecret,
    });

    const me = await authedClient.v2.me({
      "user.fields": ["public_metrics", "profile_image_url", "description", "created_at"],
    });

    // Store in session
    req.session.accessToken       = accessToken;
    req.session.accessSecret      = accessSecret;
    req.session.oauthToken        = null;
    req.session.oauthTokenSecret  = null;
    req.session.user = {
      id:              me.data.id,
      name:            me.data.name,
      username:        me.data.username,
      profileImage:    me.data.profile_image_url?.replace("_normal", "_400x400") || null,
      description:     me.data.description || "",
      tweetCount:      me.data.public_metrics?.tweet_count || 0,
      followersCount:  me.data.public_metrics?.followers_count || 0,
      followingCount:  me.data.public_metrics?.following_count || 0,
    };

    res.redirect("/dashboard");
  } catch (err) {
    console.error("Callback error:", err);
    res.redirect("/?error=" + encodeURIComponent("Authentication failed: " + err.message));
  }
});

// GET /auth/logout
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// GET /auth/status — check auth status (for AJAX)
router.get("/status", (req, res) => {
  res.json({
    authenticated: !!req.session.accessToken,
    user: req.session.user || null,
    appConfigured: !!(process.env.TWITTER_API_KEY && process.env.TWITTER_API_SECRET),
  });
});

module.exports = router;
