const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const COOKIE_NAME = "wf_admin_session";

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ---------- Admin auth middleware ----------
function requireAdmin(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  const session = token && db.getSession(token);
  if (!session) return res.status(401).json({ error: "Not authenticated" });
  req.adminUsername = session.username;
  next();
}

// ================= PUBLIC API =================

app.get("/api/doctors", (req, res) => {
  const doctors = db.listDoctors().map((d) => ({ ...d, nextSlot: db.soonestSlot(d.id) }));
  res.json(doctors);
});

app.get("/api/doctors/:id/availability", (req, res) => {
  const doctor = db.getDoctor(req.params.id);
  if (!doctor) return res.status(404).json({ error: "Doctor not found" });
  res.json({ days: db.nextDays(6), timeSlots: db.TIME_SLOTS, availability: db.availabilityForDoctor(doctor.id) });
});

app.post("/api/book", (req, res) => {
  const { doctorId, day, time, patient } = req.body || {};
  if (!doctorId || !day || !time || !patient || !patient.name || !patient.phone) {
    return res.status(400).json({ error: "Missing required booking details." });
  }
  const result = db.bookSlot({ doctorId, day, time, patient });
  if (result.error) return res.status(409).json(result);
  res.json(result);
});

// ================= ADMIN AUTH =================

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!db.verifyAdmin(username, password)) {
    return res.status(401).json({ error: "Invalid username or password." });
  }
  const token = crypto.randomBytes(24).toString("hex");
  db.createSession(username, token);
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: "lax", maxAge: 12 * 60 * 60 * 1000 });
  res.json({ ok: true, username });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  db.deleteSession(req.cookies[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({ username: req.adminUsername });
});

app.post("/api/admin/change-password", requireAdmin, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }
  db.changeAdminPassword(req.adminUsername, newPassword);
  res.json({ ok: true });
});

// ================= ADMIN: DOCTORS =================

app.get("/api/admin/doctors", requireAdmin, (req, res) => {
  res.json(db.listDoctors());
});

app.post("/api/admin/doctors", requireAdmin, (req, res) => {
  const { name, spec, rating, years, color } = req.body || {};
  if (!name || !spec) return res.status(400).json({ error: "Name and specialty are required." });
  res.json(db.addDoctor({ name, spec, rating: Number(rating) || 4.7, years: Number(years) || 5, color }));
});

app.put("/api/admin/doctors/:id", requireAdmin, (req, res) => {
  const { name, spec, rating, years, color } = req.body || {};
  res.json(db.updateDoctor(req.params.id, { name, spec, rating: Number(rating), years: Number(years), color }));
});

app.delete("/api/admin/doctors/:id", requireAdmin, (req, res) => {
  db.deleteDoctor(req.params.id);
  res.json({ ok: true });
});

// ================= ADMIN: APPOINTMENTS =================

app.get("/api/admin/appointments", requireAdmin, (req, res) => {
  res.json(db.listAppointments());
});

app.delete("/api/admin/appointments/:id", requireAdmin, (req, res) => {
  const result = db.cancelAppointment(req.params.id);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

app.listen(PORT, () => {
  console.log(`Wayfind Health running at http://localhost:${3000}`);
  console.log(`Admin dashboard at    http://localhost:${3000}/admin.html`);
});
