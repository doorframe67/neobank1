-- ─────────────────────────────────────────────────────
--  Vertex Bank – Database Schema
--  Run this file in MySQL to set up your database.
--
--  Steps:
--  1. Open MySQL Workbench (or the MySQL command line)
--  2. Copy-paste this entire file and run it
--  3. Your database is ready!
-- ─────────────────────────────────────────────────────

-- Step 1: Create the database
CREATE DATABASE IF NOT EXISTS vertexbank;
USE vertexbank;

-- Step 2: Create the users table
-- This stores all customer accounts
CREATE TABLE IF NOT EXISTS users (
  id          INT AUTO_INCREMENT PRIMARY KEY,   -- Unique ID for each user
  name        VARCHAR(100)  NOT NULL,           -- Customer's full name
  email       VARCHAR(150)  NOT NULL UNIQUE,    -- Email (must be unique, used for login)
  password    VARCHAR(255)  NOT NULL,           -- Hashed password (never store plain text!)
  account_no  VARCHAR(20)   NOT NULL UNIQUE,    -- 10-digit bank account number
  balance     DECIMAL(15,2) NOT NULL DEFAULT 0, -- Current account balance
  created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- Step 3: Create the transactions table
-- This stores every credit and debit transaction
CREATE TABLE IF NOT EXISTS transactions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT           NOT NULL,           -- Which user this transaction belongs to
  description VARCHAR(255)  NOT NULL,           -- e.g. "Transfer to Riya – Rent"
  type        ENUM('credit','debit') NOT NULL,  -- Either 'credit' (money in) or 'debit' (money out)
  amount      DECIMAL(15,2) NOT NULL,           -- Transaction amount
  created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,

  -- Link each transaction to a user (if user is deleted, transactions are too)
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─── OPTIONAL: Insert a demo user for testing ────────
-- Password is "demo123" (pre-hashed with bcrypt)
INSERT INTO users (name, email, password, account_no, balance)
VALUES (
  'Demo User',
  'demo@vertex.com',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lihO',
  '4521873690',
  85000.00
);

-- Insert some sample transactions for the demo user
INSERT INTO transactions (user_id, description, type, amount) VALUES
  (1, 'Account Opening Deposit', 'credit', 100000.00),
  (1, 'Electricity Bill Payment', 'debit', 2450.00),
  (1, 'Salary Credit', 'credit', 45000.00),
  (1, 'Transfer to Riya Sharma – Rent', 'debit', 18000.00),
  (1, 'Amazon Online Shopping', 'debit', 3750.00),
  (1, 'Interest Credit', 'credit', 1200.00);

-- ─── USEFUL QUERIES (for reference / testing) ────────

-- View all users:
-- SELECT id, name, email, account_no, balance FROM users;

-- View all transactions for a user (replace 1 with user ID):
-- SELECT * FROM transactions WHERE user_id = 1 ORDER BY created_at DESC;

-- Check total balance across all accounts:
-- SELECT SUM(balance) AS total_deposits FROM users;
