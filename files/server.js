// ─────────────────────────────────────────────────────
//  Vertex Bank – Backend Server
//  Stack : Node.js + Express + MySQL + Nodemailer
//  File  : server.js
//
//  Install dependencies:
//  npm install express mysql2 bcryptjs jsonwebtoken cors nodemailer
// ─────────────────────────────────────────────────────

const express    = require("express");
const mysql      = require("mysql2/promise");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const cors       = require("cors");
const nodemailer = require("nodemailer");

const app  = express();
const PORT = 3000;

// ─── CHANGE THESE BEFORE DEPLOYING ───────────────────
const JWT_SECRET   = "your_secret_key_change_this";

// Create a dedicated Gmail account for your project
// e.g. vertexbank.noreply@gmail.com
// Then enable "App Passwords" in Google Account settings
// and paste the 16-character app password below
const GMAIL_USER = "your_project_email@gmail.com";   // ← your Gmail
const GMAIL_PASS = "xxxx xxxx xxxx xxxx";             // ← Gmail App Password (not your real password!)
// ─────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// ─── DATABASE CONNECTION ──────────────────────────────
const db = mysql.createPool({
  host:     process.env.MYSQL_HOST     || "localhost",
  user:     process.env.MYSQL_USER     || "root",
  password: process.env.MYSQL_PASSWORD || "yourpassword",
  database: process.env.MYSQL_DATABASE || "vertexbank"
});

// ─── EMAIL TRANSPORTER (Nodemailer + Gmail) ───────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS   // This is the App Password, NOT your Gmail login password
  }
});

// ─── IN-MEMORY OTP STORE ──────────────────────────────
// Stores OTPs temporarily while user verifies.
// Format: { "email@x.com": { otp: "482910", expiresAt: <timestamp>, name, password, deposit } }
// We don't save the user to DB until OTP is verified.
const otpStore = {};

// ─── HELPER: Generate 6-digit OTP ────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── HELPER: Send OTP Email ───────────────────────────
async function sendOTPEmail(toEmail, otp, name) {
  const mailOptions = {
    from: `"Vertex Bank" <${GMAIL_USER}>`,
    to: toEmail,
    subject: "Your Vertex Bank Verification Code",
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 40px 32px; background: #ffffff; border: 1px solid #e8e6e0;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-block; border: 1.5px solid #C9A84C; border-radius: 4px; padding: 8px 14px;">
            <span style="font-size: 16px; letter-spacing: 0.12em; color: #0C1F3F; font-weight: 600;">VERTEX BANK</span>
          </div>
        </div>

        <p style="font-size: 15px; color: #1A1916; margin-bottom: 8px;">Dear ${name},</p>
        <p style="font-size: 14px; color: #6B6860; line-height: 1.7; margin-bottom: 28px;">
          Thank you for opening an account with Vertex Bank. Use the verification code below to complete your registration.
        </p>

        <div style="background: #F7F5F0; border: 1px solid #E8E6E0; border-radius: 4px; padding: 28px; text-align: center; margin-bottom: 28px;">
          <p style="font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: #ADAAA2; margin-bottom: 12px;">Your verification code</p>
          <p style="font-size: 40px; font-weight: 600; letter-spacing: 0.3em; color: #0C1F3F; margin: 0; font-family: 'Courier New', monospace;">${otp}</p>
          <p style="font-size: 12px; color: #ADAAA2; margin-top: 12px; margin-bottom: 0;">Valid for 10 minutes</p>
        </div>

        <p style="font-size: 13px; color: #ADAAA2; line-height: 1.6;">
          If you did not request this, please ignore this email. Do not share this code with anyone.
        </p>

        <hr style="border: none; border-top: 0.5px solid #E8E6E0; margin: 28px 0;" />
        <p style="font-size: 11px; color: #ADAAA2; text-align: center; letter-spacing: 0.05em;">
          © 2026 VERTEX BANK · This is an automated message, please do not reply.
        </p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}

// ─── MIDDLEWARE: Verify JWT Token ─────────────────────
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ─────────────────────────────────────────────────────
//  ROUTE 1: Send OTP
//  POST /api/send-otp
//  Body: { name, email, password, opening_deposit }
//
//  What it does:
//  - Validates inputs
//  - Checks email isn't already registered
//  - Generates a 6-digit OTP
//  - Stores OTP + user details temporarily in memory
//  - Sends OTP to user's email via Gmail
//  - Does NOT create the DB user yet (that happens after OTP verify)
// ─────────────────────────────────────────────────────
app.post("/api/send-otp", async (req, res) => {
  const { name, email, password, opening_deposit } = req.body;

  // Basic validation
  if (!name || !email || !password || !opening_deposit) {
    return res.status(400).json({ error: "All fields are required" });
  }
  if (opening_deposit < 1000) {
    return res.status(400).json({ error: "Minimum deposit is ₹1,000" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    // Check if email already exists in DB
    const [existing] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: "This email is already registered. Please sign in." });
    }

    // Generate OTP and set expiry (10 minutes from now)
    const otp       = generateOTP();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes in milliseconds

    // Hash the password now so we don't store it in plain text even temporarily
    const hashedPassword = await bcrypt.hash(password, 10);

    // Store everything in memory under this email key
    otpStore[email] = {
      otp,
      expiresAt,
      name,
      hashedPassword,
      opening_deposit
    };

    // Send the email
    await sendOTPEmail(email, otp, name.split(" ")[0]);

    console.log(`OTP sent to ${email}: ${otp}`); // visible in your Render logs (remove in production)

    res.json({ message: "OTP sent successfully. Please check your email." });

  } catch (err) {
    console.error("send-otp error:", err);
    res.status(500).json({ error: "Failed to send OTP. Check your Gmail config." });
  }
});

