const express = require("express");
const router = express.Router();
const db = require("../db");
const { buildCurriculumView, getPoolItems, getProgressMap, isUnlocked, approvedCreditsTotal, getAllCourses } = require("../logic");

// GET /api/curriculum -> malla completa agrupada por ciclo con estado calculado
router.get("/", (req, res) => {
  const meta = Object.fromEntries(db.prepare(`SELECT key, value FROM meta`).all().map((r) => [r.key, r.value]));
  const cycles = buildCurriculumView();
  res.json({ meta, cycles });
});

// GET /api/curriculum/pool/:group -> lista de cursos disponibles del pool (ELECTIVA | COMPLEMENTARIA)
router.get("/pool/:group", (req, res) => {
  const group = req.params.group.toUpperCase();
  if (!["ELECTIVA", "COMPLEMENTARIA"].includes(group)) {
    return res.status(400).json({ error: "Grupo inválido. Usa ELECTIVA o COMPLEMENTARIA." });
  }
  const items = getPoolItems(group);
  const progressMap = getProgressMap();
  const courses = getAllCourses();
  const approvedCredits = approvedCreditsTotal(progressMap, courses);

  const withStatus = items.map((it) => {
    const unlocked = isUnlocked(it, progressMap, approvedCredits);
    return {
      code: it.code,
      name: it.name,
      credits: it.credits,
      prereqCodes: JSON.parse(it.prereqCodes || "[]"),
      unlocked,
    };
  });

  res.json({ group, items: withStatus });
});

module.exports = router;
