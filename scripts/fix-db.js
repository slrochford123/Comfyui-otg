const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "../data/otg.db");
const db = new Database(dbPath);

console.log("Connected to DB:", dbPath);

try {
  db.exec(`ALTER TABLE users ADD COLUMN username TEXT`);
  console.log("✅ Column 'username' added successfully.");
} catch (err) {
  if (String(err).includes("duplicate column")) {
    console.log("ℹ️ Column 'username' already exists.");
  } else {
    console.error("❌ Error:", err.message);
  }
}

db.close();
