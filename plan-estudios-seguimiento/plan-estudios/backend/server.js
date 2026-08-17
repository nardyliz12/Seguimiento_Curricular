const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");

// Asegura carpeta de datos y siembra la BD si es la primera vez
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbFile = path.join(dataDir, "plan.db");
const isFirstRun = !fs.existsSync(dbFile);

require("./db"); // crea tablas si no existen
if (isFirstRun) {
  console.log("Primera ejecución: sembrando malla curricular...");
  require("./seed");
}

const curriculumRoutes = require("./routes/curriculum");
const progressRoutes = require("./routes/progress");
const reportRoutes = require("./routes/report");
const uploadRoutes = require("./routes/upload");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true, service: "plan-estudios-backend" }));

app.use("/api/curriculum", curriculumRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/report", reportRoutes);
app.use("/api/upload", uploadRoutes);

// Sirve el frontend estático (útil si quieres levantar todo con un solo comando)
const frontendDir = path.join(__dirname, "..", "frontend");
if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir));
  app.get("/", (req, res) => res.sendFile(path.join(frontendDir, "index.html")));
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Backend escuchando en http://localhost:${PORT}`);
  console.log(`   API:      http://localhost:${PORT}/api/curriculum`);
  console.log(`   Frontend: http://localhost:${PORT}/`);
});
