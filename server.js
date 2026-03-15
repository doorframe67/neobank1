const express    = require("express");
const mysql      = require("mysql2/promise");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const cors       = require("cors");
const nodemailer = require("nodemailer");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";
const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_PASS = process.env.GMAIL_PASS || "";

const db = mysql.createPool({
  host:     process.env.MYSQL_HOST,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port:     process.env.MYSQL_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10
});

async function initDB() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        name       VARCHAR(100)  NOT NULL,
        email      VARCHAR(150)  NOT NULL UNIQUE,
        password   VARCHAR(255)  NOT NULL,
        account_no VARCHAR(20)   NOT NULL UNIQUE,
        balance    DECIMAL(15,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        user_id     INT           NOT NULL,
        description VARCHAR(255)  NOT NULL,
        type        ENUM('credit','debit') NOT NULL,
        amount      DECIMAL(15,2) NOT NULL,
        created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log("DB tables ready");
  } catch (err) {
    console.error("DB init error:", err.message);
  }
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_PASS }
});

const otpStore = {};
function generateOTP() { return Math.floor(100000 + Math.random() * 900000).toString(); }

async function sendOTPEmail(toEmail, otp, name) {
  await transporter.sendMail({
    from: `"NeoBank" <${GMAIL_USER}>`,
    to: toEmail,
    subject: "Your NeoBank Verification Code",
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#fff;border:1px solid #e8e6e0;"><h2 style="color:#0C1F3F;">NEOBANK</h2><p style="color:#6B6860;font-size:14px;">Hi ${name}, here is your verification code:</p><div style="background:#F7F5F0;border-radius:4px;padding:24px;text-align:center;margin:24px 0;"><p style="font-size:36px;font-weight:bold;letter-spacing:0.3em;color:#0C1F3F;margin:0;">${otp}</p><p style="font-size:12px;color:#ADAAA2;margin-top:8px;">Valid for 10 minutes</p></div><p style="font-size:12px;color:#ADAAA2;">Do not share this code with anyone.</p></div>`
  });
}

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: "Invalid or expired token" }); }
}

app.get("/", (req, res) => res.json({ status: "NeoBank server is running!" }));

app.post("/api/send-otp", async (req, res) => {
  const { name, email, password, opening_deposit } = req.body;
  if (!name || !email || !password || !opening_deposit) return res.status(400).json({ error: "All fields are required" });
  if (opening_deposit < 1000) return res.status(400).json({ error: "Minimum deposit is 1000" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  try {
    const [existing] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length > 0) return res.status(409).json({ error: "Email already registered. Please sign in." });
    const otp = generateOTP();
    const hashedPassword = await bcrypt.hash(password, 10);
    otpStore[email] = { otp, expiresAt: Date.now() + 10 * 60 * 1000, name, hashedPassword, opening_deposit };
    await sendOTPEmail(email, otp, name.split(" ")[0]);
    console.log(`OTP for ${email}: ${otp}`);
    res.json({ message: "OTP sent successfully." });
  } catch (err) {
    console.error("send-otp error:", err.message);
    res.status(500).json({ error: "Failed to send OTP. Check GMAIL_USER and GMAIL_PASS environment variables." });
  }
});

app.post("/api/verify-otp", async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: "Email and OTP required" });
  const record = otpStore[email];
  if (!record) return res.status(400).json({ error: "No OTP found. Please sign up again." });
  if (Date.now() > record.expiresAt) { delete otpStore[email]; return res.status(400).json({ error: "OTP expired. Please sign up again." }); }
  if (record.otp !== otp.toString().trim()) return res.status(400).json({ error: "Incorrect OTP. Try again." });
  try {
    const accountNo = Math.floor(1000000000 + Math.random() * 9000000000).toString();
    const [result] = await db.query("INSERT INTO users (name,email,password,account_no,balance) VALUES (?,?,?,?,?)", [record.name, email, record.hashedPassword, accountNo, record.opening_deposit]);
    await db.query("INSERT INTO transactions (user_id,description,type,amount) VALUES (?,?,?,?)", [result.insertId, "Account Opening Deposit", "credit", record.opening_deposit]);
    delete otpStore[email];
    res.status(201).json({ message: "Account created!", accountNo });
  } catch (err) {
    console.error("verify-otp error:", err.message);
    res.status(500).json({ error: "Server error creating account." });
  }
});

app.post("/api/resend-otp", async (req, res) => {
  const { email } = req.body;
  const record = otpStore[email];
  if (!record) return res.status(400).json({ error: "No pending signup. Please start again." });
  record.otp = generateOTP();
  record.expiresAt = Date.now() + 10 * 60 * 1000;
  try {
    await sendOTPEmail(email, record.otp, record.name.split(" ")[0]);
    res.json({ message: "New OTP sent!" });
  } catch (err) {
    res.status(500).json({ error: "Failed to resend OTP." });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
    if (rows.length === 0) return res.status(401).json({ error: "Invalid email or password" });
    const match = await bcrypt.compare(password, rows[0].password);
    if (!match) return res.status(401).json({ error: "Invalid email or password" });
    const token = jwt.sign({ id: rows[0].id, email: rows[0].email }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ token, user: { name: rows[0].name, email: rows[0].email, accountNo: rows[0].account_no } });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/account", authenticate, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT name,email,account_no,balance FROM users WHERE id=?", [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.get("/api/transactions", authenticate, async (req, res) => {
  const { type } = req.query;
  let query = "SELECT * FROM transactions WHERE user_id=?";
  const params = [req.user.id];
  if (type === "credit" || type === "debit") { query += " AND type=?"; params.push(type); }
  query += " ORDER BY created_at DESC";
  try {
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.post("/api/transfer", authenticate, async (req, res) => {
  const { recipient_name, recipient_account, amount, remark } = req.body;
  if (!recipient_name || !recipient_account || !amount || amount <= 0) return res.status(400).json({ error: "All fields required" });
  try {
    const [rows] = await db.query("SELECT balance FROM users WHERE id=?", [req.user.id]);
    if (amount > rows[0].balance) return res.status(400).json({ error: "Insufficient balance" });
    await db.query("UPDATE users SET balance=balance-? WHERE id=?", [amount, req.user.id]);
    const desc = `Transfer to ${recipient_name} (A/C: ${recipient_account})${remark ? " – " + remark : ""}`;
    await db.query("INSERT INTO transactions (user_id,description,type,amount) VALUES (?,?,?,?)", [req.user.id, desc, "debit", amount]);
    const [updated] = await db.query("SELECT balance FROM users WHERE id=?", [req.user.id]);
    res.json({ message: "Transfer successful", newBalance: updated[0].balance });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, async () => {
  console.log(`NeoBank server running on port ${PORT}`);
  await initDB();
});
