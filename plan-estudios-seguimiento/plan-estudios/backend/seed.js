const fs = require("fs");
const path = require("path");
const db = require("./db");

const curriculum = JSON.parse(
  fs.readFileSync(path.join(__dirname, "seed", "curriculum.json"), "utf-8")
);

const insertCourse = db.prepare(`
  INSERT INTO courses (code, name, cycle, credits, studyType, category, prereqCodes, prereqCredits, poolGroup, isPoolItem)
  VALUES (@code, @name, @cycle, @credits, @studyType, @category, @prereqCodes, @prereqCredits, @poolGroup, @isPoolItem)
  ON CONFLICT(code) DO UPDATE SET
    name=excluded.name, cycle=excluded.cycle, credits=excluded.credits, studyType=excluded.studyType,
    category=excluded.category, prereqCodes=excluded.prereqCodes, prereqCredits=excluded.prereqCredits,
    poolGroup=excluded.poolGroup, isPoolItem=excluded.isPoolItem
`);

const insertProgress = db.prepare(`
  INSERT OR IGNORE INTO progress (code, status) VALUES (?, 'pending')
`);

const seedAll = db.transaction(() => {
  // Cursos principales de la malla (obligatorios + slots de electiva/complementaria)
  for (const c of curriculum.courses) {
    insertCourse.run({
      code: c.code,
      name: c.name,
      cycle: c.cycle,
      credits: c.credits,
      studyType: c.studyType || null,
      category: c.category,
      prereqCodes: JSON.stringify(c.prereqCodes || []),
      prereqCredits: c.prereqCredits || 0,
      poolGroup: c.poolGroup || null,
      isPoolItem: 0,
    });
    insertProgress.run(c.code);
  }

  // Pool de electivas (no forman parte de la secuencia por ciclo; se asignan a un slot ELECx)
  for (const e of curriculum.electivePool) {
    insertCourse.run({
      code: e.code,
      name: e.name,
      cycle: null,
      credits: e.credits,
      studyType: "ESPECIALIDAD",
      category: "ELECTIVA_POOL",
      prereqCodes: JSON.stringify(e.prereqCodes || []),
      prereqCredits: 0,
      poolGroup: "ELECTIVA",
      isPoolItem: 1,
    });
  }

  // Pool de actividades complementarias
  for (const a of curriculum.complementaryPool) {
    insertCourse.run({
      code: a.code,
      name: a.name,
      cycle: null,
      credits: a.credits,
      studyType: "GENERAL",
      category: "COMPLEMENTARIA_POOL",
      prereqCodes: JSON.stringify([]),
      prereqCredits: 0,
      poolGroup: "COMPLEMENTARIA",
      isPoolItem: 1,
    });
  }

  db.prepare(`INSERT INTO meta (key, value) VALUES ('carrera', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run(curriculum.carrera);
  db.prepare(`INSERT INTO meta (key, value) VALUES ('universidad', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run(curriculum.universidad);
  db.prepare(`INSERT INTO meta (key, value) VALUES ('plan', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run(curriculum.plan);
  db.prepare(`INSERT INTO meta (key, value) VALUES ('totalCreditos', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run(String(curriculum.totalCreditos));
});

seedAll();
console.log("Malla curricular sembrada correctamente ✅");
console.log(`Cursos de malla: ${curriculum.courses.length}`);
console.log(`Pool de electivas: ${curriculum.electivePool.length}`);
console.log(`Pool de complementarias: ${curriculum.complementaryPool.length}`);
