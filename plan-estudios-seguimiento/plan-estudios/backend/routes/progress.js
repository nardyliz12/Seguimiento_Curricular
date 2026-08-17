const express = require("express");
const router = express.Router();
const db = require("../db");

const VALID_STATUS = ["pending", "planned", "in_progress", "completed"];

function courseExists(code) {
  return db.prepare(`SELECT code FROM courses WHERE code = ?`).get(code);
}

// PUT /api/progress/:code  { status, grade?, cycleTaken?, assignedCourseCode? }
router.put("/:code", (req, res) => {
  const { code } = req.params;
  const { status, grade, cycleTaken, assignedCourseCode } = req.body;

  const course = courseExists(code);
  if (!course) return res.status(404).json({ error: `Curso/slot ${code} no existe en la malla.` });

  if (status && !VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: `status inválido. Usa: ${VALID_STATUS.join(", ")}` });
  }

  // Si es un slot de electiva/complementaria y se marca completado o en curso,
  // se recomienda haber asignado antes el curso real (assignedCourseCode), pero no es obligatorio.
  const existing = db.prepare(`SELECT * FROM progress WHERE code = ?`).get(code);

  const newStatus = status ?? existing?.status ?? "pending";
  const newGrade = grade !== undefined ? grade : existing?.grade ?? null;
  const newCycleTaken = cycleTaken !== undefined ? cycleTaken : existing?.cycleTaken ?? null;
  const newAssigned = assignedCourseCode !== undefined ? assignedCourseCode : existing?.assignedCourseCode ?? null;

  db.prepare(`
    INSERT INTO progress (code, status, grade, cycleTaken, assignedCourseCode, updatedAt)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(code) DO UPDATE SET
      status = excluded.status,
      grade = excluded.grade,
      cycleTaken = excluded.cycleTaken,
      assignedCourseCode = excluded.assignedCourseCode,
      updatedAt = datetime('now')
  `).run(code, newStatus, newGrade, newCycleTaken, newAssigned);

  const updated = db.prepare(`SELECT * FROM progress WHERE code = ?`).get(code);
  res.json({ ok: true, progress: updated });
});

// POST /api/progress/bulk  { updates: [{code, status, grade?, cycleTaken?}] }
// Usado por la carga de CSV / notas
router.post("/bulk", (req, res) => {
  const { updates } = req.body;
  if (!Array.isArray(updates)) return res.status(400).json({ error: "Se esperaba un array 'updates'." });

  const results = { applied: [], skipped: [] };

  const tx = db.transaction((items) => {
    for (const item of items) {
      const { code, status, grade, cycleTaken, assignedCourseCode } = item;
      if (!code || !courseExists(code)) {
        results.skipped.push({ code, reason: "código no encontrado en la malla" });
        continue;
      }
      const st = VALID_STATUS.includes(status) ? status : "completed";
      const existing = db.prepare(`SELECT * FROM progress WHERE code = ?`).get(code);
      const newAssigned = assignedCourseCode !== undefined ? assignedCourseCode : existing?.assignedCourseCode ?? null;
      db.prepare(`
        INSERT INTO progress (code, status, grade, cycleTaken, assignedCourseCode, updatedAt)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(code) DO UPDATE SET
          status = excluded.status,
          grade = excluded.grade,
          cycleTaken = excluded.cycleTaken,
          assignedCourseCode = excluded.assignedCourseCode,
          updatedAt = datetime('now')
      `).run(code, st, grade ?? null, cycleTaken ?? null, newAssigned);
      results.applied.push(code);
    }
  });

  tx(updates);
  res.json({ ok: true, ...results });
});

// POST /api/progress/reset -> limpia todo el progreso (vuelve todo a pending)
router.post("/reset", (req, res) => {
  db.prepare(`UPDATE progress SET status='pending', grade=NULL, cycleTaken=NULL, assignedCourseCode=NULL, updatedAt=datetime('now')`).run();
  res.json({ ok: true });
});

module.exports = router;
