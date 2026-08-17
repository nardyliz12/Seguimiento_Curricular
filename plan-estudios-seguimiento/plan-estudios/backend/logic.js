const db = require("./db");

const AVG_CREDITS_PER_CYCLE_DEFAULT = 20; // carga típica full-time por ciclo en este plan

function getAllCourses() {
  return db.prepare(`SELECT * FROM courses WHERE isPoolItem = 0 ORDER BY cycle, code`).all();
}

function getPoolItems(poolGroup) {
  return db
    .prepare(`SELECT * FROM courses WHERE isPoolItem = 1 AND poolGroup = ? ORDER BY code`)
    .all(poolGroup);
}

function getProgressMap() {
  const rows = db.prepare(`SELECT * FROM progress`).all();
  const map = {};
  for (const r of rows) map[r.code] = r;
  return map;
}

function approvedCreditsTotal(progressMap, courses) {
  let total = 0;
  for (const c of courses) {
    const p = progressMap[c.code];
    if (p && p.status === "completed") total += c.credits;
  }
  return total;
}

function inProgressCreditsTotal(progressMap, courses) {
  let total = 0;
  for (const c of courses) {
    const p = progressMap[c.code];
    if (p && p.status === "in_progress") total += c.credits;
  }
  return total;
}

// Determina si un slot está desbloqueado (todos sus prerrequisitos aprobados + créditos mínimos)
function isUnlocked(course, progressMap, approvedCredits) {
  const prereqs = JSON.parse(course.prereqCodes || "[]");
  const prereqsOk = prereqs.every((code) => {
    const p = progressMap[code];
    return p && p.status === "completed";
  });
  const creditsOk = approvedCredits >= (course.prereqCredits || 0);
  return prereqsOk && creditsOk;
}

function missingPrereqs(course, progressMap, approvedCredits) {
  const prereqs = JSON.parse(course.prereqCodes || "[]");
  const missingCourses = prereqs.filter((code) => {
    const p = progressMap[code];
    return !(p && p.status === "completed");
  });
  const missingCredits = Math.max(0, (course.prereqCredits || 0) - approvedCredits);
  return { missingCourses, missingCredits };
}

function buildPlanningViews(courses, progressMap, completedCredits, avgCreditsPerCycle, currentCycleGuess) {
  const pendingCourses = courses.filter((course) => {
    const status = progressMap[course.code]?.status || "pending";
    return status === "pending";
  });

  const pendingByCycle = [];
  for (let cycle = 1; cycle <= 10; cycle++) {
    const cycleCourses = pendingCourses.filter((course) => course.cycle === cycle);
    pendingByCycle.push({
      cycle,
      totalCredits: cycleCourses.reduce((sum, course) => sum + course.credits, 0),
      courses: cycleCourses.map((course) => ({ code: course.code, name: course.name, credits: course.credits })),
    });
  }

  // Los cursos en curso se liberan al comenzar la proyección del siguiente ciclo.
  const virtualProgress = { ...progressMap };
  for (const course of courses) {
    if (virtualProgress[course.code]?.status === "in_progress") {
      virtualProgress[course.code] = { ...virtualProgress[course.code], status: "completed" };
    }
  }

  const remaining = new Map(pendingCourses.map((course) => [course.code, course]));
  const forecastByCycle = [];
  let virtualCredits = completedCredits + courses
    .filter((course) => progressMap[course.code]?.status === "in_progress")
    .reduce((sum, course) => sum + course.credits, 0);
  let forecastCycle = Math.max(1, currentCycleGuess + 1);
  let guard = 0;

  while (remaining.size > 0 && guard < 30) {
    const selected = [];
    let credits = 0;
    const candidates = Array.from(remaining.values()).filter((course) => isUnlocked(course, virtualProgress, virtualCredits));
    candidates.sort((a, b) => (a.cycle - b.cycle) || a.code.localeCompare(b.code));

    for (const course of candidates) {
      if (credits + course.credits > avgCreditsPerCycle) continue;
      selected.push({ code: course.code, name: course.name, cycle: course.cycle, credits: course.credits });
      credits += course.credits;
    }

    if (selected.length === 0) break;

    for (const course of selected) {
      remaining.delete(course.code);
      virtualProgress[course.code] = { status: "completed" };
      virtualCredits += course.credits;
    }

    forecastByCycle.push({
      cycle: forecastCycle,
      limitCredits: avgCreditsPerCycle,
      plannedCredits: credits,
      courses: selected,
    });
    forecastCycle++;
    guard++;
  }

  return {
    pendingByCycle,
    forecastByCycle,
    forecastUnplannedCourses: Array.from(remaining.values()).map((course) => ({
      code: course.code,
      name: course.name,
      cycle: course.cycle,
      credits: course.credits,
      missingPrereqCourses: missingPrereqs(course, virtualProgress, virtualCredits).missingCourses,
    })),
  };
}

