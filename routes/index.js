const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  const configured = !!(
    process.env.TWITTER_API_KEY &&
    process.env.TWITTER_API_SECRET &&
    process.env.TWITTER_ACCESS_TOKEN &&
    process.env.TWITTER_ACCESS_SECRET
  );
  res.render("pages/home", {
    title: "TweetReaper — Twitter Bulk Deleter",
    configured,
    layout: "layouts/main",
  });
});

router.get("/dashboard", (req, res) => {
  res.render("pages/dashboard", {
    title: "Dashboard — TweetReaper",
    layout: "layouts/main",
  });
});

module.exports = router;
