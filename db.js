// db.js — SQLite database setup and data access helpers.
// Uses better-sqlite3: a real, on-disk, single-file SQL database (data/wayfind.db).
// Everything written through the functions below survives server restarts.

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const db = new Database(path.join(DATA_DIR, "wayfind.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    spec TEXT NOT NULL,
    rating REAL NOT NULL DEFAULT 4.7,
    years INTEGER NOT NULL DEFAULT 5,
    color TEXT NOT NULL DEFAULT '#0f3d3e'
  );

  CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    day TEXT NOT NULL,        -- YYYY-MM-DD
    time TEXT NOT NULL,       -- e.g. "9:00 AM"
    is_booked INTEGER NOT NULL DEFAULT 0,
    UNIQUE(doctor_id, day, time)
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id INTEGER NOT NULL REFERENCES slots(id),
    doctor_id INTEGER NOT NULL REFERENCES doctors(id),
    day TEXT NOT NULL,
    time TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    patient_phone TEXT NOT NULL,
    patient_email TEXT,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'confirmed',   -- confirmed | cancelled
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const TIME_SLOTS = ["9:00 AM","9:40 AM","10:20 AM","11:00 AM","11:40 AM","2:00 PM","2:40 PM","3:20 PM","4:00 PM"];
const COLORS = ["#0f3d3e","#e8a33d","#e4634f","#3d5049","#1c5c58","#c9822a"];

function dayKey(d) { return d.toISOString().slice(0, 10); }
function nextDays(n) {
  const out = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    out.push(dayKey(d));
  }
  return out;
}

// Deterministic pseudo-random so a fresh seed looks "alive" but stable.
function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function generateSlotsForDoctor(doctorId, days) {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO slots (doctor_id, day, time, is_booked) VALUES (?, ?, ?, 0)"
  );
  const rnd = seededRandom(doctorId * 97 + 13);
  const tx = db.transaction(() => {
    days.forEach((day) => {
      TIME_SLOTS.forEach((time) => {
        if (rnd() > 0.45) insert.run(doctorId, day, time);
      });
    });
  });
  tx();
}

function seedIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM doctors").get().c;
  if (count === 0) {
    const seedDoctors = [
      { name: "Dr. Meera Nair", spec: "General Physician", rating: 4.9, years: 11 },
      { name: "Dr. Aditya Rao", spec: "Cardiology", rating: 4.8, years: 15 },
      { name: "Dr. Farah Sheikh", spec: "Dermatology", rating: 4.7, years: 8 },
      { name: "Dr. Karan Vora", spec: "Orthopedics", rating: 4.6, years: 13 },
      { name: "Dr. Priya Menon", spec: "Pediatrics", rating: 5.0, years: 9 },
      { name: "Dr. Ishaan Kapoor", spec: "Psychiatry", rating: 4.8, years: 7 },
      { name: "Dr. Leela Iyer", spec: "General Physician", rating: 4.5, years: 19 },
      { name: "Dr. Rohan Das", spec: "Cardiology", rating: 4.9, years: 12 },
      { name: "Dr. Sana Qureshi", spec: "Dermatology", rating: 4.6, years: 6 },
    ];
    const insertDoc = db.prepare(
      "INSERT INTO doctors (name, spec, rating, years, color) VALUES (?, ?, ?, ?, ?)"
    );
    const days = nextDays(6);
    seedDoctors.forEach((d, i) => {
      const info = insertDoc.run(d.name, d.spec, d.rating, d.years, COLORS[i % COLORS.length]);
      generateSlotsForDoctor(info.lastInsertRowid, days);
    });
  }

  const adminCount = db.prepare("SELECT COUNT(*) AS c FROM admins").get().c;
  if (adminCount === 0) {
    const hash = bcrypt.hashSync("admin123", 10);
    db.prepare("INSERT INTO admins (username, password_hash) VALUES (?, ?)").run("admin", hash);
    console.log("Created default admin: username 'admin', password 'admin123' — change this immediately (see admin dashboard).");
  }
}
seedIfEmpty();

