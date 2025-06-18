// server.js
require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;
const USERS_FILE = "users.json";

app.use(cors());
app.use(bodyParser.json());

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("CRITICAL ERROR: JWT_SECRET not found in .env file!");
  process.exit(1);
}

// --- User Data Management ---
function loadUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE);
    const users = JSON.parse(data);
    return Array.isArray(users) ? users : [];
  } catch (error) {
    console.error(`Error loading ${USERS_FILE}:`, error.message);
    if (error.code === "ENOENT") {
      console.log(`Creating empty ${USERS_FILE}.`);
      saveUsers([]);
    }
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// --- Authentication Middleware ---
function authMiddleware(req, res, next) {
  const token =
    req.headers.authorization && req.headers.authorization.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Missing token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.email = decoded.email;
    req.firstName = decoded.firstName;
    next();
  } catch (err) {
    console.error("JWT verification error:", err.message);
    return res.status(403).json({ message: "Invalid or expired token" });
  }
}

// --- API Routes ---

//Time sync/colour sync in daylight mode
app.get("/api/auto-light", (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const usersPath = path.join(__dirname, "users.json");
  let users = [];

  try {
    users = JSON.parse(fs.readFileSync(usersPath, "utf-8"));
  } catch (err) {
    return res.status(500).json({ error: "Failed to read user data" });
  }

  const user = users.find((u) => u.email === email);
  if (!user || !user.settings) {
    return res
      .status(404)
      .json({ error: "User not found or missing settings" });
  }

  const brightness = user.settings.brightness || 255; // fallback to full brightness

  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const time = hour + minute / 60;

  if (time < 6 || time >= 18) {
    return res.json({
      r: Math.round((20 * brightness) / 255),
      g: Math.round((20 * brightness) / 255),
      b: Math.round((60 * brightness) / 255),
    });
  }

  const angleDeg = ((time - 6) / 12) * 180;
  const angleRad = (angleDeg * Math.PI) / 180;
  const intensity = Math.sin(angleRad);

  const sunriseColor = { r: 255, g: 150, b: 50 };
  const noonColor = { r: 255, g: 255, b: 255 };
  const sunsetColor = { r: 255, g: 100, b: 100 };

  let r, g, b;

  if (time < 12) {
    r = sunriseColor.r + intensity * (noonColor.r - sunriseColor.r);
    g = sunriseColor.g + intensity * (noonColor.g - sunriseColor.g);
    b = sunriseColor.b + intensity * (noonColor.b - sunriseColor.b);
  } else {
    r = noonColor.r - (1 - intensity) * (noonColor.r - sunsetColor.r);
    g = noonColor.g - (1 - intensity) * (noonColor.g - sunsetColor.g);
    b = noonColor.b - (1 - intensity) * (noonColor.b - sunsetColor.b);
  }

  res.json({
    r: Math.round((r * brightness) / 255),
    g: Math.round((g * brightness) / 255),
    b: Math.round((b * brightness) / 255),
  });
});

//Verify Token
app.post("/api/verify-token", authMiddleware, (req, res) => {
  res.json({
    email: req.email,
    firstName: req.firstName,
    message: "Token is valid",
  });
});

