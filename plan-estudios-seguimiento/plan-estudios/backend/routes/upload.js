const express = require("express");
const router = express.Router();
const multer = require("multer");
const { parse } = require("csv-parse/sync");
const db = require("../db");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function courseExists(code) {
  return db.prepare(`SELECT code, name, credits, category FROM courses WHERE code = ?`).get(code);
}

function normalizeStatusFromGrade(grade) {
  if (grade === null || grade === undefined || grade === "") return "completed";
  const num = Number(grade);
  if (Number.isNaN(num)) return "completed";
  // Nota mínima aprobatoria típica UPCH: 10.5 / 11. Ajustable por el usuario en el frontend.
  return num >= 10.5 ? "completed" : "pending";
}

// --- Utilidades para el parseo de la "Ficha de Notas" (formato UPCH) ---

const STOPWORDS = new Set(["DE", "LA", "EL", "Y", "PARA", "EN", "A", "DEL", "LOS", "LAS", "CON"]);
const ROMAN_TO_ARABIC = { X: "10", IX: "9", VIII: "8", VII: "7", VI: "6", V: "5", IV: "4", III: "3", II: "2", I: "1" };

function stripAccents(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Uppercase, sin tildes, sin puntuación y con numeral romano final convertido a arábigo,
// para poder comparar nombres de cursos aunque vengan con un código distinto (ficha vs malla).
function normalizeCourseName(s) {
  let n = stripAccents(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  n = n.replace(/\b(X|IX|VIII|VII|VI|V|IV|III|II|I)$/, (m) => ROMAN_TO_ARABIC[m] || m);
  return n;
}

function wordSet(normalizedName) {
  return new Set(normalizedName.split(" ").filter((w) => w && !STOPWORDS.has(w)));
}

function nameSimilarity(aWords, bWords) {
  if (aWords.size === 0 || bWords.size === 0) return 0;
  let common = 0;
  for (const w of aWords) if (bWords.has(w)) common++;
  return common / Math.max(aWords.size, bWords.size);
}

// Busca el curso de la malla que mejor corresponde a un nombre extraído del PDF,
// útil porque la ficha de UPCH usa códigos antiguos (U-, G-) que no están en la malla actual.
function findCourseByName(name, allCourses) {
  const target = wordSet(normalizeCourseName(name));
  let best = null;
  let bestScore = 0;
  for (const c of allCourses) {
    const score = nameSimilarity(target, wordSet(normalizeCourseName(c.name)));
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= 0.6 ? best : null;
}

function determinePdfStatus({ grade, letterGrade, observation }) {
  const obs = (observation || "").toUpperCase();
  if (obs.includes("RETIRADO")) return "pending";
  if (obs.includes("NO APTO")) return "pending";
  if (grade !== null && grade !== undefined) return grade >= 10.5 ? "completed" : "pending";
  if (letterGrade) return ["AD", "A", "B"].includes(letterGrade.toUpperCase()) ? "completed" : "pending";
  if (obs.includes("ACTIVO")) return "in_progress";
  if (obs.includes("APTO")) return "completed";
  return "pending";
}

// Cursos de mallas anteriores que la universidad reemplazó por uno equivalente en la malla 2022
// (mismo requisito, distinto nombre/código). Ajusta este mapa si detectas otros casos.
const LEGACY_COURSE_MAP = {
  C0208: "C8987", // Química Orgánica -> Química Computacional y Simulaciones
};

const VALIDATED_SLOT_MAP = {
  // Electivas externas de la ficha -> los seis espacios de electiva de la malla
  C8294: "ELEC1", // Métodos Numéricos y Optimización para Machine Learning
  C8296: "ELEC2", // Natural Language Processing
  C9854: "ELEC2", // Natural Language Processing (código histórico de la ficha)
  C8303: "ELEC3", // Tópicos Avanzados de Sistemas de Información
  C8297: "ELEC4", // Aprendizaje por Refuerzo
  C0031: "ELEC5", // Biogeografía Histórica y Ecológica
  C0158: "ELEC6", // Liderazgo: Estrategias para el Desarrollo Personal
  // Actividades complementarias de la ficha -> los cuatro espacios de la malla
  BUD14: "COMP1", // Taller de Voleibol II
  BUD30: "COMP1", // Taller de Voleibol II (código histórico de la ficha)
  BUD12: "COMP2", // Karate Do II
  BUD25: "COMP3", // Taller de Kung-Fu I
  BUC29: "COMP4", // Taller de Música I
};

// Busca los slots de Electiva (ELEC1..ELEC6) que aún no tienen un curso real asignado,
// para poder validar ahí cursos externos que no están en el pool de electivas de informática.
function findFreeElectiveSlots() {
  const slots = db.prepare(`SELECT code, name, credits FROM courses WHERE category = 'ELECTIVA' AND isPoolItem = 0 ORDER BY code`).all();
  if (slots.length === 0) return [];
  const placeholders = slots.map(() => "?").join(",");
  const progressRows = db
    .prepare(`SELECT code, assignedCourseCode, status FROM progress WHERE code IN (${placeholders})`)
    .all(...slots.map((s) => s.code));
  const used = new Set(progressRows.filter((r) => r.assignedCourseCode || r.status === "completed").map((r) => r.code));
  return slots.filter((s) => !used.has(s.code));
}

function courseSlot(code) {
  const slotCode = VALIDATED_SLOT_MAP[code.toUpperCase()];
  return slotCode ? courseExists(slotCode) : null;
}

// POST /api/upload/csv  (multipart, campo "file")
// Formato esperado del CSV: codigo,nota,ciclo  (encabezados flexibles)
router.post("/csv", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo." });

  let records;
  try {
    records = parse(req.file.buffer.toString("utf-8"), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (e) {
    return res.status(400).json({ error: "No se pudo leer el CSV. Verifica el formato.", detail: e.message });
  }

  const preview = [];
  for (const row of records) {
    const codigo = (row.codigo || row.code || row.Codigo || row.CODIGO || "").toString().trim().toUpperCase();
    const notaRaw = row.nota ?? row.grade ?? row.Nota ?? row.NOTA;
    const cicloRaw = row.ciclo ?? row.cycle ?? row.Ciclo ?? row.CICLO;

    if (!codigo) continue;
    const course = courseExists(codigo);
    const status = normalizeStatusFromGrade(notaRaw);

    preview.push({
      code: codigo,
      found: !!course,
      courseName: course ? course.name : null,
      credits: course ? course.credits : null,
      grade: notaRaw !== undefined && notaRaw !== "" ? Number(notaRaw) : null,
      cycleTaken: cicloRaw ? Number(cicloRaw) : null,
      status,
    });
  }

  res.json({ ok: true, rows: preview.length, preview });
});

// POST /api/upload/pdf  (multipart, campo "file") — extracción adaptada al formato
// de "Ficha de Notas" de UPCH: filas como "C8275ESTRUCTURAS DISCRETAS3.733.003*NINGUNA*"
// (código+nombre+nota+creditos+ciclo+*area*+observación), sin separadores entre columnas.
router.post("/pdf", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo." });

  let pdfParse;
  try {
    pdfParse = require("pdf-parse");
  } catch (e) {
    return res.status(500).json({ error: "pdf-parse no está instalado en el backend." });
  }

  let text;
  try {
    const data = await pdfParse(req.file.buffer);
    text = data.text;
  } catch (e) {
    return res.status(400).json({ error: "No se pudo leer el PDF.", detail: e.message });
  }

  // Los nombres de curso a veces se cortan con un salto de línea (texto largo);
  // al unir todo en una sola línea se reconstruyen correctamente.
  const normalized = text
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .replace(/\n/g, " ")
    .replace(/[\t ]+/g, " ");

  const allCourses = db.prepare(`SELECT code, name, credits FROM courses`).all();

  // Cada fila: CODIGO + CURSO + [NOTA|LETRA]? + CRED.NIVEL (o solo NIVEL si está "Activo")
  // + *AREA* + OBSERVACIONES, todo pegado sin espacios entre columnas.
  const recordRegex =
    /([A-Z]{1,4}\d{2,5})([^*]*?)(?:(?:((?:\d{1,2}\.\d{2})|[A-Z]{1,2}))?(\d{1,2}\.\d{2})(\d{1,2})|(\d{1,2}))\*([^*]*)\*(.*?)(?=[A-Z]{1,4}\d{2,5}|(?:PRIMER|SEGUNDO|TERCER)\s+SEMESTRE|PERIODO\s+VERANO|UNIVERSIDAD\s+PERUANA|$)/g;

  const preview = [];
  const unmatchedExternal = [];
  let match;
  while ((match = recordRegex.exec(normalized)) !== null) {
    const [, rawCode, rawName, notaOrLetra, credStr, nivelStr, nivelOnlyStr, area, obsRaw] = match;
    const observation = obsRaw.trim().slice(0, 80);
    const cleanName = rawName.trim().replace(/\s+/g, " ");

    let grade = null;
    let letterGrade = null;
    let cycleTaken = null;

    if (nivelOnlyStr !== undefined) {
      // Curso "Activo" (en curso): la ficha no imprime nota ni créditos, solo el ciclo
      cycleTaken = Number(nivelOnlyStr);
    } else {
      cycleTaken = Number(nivelStr);
      if (notaOrLetra !== undefined) {
        if (/^\d/.test(notaOrLetra)) grade = Number(notaOrLetra);
        else letterGrade = notaOrLetra;
      }
    }

    const status = determinePdfStatus({ grade, letterGrade, observation });

    const legacyTarget = LEGACY_COURSE_MAP[rawCode.toUpperCase()];
    const validatedSlot = courseSlot(rawCode);
    if (validatedSlot) {
      preview.push({
        code: validatedSlot.code,
        found: true,
        matchedByName: false,
        courseName: `${validatedSlot.name} → ${cleanName}`,
        assignedCourseCode: cleanName,
        credits: validatedSlot.credits,
        grade,
        letterGrade,
        cycleTaken,
        status,
        observation,
        note: `Validado como ${validatedSlot.category === "ELECTIVA" ? "electiva" : "actividad complementaria"}: "${cleanName}" corresponde a ${validatedSlot.code}.`,
        sourceLine: `${rawCode}${cleanName}`.slice(0, 160),
      });
      continue;
    }

    let course = legacyTarget ? courseExists(legacyTarget) : courseExists(rawCode.toUpperCase());
    let matchedByName = false;
    let note = legacyTarget ? `Curso reemplazado: "${cleanName}" ahora equivale a "${course?.name}".` : null;
    if (!course && !legacyTarget) {
      course = findCourseByName(rawName, allCourses);
      matchedByName = !!course;
    }

    if (!course) {
      // No es parte de la malla actual ni de su pool de electivas de informática:
      // se guarda para intentar validarlo como una Electiva genérica (ELEC1..ELEC6).
      unmatchedExternal.push({ rawCode, cleanName, grade, letterGrade, cycleTaken, status, observation });
      continue;
    }

    const credits = nivelOnlyStr !== undefined ? course.credits : Number(credStr);

    preview.push({
      code: course.code,
      found: true,
      matchedByName,
      courseName: course.name,
      credits,
      grade,
      letterGrade,
      cycleTaken,
      status,
      observation,
      note,
      sourceLine: `${rawCode}${cleanName}`.slice(0, 160),
    });
  }

  // Cursos externos (electivas de otras carreras/facultades) que no están en la malla:
  // se validan automáticamente como el contenido real de un slot de Electiva libre (ELEC1..ELEC6).
  if (unmatchedExternal.length) {
    const freeSlots = findFreeElectiveSlots();
    unmatchedExternal.forEach((item, idx) => {
      const slot = freeSlots[idx];
      if (!slot) {
        preview.push({
          code: null,
          found: false,
          courseName: item.cleanName,
          credits: null,
          grade: item.grade,
          letterGrade: item.letterGrade,
          cycleTaken: item.cycleTaken,
          status: item.status,
          observation: item.observation,
          note: "No quedan slots de Electiva libres para validar este curso automáticamente.",
          sourceLine: `${item.rawCode}${item.cleanName}`.slice(0, 160),
        });
        return;
      }
      preview.push({
        code: slot.code,
        found: true,
        matchedByName: false,
        courseName: `${slot.name} → ${item.cleanName}`,
        assignedCourseCode: item.cleanName,
        credits: slot.credits,
        grade: item.grade,
        letterGrade: item.letterGrade,
        cycleTaken: item.cycleTaken,
        status: item.status,
        observation: item.observation,
        note: `Validado como electiva: "${item.cleanName}" corresponde a ${slot.code}.`,
        sourceLine: `${item.rawCode}${item.cleanName}`.slice(0, 160),
      });
    });
  }

  // Deduplica por código, conservando la última ocurrencia (la ficha lista los intentos
  // en orden cronológico, así que la última fila es el resultado vigente del curso).
  const dedup = new Map();
  for (const row of preview) dedup.set(row.code ?? Symbol(row.courseName), row);
  const finalPreview = Array.from(dedup.values());

  const unmatchedLines =
    finalPreview.length === 0 ? normalized.split(/(?=[A-Z]{1,4}\d{2,5})/).filter((l) => l.trim()).slice(0, 20) : [];

  res.json({
    ok: true,
    warning:
      "La extracción desde PDF es aproximada (depende del formato de tu ficha). Revisa y corrige antes de confirmar. Si el resultado es pobre, usa la carga por CSV o edita manualmente.",
    rows: finalPreview.length,
    preview: finalPreview,
    unmatchedSample: finalPreview.length === 0 ? unmatchedLines : undefined,
  });
});

module.exports = router;
