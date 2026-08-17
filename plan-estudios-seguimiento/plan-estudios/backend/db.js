const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "plan.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS courses (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cycle INTEGER,
    credits INTEGER NOT NULL,
    studyType TEXT,
    category TEXT NOT NULL,           -- OBLIGATORIO | ELECTIVA | COMPLEMENTARIA
    prereqCodes TEXT NOT NULL DEFAULT '[]',
    prereqCredits INTEGER NOT NULL DEFAULT 0,
    poolGroup TEXT,                   -- ELECTIVA | COMPLEMENTARIA | NULL for real slots
    isPoolItem INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS progress (
    code TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | in_progress | completed
    grade REAL,
    cycleTaken INTEGER,
    assignedCourseCode TEXT,          -- for ELECTIVA/COMPLEMENTARIA slots: which pool item fulfills it
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(code) REFERENCES courses(code)
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

module.exports = db;