// ✅ Register a new user
app.post("/register", (req, res) => {
  const { firstName, lastName, email, password } = req.body;
  const users = loadUsers();

  if (users.some((user) => user.email === email)) {
    return res.status(400).json({ message: "Email already exists" });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  users.push({
    firstName,
    lastName,
    email,
    password: hashedPassword,
    settings: {},
  });
  saveUsers(users);
  res.status(201).json({ message: "Registration successful" });
});

// ✅ Login user and return JWT
// ✅ Login user and return JWT
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  const users = loadUsers();
  const user = users.find((u) => u.email === email);

  if (!user) {
    console.log(`Login failed: email not found - ${email}`);
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const passwordMatches = bcrypt.compareSync(password, user.password);
  if (!passwordMatches) {
    console.log(`Login failed: incorrect password for ${email}`);
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign(
    { email: user.email, firstName: user.firstName },
    JWT_SECRET,
    { expiresIn: "2h" }
  );

  res.json({ token });
});

// ✅ Get user-specific settings
app.get("/settings", authMiddleware, (req, res) => {
  const users = loadUsers();
  const user = users.find((u) => u.email === req.email);
  if (!user) {
    return res
      .status(404)
      .json({ message: "User data not found for this token" });
  }
  res.json(user.settings || {});
});

// ✅ Save user-specific settings
app.post("/settings", authMiddleware, (req, res) => {
  const { r, g, b, brightness, filter } = req.body;
  const users = loadUsers();
  const userIndex = users.findIndex((u) => u.email === req.email);

  if (userIndex === -1) {
    return res.status(404).json({ message: "User not found" });
  }

  users[userIndex].settings = {
    ...users[userIndex].settings,
    r,
    g,
    b,
    brightness,
    filter,
  };
  saveUsers(users);

  res.json({ message: "Settings saved successfully" });
});

// ✅ Get user-specific timer settings
app.get("/api/timers", authMiddleware, (req, res) => {
  const users = loadUsers();
  const user = users.find((u) => u.email === req.email);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  // Return the timer settings, or an empty object if none are saved
  res.json({
    timers: user.settings.timers || {},
    autoDaylight: user.settings.autoDaylight,
  });
});

// ✅ Save user-specific timer settings
app.post("/api/timers", authMiddleware, (req, res) => {
  // Destructure the incoming body to separate autoDaylight from timer details
  const {
    autoDaylight,
    lightTimerEnabled,
    co2TimerEnabled,
    lightTimers,
    co2Timers,
  } = req.body;

  const users = loadUsers();
  const userIndex = users.findIndex((u) => u.email === req.email);

  if (userIndex === -1) {
    return res.status(404).json({ message: "User not found" });
  }

  // Ensure the settings object exists for the user
  if (!users[userIndex].settings) {
    users[userIndex].settings = {};
  }

  // --- Crucial Fix Here ---
  // 1. Save autoDaylight directly to user.settings
  if (typeof autoDaylight === "boolean") {
    // Ensure it's a boolean
    users[userIndex].settings.autoDaylight = autoDaylight;
  } else {
    // If autoDaylight is not provided or not a boolean, keep existing or set a default
    users[userIndex].settings.autoDaylight =
      users[userIndex].settings.autoDaylight || false;
  }

  // 2. Save the timer-specific settings to user.settings.timers
  // Ensure the timers object itself exists
  if (!users[userIndex].settings.timers) {
    users[userIndex].settings.timers = {};
  }
  users[userIndex].settings.timers.lightTimerEnabled = lightTimerEnabled;
  users[userIndex].settings.timers.co2TimerEnabled = co2TimerEnabled;
  users[userIndex].settings.timers.lightTimers = lightTimers;
  users[userIndex].settings.timers.co2Timers = co2Timers;
  // --- End of Fix ---

  saveUsers(users); // Save the updated users data to your JSON file

  res.json({ message: "Timer settings saved successfully" });
});

app.post("/api/save-auto-daylight", authMiddleware, (req, res) => {
  const { autoDaylight } = req.body;
  const email = req.email;
  if (typeof autoDaylight !== "boolean") {
    return res.status(400).json({ success: false });
  }
  const users = loadUsers();
  const user = users.find((u) => u.email === email);
  if (!user) return res.status(404).json({ success: false });
  user.settings = user.settings || {};

  let lightTimerDisabled = false; // Flag to send back to the frontend

  // If autoDaylight is being turned ON (true)
  if (autoDaylight === true) {
    // Ensure timers object and lightTimerEnabled property exist before trying to access
    user.settings.timers = user.settings.timers || {};
    // Check if lightTimerEnabled was true before setting it to false
    if (user.settings.timers.lightTimerEnabled === true) {
      user.settings.timers.lightTimerEnabled = false; // Turn off light timer
      lightTimerDisabled = true; // Set flag to true for frontend alert
    }
  }

  user.settings.autoDaylight = autoDaylight;
  saveUsers(users);
  res.json({
    success: true,
    lightTimerDisabledByAutoDaylight: lightTimerDisabled,
  });
});

// POST /api/get-auto-daylight
app.post("/api/get-auto-daylight", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Missing email" });

  const users = loadUsers();
  const user = users.find((u) => u.email === email);
  if (!user) return res.status(404).json({ error: "User not found" });

  res.json(user.settings || {});
});

const hexToRgb = (hex) => {
  const bigint = parseInt(hex.replace("#", ""), 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
};

const minutesSinceMidnight = (date = new Date()) =>
  date.getHours() * 60 + date.getMinutes();

const timeToMinutes = (timeStr) => {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
};

app.get("/api/light-timer-color", (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const users = loadUsers();
  const user = users.find((u) => u.email === email);

  if (!user || !user.settings || !user.settings.timers) {
    return res.status(404).json({ error: "User or settings not found" });
  }

  const { lightTimerEnabled, lightTimers } = user.settings.timers;
  const brightness = user.settings.brightness || 255;

  if (!lightTimerEnabled || !Array.isArray(lightTimers)) {
    return res.json({ color: null }); // light timer not enabled
  }

  const now = new Date();
  const nowMins = minutesSinceMidnight(now);

  for (const timer of lightTimers) {
    const fadeIn = timeToMinutes(timer.fadeIn);
    const peakStart = timeToMinutes(timer.peakStart);
    const peakEnd = timeToMinutes(timer.peakEnd);
    const fadeOut = timeToMinutes(timer.fadeOut);
    const color = hexToRgb(timer.color);

    // Fade In Period (fadeIn → peakStart)
    const fadeInDuration = (peakStart - fadeIn + 1440) % 1440;
    const fadeInElapsed = (nowMins - fadeIn + 1440) % 1440;
    if (fadeInElapsed < fadeInDuration) {
      const progress = fadeInElapsed / fadeInDuration;
      return res.json({
        r: Math.round((color.r * progress * brightness) / 255),
        g: Math.round((color.g * progress * brightness) / 255),
        b: Math.round((color.b * progress * brightness) / 255),
      });
    }

    // Peak Period (peakStart → peakEnd)
    const inPeak =
      (peakStart <= peakEnd && nowMins >= peakStart && nowMins < peakEnd) ||
      (peakStart > peakEnd && (nowMins >= peakStart || nowMins < peakEnd));
    if (inPeak) {
      return res.json({
        r: Math.round((color.r * brightness) / 255),
        g: Math.round((color.g * brightness) / 255),
        b: Math.round((color.b * brightness) / 255),
      });
    }

    // Fade Out Period (peakEnd → fadeOut)
    const fadeOutDuration = (fadeOut - peakEnd + 1440) % 1440;
    const fadeOutElapsed = (nowMins - peakEnd + 1440) % 1440;
    if (fadeOutElapsed < fadeOutDuration) {
      const progress = 1 - fadeOutElapsed / fadeOutDuration;
      return res.json({
        r: Math.round((color.r * progress * brightness) / 255),
        g: Math.round((color.g * progress * brightness) / 255),
        b: Math.round((color.b * progress * brightness) / 255),
      });
    }
  }

  // No active timer window matched
  return res.json({ color: null });
});

// --- Start Server ---
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