// ---------- Doctors ----------
function listDoctors() {
  return db.prepare("SELECT * FROM doctors ORDER BY id").all();
}
function getDoctor(id) {
  return db.prepare("SELECT * FROM doctors WHERE id = ?").get(id);
}
function addDoctor({ name, spec, rating, years, color }) {
  const info = db
    .prepare("INSERT INTO doctors (name, spec, rating, years, color) VALUES (?, ?, ?, ?, ?)")
    .run(name, spec, rating || 4.7, years || 5, color || COLORS[Math.floor(Math.random() * COLORS.length)]);
  generateSlotsForDoctor(info.lastInsertRowid, nextDays(6));
  return getDoctor(info.lastInsertRowid);
}
function updateDoctor(id, { name, spec, rating, years, color }) {
  db.prepare(
    "UPDATE doctors SET name = ?, spec = ?, rating = ?, years = ?, color = ? WHERE id = ?"
  ).run(name, spec, rating, years, color, id);
  return getDoctor(id);
}
function deleteDoctor(id) {
  db.prepare("DELETE FROM doctors WHERE id = ?").run(id);
}

// ---------- Slots / availability ----------
function availabilityForDoctor(doctorId) {
  const days = nextDays(6);
  const rows = db
    .prepare("SELECT day, time FROM slots WHERE doctor_id = ? AND is_booked = 0 AND day IN (" + days.map(() => "?").join(",") + ") ORDER BY day, time")
    .all(doctorId, ...days);
  const byDay = {};
  days.forEach((d) => (byDay[d] = []));
  rows.forEach((r) => byDay[r.day].push(r.time));
  return byDay;
}
function soonestSlot(doctorId) {
  const row = db
    .prepare("SELECT day, time FROM slots WHERE doctor_id = ? AND is_booked = 0 ORDER BY day, time LIMIT 1")
    .get(doctorId);
  return row || null;
}

// ---------- Booking ----------
function bookSlot({ doctorId, day, time, patient }) {
  const slot = db
    .prepare("SELECT * FROM slots WHERE doctor_id = ? AND day = ? AND time = ? AND is_booked = 0")
    .get(doctorId, day, time);
  if (!slot) return { error: "That slot is no longer available." };

  const now = new Date();
  const slotDateTime = new Date(`${day} ${time}`);
  if (slotDateTime < now) return { error: "Cannot book an appointment in the past." };


  const tx = db.transaction(() => {
    db.prepare("UPDATE slots SET is_booked = 1 WHERE id = ?").run(slot.id);
    const info = db
      .prepare(
        `INSERT INTO appointments (slot_id, doctor_id, day, time, patient_name, patient_phone, patient_email, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(slot.id, doctorId, day, time, patient.name, patient.phone, patient.email || "", patient.reason || "");
    return info.lastInsertRowid;
  });
  const id = tx();
  return { appointment: db.prepare("SELECT * FROM appointments WHERE id = ?").get(id) };
}

function listAppointments() {
  return db
    .prepare(
      `SELECT a.*, d.name AS doctor_name, d.spec AS doctor_spec, d.color AS doctor_color
       FROM appointments a JOIN doctors d ON d.id = a.doctor_id
       ORDER BY a.created_at DESC`
    )
    .all();
}

function cancelAppointment(id) {
  const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id);
  if (!appt) return { error: "Not found" };
  const tx = db.transaction(() => {
    db.prepare("UPDATE slots SET is_booked = 0 WHERE id = ?").run(appt.slot_id);
    db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?").run(id);
  });
  tx();
  return { ok: true };
}

// ---------- Admin auth ----------
function verifyAdmin(username, password) {
  const row = db.prepare("SELECT * FROM admins WHERE username = ?").get(username);
  if (!row) return false;
  return bcrypt.compareSync(password, row.password_hash);
}
function changeAdminPassword(username, newPassword) {
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE admins SET password_hash = ? WHERE username = ?").run(hash, username);
}
function createSession(username, token) {
  db.prepare("INSERT INTO sessions (token, username) VALUES (?, ?)").run(token, username);
}
function getSession(token) {
  return db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
}
function deleteSession(token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

module.exports = {
  TIME_SLOTS,
  nextDays,
  listDoctors,
  getDoctor,
  addDoctor,
  updateDoctor,
  deleteDoctor,
  availabilityForDoctor,
  soonestSlot,
  bookSlot,
  listAppointments,
  cancelAppointment,
  verifyAdmin,
  changeAdminPassword,
  createSession,
  getSession,
  deleteSession,
};