// ─────────────────────────────────────────────────────
//  ROUTE 2: Verify OTP + Create Account
//  POST /api/verify-otp
//  Body: { email, otp }
//
//  What it does:
//  - Checks OTP exists for this email
//  - Checks OTP hasn't expired
//  - Checks OTP matches
//  - Creates the user in MySQL
//  - Records opening deposit transaction
//  - Clears OTP from memory
//  - Returns account number
// ─────────────────────────────────────────────────────
app.post("/api/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ error: "Email and OTP are required" });
  }

  const record = otpStore[email];

  // Check OTP exists
  if (!record) {
    return res.status(400).json({ error: "No OTP found for this email. Please sign up again." });
  }

  // Check OTP hasn't expired
  if (Date.now() > record.expiresAt) {
    delete otpStore[email]; // clean up expired OTP
    return res.status(400).json({ error: "OTP has expired. Please sign up again to get a new code." });
  }

  // Check OTP matches
  if (record.otp !== otp.toString().trim()) {
    return res.status(400).json({ error: "Incorrect OTP. Please try again." });
  }

  // OTP is valid — now create the account in MySQL
  try {
    const accountNo = Math.floor(1000000000 + Math.random() * 9000000000).toString();

    const [result] = await db.query(
      "INSERT INTO users (name, email, password, account_no, balance) VALUES (?, ?, ?, ?, ?)",
      [record.name, email, record.hashedPassword, accountNo, record.opening_deposit]
    );

    // Record the opening deposit as a transaction
    await db.query(
      "INSERT INTO transactions (user_id, description, type, amount) VALUES (?, ?, ?, ?)",
      [result.insertId, "Account Opening Deposit", "credit", record.opening_deposit]
    );

    // Clean up OTP from memory
    delete otpStore[email];

    res.status(201).json({
      message: "Account created successfully!",
      accountNo
    });

  } catch (err) {
    console.error("verify-otp error:", err);
    res.status(500).json({ error: "Server error while creating account." });
  }
});

// ─── ROUTE: Resend OTP ────────────────────────────────
// POST /api/resend-otp
// Body: { email }
// Only works if there's already a pending OTP for this email
app.post("/api/resend-otp", async (req, res) => {
  const { email } = req.body;
  const record = otpStore[email];

  if (!record) {
    return res.status(400).json({ error: "No pending signup for this email. Please start again." });
  }

  // Generate fresh OTP and reset expiry
  const otp       = generateOTP();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  record.otp       = otp;
  record.expiresAt = expiresAt;

  try {
    await sendOTPEmail(email, otp, record.name.split(" ")[0]);
    console.log(`OTP resent to ${email}: ${otp}`);
    res.json({ message: "A new OTP has been sent to your email." });
  } catch (err) {
    console.error("resend-otp error:", err);
    res.status(500).json({ error: "Failed to resend OTP." });
  }
});

// ─── ROUTE: Login ─────────────────────────────────────
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const user = rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ token, user: { name: user.name, email: user.email, accountNo: user.account_no } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── ROUTE: Get Account Summary ───────────────────────
app.get("/api/account", authenticate, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT name, email, account_no, balance FROM users WHERE id = ?", [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ─── ROUTE: Get Transactions ──────────────────────────
app.get("/api/transactions", authenticate, async (req, res) => {
  const { type } = req.query;
  let query  = "SELECT * FROM transactions WHERE user_id = ?";
  const params = [req.user.id];
  if (type === "credit" || type === "debit") { query += " AND type = ?"; params.push(type); }
  query += " ORDER BY created_at DESC";
  try {
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ─── ROUTE: Transfer Money ────────────────────────────
app.post("/api/transfer", authenticate, async (req, res) => {
  const { recipient_name, recipient_account, amount, remark } = req.body;
  if (!recipient_name || !recipient_account || !amount || amount <= 0) {
    return res.status(400).json({ error: "All fields are required" });
  }
  try {
    const [rows] = await db.query("SELECT balance FROM users WHERE id = ?", [req.user.id]);
    if (amount > rows[0].balance) {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    await db.query("UPDATE users SET balance = balance - ? WHERE id = ?", [amount, req.user.id]);
    const description = `Transfer to ${recipient_name} (A/C: ${recipient_account}) – ${remark || "Transfer"}`;
    await db.query(
      "INSERT INTO transactions (user_id, description, type, amount) VALUES (?, ?, ?, ?)",
      [req.user.id, description, "debit", amount]
    );
    const [updated] = await db.query("SELECT balance FROM users WHERE id = ?", [req.user.id]);
    res.json({ message: "Transfer successful", newBalance: updated[0].balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── START SERVER ─────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Vertex Bank server running at http://localhost:${PORT}`);
});
