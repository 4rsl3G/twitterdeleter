require("dotenv").config();
const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const session = require("express-session");
const path = require("path");

const indexRouter = require("./routes/index");
const authRouter  = require("./routes/auth");
const apiRouter   = require("./routes/api");

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layouts/main");

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "tw-deleter-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

// Make user available in all views
app.use((req, res, next) => {
  res.locals.user    = req.session.user || null;
  res.locals.isAuth  = !!req.session.accessToken;
  next();
});

// Routes
app.use("/", indexRouter);
app.use("/auth", authRouter);
app.use("/api", apiRouter);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`\x1b[32m✓ TweetReaper running at http://localhost:${PORT}\x1b[0m`);
  if (!process.env.TWITTER_API_KEY) {
    console.log(`\x1b[33m⚠  Set TWITTER_API_KEY and TWITTER_API_SECRET in .env\x1b[0m`);
  }
});
