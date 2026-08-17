const express = require("express");
const router = express.Router();
const { buildReport } = require("../logic");

// GET /api/report -> informe completo de avance de la carrera
router.get("/", (req, res) => {
  const report = buildReport();
  res.json(report);
});

module.exports = router;
