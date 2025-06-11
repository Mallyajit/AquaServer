// server.js
require("dotenv").config();
const express = require("express");
const fs = require("fs");
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
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const time = hour + minute / 60; // fractional hour (0 - 24)

  // Normalize time to daylight range (6:00 to 18:00)
  // Outside this range, lights are dim/night mode
  if (time < 6 || time >= 18) {
    // 🌙 Night (blue dim)
    return res.json({ r: 20, g: 20, b: 60 });
  }

  // Map time to angle: 6:00 -> 0°, 12:00 -> 90°, 18:00 -> 180°
  const angleDeg = ((time - 6) / 12) * 180;
  const angleRad = (angleDeg * Math.PI) / 180;

  // Use sine curve to calculate intensity: sin(0) = 0 (sunrise), sin(90°) = 1 (noon), sin(180°) = 0 (sunset)
  const intensity = Math.sin(angleRad);

  // Map color temperature: sunrise (orange) → midday (white) → sunset (reddish)
  const sunriseColor = { r: 255, g: 150, b: 50 };
  const noonColor = { r: 255, g: 255, b: 255 };
  const sunsetColor = { r: 255, g: 100, b: 100 };

  let r, g, b;

  if (time < 12) {
    // 🌅 Sunrise to noon
    r = sunriseColor.r + intensity * (noonColor.r - sunriseColor.r);
    g = sunriseColor.g + intensity * (noonColor.g - sunriseColor.g);
    b = sunriseColor.b + intensity * (noonColor.b - sunriseColor.b);
  } else {
    // 🌇 Noon to sunset
    r = noonColor.r - (1 - intensity) * (noonColor.r - sunsetColor.r);
    g = noonColor.g - (1 - intensity) * (noonColor.g - sunsetColor.g);
    b = noonColor.b - (1 - intensity) * (noonColor.b - sunsetColor.b);
  }

  res.json({
    r: Math.round(r),
    g: Math.round(g),
    b: Math.round(b),
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
  user.settings.autoDaylight = autoDaylight;
  saveUsers(users);
  res.json({ success: true });
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

// --- Start Server ---
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