// Construye la malla completa con estado calculado por curso
function buildCurriculumView() {
  const courses = getAllCourses();
  const progressMap = getProgressMap();
  const approvedCredits = approvedCreditsTotal(progressMap, courses);

  const courseCodeToName = {};
  courses.forEach((c) => (courseCodeToName[c.code] = c.name));
  // también nombres del pool para resolver prereqs de electivas asignadas
  const allCourseRows = db.prepare(`SELECT code, name FROM courses`).all();
  allCourseRows.forEach((c) => (courseCodeToName[c.code] = c.name));

  const cyclesMap = {};

  for (const course of courses) {
    const p = progressMap[course.code] || { status: "pending" };
    const unlocked = isUnlocked(course, progressMap, approvedCredits);
    const { missingCourses, missingCredits } = missingPrereqs(course, progressMap, approvedCredits);

    let computedStatus = p.status;
    if (p.status === "pending" && !unlocked) {
      computedStatus = "locked";
    } else if (p.status === "pending" && unlocked) {
      computedStatus = "available";
    }

    let assignedCourseName = null;
    if (p.assignedCourseCode) {
      assignedCourseName = courseCodeToName[p.assignedCourseCode] || p.assignedCourseCode;
    }

    const entry = {
      code: course.code,
      name: course.name,
      cycle: course.cycle,
      credits: course.credits,
      studyType: course.studyType,
      category: course.category,
      prereqCodes: JSON.parse(course.prereqCodes || "[]"),
      prereqCodeNames: JSON.parse(course.prereqCodes || "[]").map((code) => ({
        code,
        name: courseCodeToName[code] || code,
      })),
      prereqCredits: course.prereqCredits,
      status: computedStatus, // locked | available | in_progress | completed
      grade: p.grade ?? null,
      cycleTaken: p.cycleTaken ?? null,
      isElectiveOrComplementary: course.category === "ELECTIVA" || course.category === "COMPLEMENTARIA",
      assignedCourseCode: p.assignedCourseCode ?? null,
      assignedCourseName,
      missingPrereqCourses: missingCourses.map((code) => ({ code, name: courseCodeToName[code] || code })),
      missingPrereqCredits: missingCredits,
    };

    if (!cyclesMap[course.cycle]) cyclesMap[course.cycle] = [];
    cyclesMap[course.cycle].push(entry);
  }

  const cycles = Object.keys(cyclesMap)
    .map(Number)
    .sort((a, b) => a - b)
    .map((cycleNum) => ({
      cycle: cycleNum,
      courses: cyclesMap[cycleNum],
      totalCredits: cyclesMap[cycleNum].reduce((s, c) => s + c.credits, 0),
      completedCredits: cyclesMap[cycleNum]
        .filter((c) => c.status === "completed")
        .reduce((s, c) => s + c.credits, 0),
    }));

  return cycles;
}

function buildReport() {
  const courses = getAllCourses();
  const progressMap = getProgressMap();

  const totalCreditos = courses.reduce((s, c) => s + c.credits, 0);
  const completedCredits = approvedCreditsTotal(progressMap, courses);
  const inProgressCredits = inProgressCreditsTotal(progressMap, courses);
  const remainingCredits = Math.max(0, totalCreditos - completedCredits - inProgressCredits);

  const completedCourses = courses.filter((c) => progressMap[c.code]?.status === "completed");
  const inProgressCourses = courses.filter((c) => progressMap[c.code]?.status === "in_progress");
  const plannedCourses = courses.filter((c) => progressMap[c.code]?.status === "planned");
  const plannedCredits = plannedCourses.reduce((sum, course) => sum + course.credits, 0);
  const pendingCourses = courses.filter((c) => {
    const st = progressMap[c.code]?.status || "pending";
    return st === "pending";
  });

  const unlockedNow = pendingCourses.filter((c) => isUnlocked(c, progressMap, completedCredits));
  const lockedNow = pendingCourses.filter((c) => !isUnlocked(c, progressMap, completedCredits));

  // Ritmo histórico: créditos aprobados por ciclo cursado (cycleTaken)
  const creditsByCycleTaken = {};
  completedCourses.forEach((c) => {
    const p = progressMap[c.code];
    if (p.cycleTaken) {
      creditsByCycleTaken[p.cycleTaken] = (creditsByCycleTaken[p.cycleTaken] || 0) + c.credits;
    }
  });
  const cyclesWithData = Object.keys(creditsByCycleTaken).length;
  let avgCreditsPerCycle = AVG_CREDITS_PER_CYCLE_DEFAULT;
  if (cyclesWithData > 0) {
    const totalTracked = Object.values(creditsByCycleTaken).reduce((a, b) => a + b, 0);
    avgCreditsPerCycle = Math.max(6, Math.round(totalTracked / cyclesWithData));
  }

  const creditsLeftToPlan = remainingCredits; // lo que falta contando lo "en curso" como ya en camino
  const estimatedCyclesRemaining = Math.max(
    inProgressCourses.length > 0 && remainingCredits === 0 ? 0 : Math.ceil(creditsLeftToPlan / avgCreditsPerCycle),
    0
  );

  // ciclo académico actual estimado (según cursos en curso o el siguiente ciclo tras el último completado)
  let currentCycleGuess = 1;
  if (inProgressCourses.length > 0) {
    currentCycleGuess = Math.max(...inProgressCourses.map((c) => c.cycle || 1));
  } else if (completedCourses.length > 0) {
    const maxCompletedCycle = Math.max(...completedCourses.map((c) => c.cycle || 1));
    currentCycleGuess = Math.min(10, maxCompletedCycle + 1);
  }

  const projectedGraduationCycle = currentCycleGuess + estimatedCyclesRemaining - (inProgressCourses.length > 0 ? 1 : 0);
  const planningViews = buildPlanningViews(courses, progressMap, completedCredits, avgCreditsPerCycle, currentCycleGuess);

  const byCycleSummary = [];
  for (let cy = 1; cy <= 10; cy++) {
    const inCycle = courses.filter((c) => c.cycle === cy);
    const total = inCycle.reduce((s, c) => s + c.credits, 0);
    const done = inCycle
      .filter((c) => progressMap[c.code]?.status === "completed")
      .reduce((s, c) => s + c.credits, 0);
    const prog = inCycle
      .filter((c) => progressMap[c.code]?.status === "in_progress")
      .reduce((s, c) => s + c.credits, 0);
    byCycleSummary.push({
      cycle: cy,
      totalCredits: total,
      completedCredits: done,
      inProgressCredits: prog,
      pctComplete: total > 0 ? Math.round((done / total) * 100) : 0,
    });
  }

  return {
    totalCreditos,
    completedCredits,
    inProgressCredits,
    remainingCredits,
    pctComplete: totalCreditos > 0 ? Math.round((completedCredits / totalCreditos) * 100) : 0,
    totalCourses: courses.length,
    completedCourseCount: completedCourses.length,
    inProgressCourseCount: inProgressCourses.length,
    pendingCourseCount: pendingCourses.length,
    plannedCourseCount: plannedCourses.length,
    plannedCredits,
    unlockedAvailableCount: unlockedNow.length,
    lockedCount: lockedNow.length,
    avgCreditsPerCycle,
    estimatedCyclesRemaining,
    currentCycleGuess,
    projectedGraduationCycle: Math.min(Math.max(projectedGraduationCycle, currentCycleGuess), 30),
    byCycleSummary,
    unlockedCourses: unlockedNow.map((c) => ({ code: c.code, name: c.name, cycle: c.cycle, credits: c.credits })),
    lockedCourses: lockedNow.map((c) => {
      const { missingCourses, missingCredits } = missingPrereqs(c, progressMap, completedCredits);
      return {
        code: c.code,
        name: c.name,
        cycle: c.cycle,
        credits: c.credits,
        missingPrereqCourses: missingCourses.map((code) => ({
          code,
          name: courses.find((course) => course.code === code)?.name || code,
        })),
        missingPrereqCredits: missingCredits,
      };
    }),
    currentCourses: inProgressCourses.map((c) => ({
      code: c.code,
      name: c.name,
      cycle: c.cycle,
      credits: c.credits,
      grade: progressMap[c.code]?.grade ?? null,
      cycleTaken: progressMap[c.code]?.cycleTaken ?? null,
    })),
    plannedCourses: plannedCourses.map((c) => ({
      code: c.code,
      name: c.name,
      cycle: c.cycle,
      credits: c.credits,
      cycleTaken: progressMap[c.code]?.cycleTaken ?? null,
    })),
    pendingByCycle: planningViews.pendingByCycle,
    forecastByCycle: planningViews.forecastByCycle,
    forecastUnplannedCourses: planningViews.forecastUnplannedCourses,
  };
}

module.exports = {
  buildCurriculumView,
  buildReport,
  isUnlocked,
  getAllCourses,
  getPoolItems,
  getProgressMap,
  approvedCreditsTotal,
};
