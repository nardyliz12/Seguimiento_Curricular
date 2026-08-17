const API = "/api";

const STATUS_LABELS = {
  completed: "Culminado",
  in_progress: "En curso",
  available: "Disponible",
  locked: "Bloqueado",
  planned: "Planificado",
  pending: "Pendiente",
};

let curriculumCache = null;
let electivePoolCache = null;
let complementaryPoolCache = null;
let lastPreviewRows = [];

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "informe") loadReport();
    if (btn.dataset.tab === "notas") populateManualSelect();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function apiGet(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}
async function apiPut(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} -> ${res.status}`);
  return res.json();
}
async function apiPost(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// MALLA
// ---------------------------------------------------------------------------
async function loadMalla() {
  const data = await apiGet("/curriculum");
  curriculumCache = data;

  document.getElementById("carreraTitulo").textContent =
    data.meta.carrera ? `Malla — ${data.meta.carrera}` : "Seguimiento de Malla Curricular";
  document.getElementById("planSubtitulo").textContent =
    `${data.meta.universidad || ""} · ${data.meta.plan || ""}`;

  renderSummaryStrip(data.cycles);
  renderCycles(data.cycles);
}

function renderSummaryStrip(cycles) {
  const all = cycles.flatMap((c) => c.courses);
  const total = all.reduce((s, c) => s + c.credits, 0);
  const done = all.filter((c) => c.status === "completed").reduce((s, c) => s + c.credits, 0);
  const inProg = all.filter((c) => c.status === "in_progress").reduce((s, c) => s + c.credits, 0);
  const avail = all.filter((c) => c.status === "available").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const strip = document.getElementById("summaryStrip");
  strip.innerHTML = `
    <div class="stat-box"><div class="value">${pct}%</div><div class="label">Avance total</div></div>
    <div class="stat-box"><div class="value">${done}/${total}</div><div class="label">Créditos culminados</div></div>
    <div class="stat-box"><div class="value">${inProg}</div><div class="label">Créditos en curso</div></div>
    <div class="stat-box"><div class="value">${avail}</div><div class="label">Cursos disponibles ahora</div></div>
  `;
}

function renderCycles(cycles) {
  const container = document.getElementById("cyclesContainer");
  container.innerHTML = "";

  cycles.forEach((cycleData) => {
    const pct = cycleData.totalCredits > 0
      ? Math.round((cycleData.completedCredits / cycleData.totalCredits) * 100)
      : 0;

    const card = document.createElement("div");
    card.className = "cycle-card";
    card.innerHTML = `
      <h3>Ciclo ${cycleData.cycle}</h3>
      <div class="muted small">${cycleData.completedCredits}/${cycleData.totalCredits} créditos culminados</div>
      <div class="cycle-progress-bar"><div class="cycle-progress-fill" style="width:${pct}%"></div></div>
      <div class="course-list"></div>
    `;
    const list = card.querySelector(".course-list");

    cycleData.courses.forEach((course) => {
      const row = document.createElement("div");
      row.className = "course-row";
      const displayName = course.assignedCourseName
        ? `${course.name}: ${course.assignedCourseName}`
        : course.name;
      row.innerHTML = `
        <div>
          <span class="cname">${displayName}</span>
          <span class="ccode">${course.code}</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="ccred">${course.credits} cr.</span>
          <span class="chip status-${course.status}">${STATUS_LABELS[course.status] || course.status}</span>
        </div>
      `;
      row.addEventListener("click", () => openCourseModal(course));
      list.appendChild(row);
    });

    container.appendChild(card);
  });
}

// ---------------------------------------------------------------------------
// MODAL de curso (marcar estado / asignar electiva o complementaria)
// ---------------------------------------------------------------------------
async function openCourseModal(course) {
  const modal = document.getElementById("courseModal");
  const body = document.getElementById("modalBody");

  const prereqTags = course.prereqCodeNames.length
    ? course.prereqCodeNames.map((p) => {
        const ok = !course.missingPrereqCourses.some((m) => m.code === p.code);
        return `<span class="prereq-tag ${ok ? "ok" : ""}">${p.name}</span>`;
      }).join("")
    : '<span class="muted small">Sin prerrequisitos de curso</span>';

  const creditsPrereqNote = course.prereqCredits > 0
    ? `<p class="small muted">Requiere ${course.prereqCredits} créditos aprobados en total (te faltan ${course.missingPrereqCredits}).</p>`
    : "";

  let poolSection = "";
  if (course.category === "ELECTIVA" || course.category === "COMPLEMENTARIA") {
    const poolGroup = course.category;
    const poolData = await apiGet(`/curriculum/pool/${poolGroup}`);
    const options = poolData.items
      .map((it) => `<option value="${it.code}" ${course.assignedCourseCode === it.code ? "selected" : ""} ${!it.unlocked && course.assignedCourseCode !== it.code ? "" : ""}>${it.name} (${it.credits} cr.)${it.unlocked ? "" : " — prereq. pendiente"}</option>`)
      .join("");
    poolSection = `
      <div class="field">
        <label>¿Qué curso ${poolGroup === "ELECTIVA" ? "electivo" : "complementario"} corresponde a este espacio?</label>
        <select id="poolAssignSelect">
          <option value="">— Sin asignar —</option>
          ${options}
        </select>
      </div>
    `;
  }

  body.innerHTML = `
    <h3>${course.name}</h3>
    <p class="muted small">${course.code} · Ciclo ${course.cycle ?? "-"} · ${course.credits} créditos · ${course.category}</p>

    <div class="field">
      <label>Prerrequisitos</label>
      <div>${prereqTags}</div>
      ${creditsPrereqNote}
    </div>

    ${poolSection}

    <div class="field">
      <label>Estado</label>
      <select id="modalStatus">
        <option value="pending" ${course.status === "pending" || course.status === "available" || course.status === "locked" ? "selected" : ""}>Pendiente</option>
        <option value="planned" ${course.status === "planned" ? "selected" : ""}>Planificado para el nuevo ciclo</option>
        <option value="in_progress" ${course.status === "in_progress" ? "selected" : ""}>En curso</option>
        <option value="completed" ${course.status === "completed" ? "selected" : ""}>Culminado</option>
      </select>
    </div>

    <div class="field">
      <label>Nota (opcional)</label>
      <input type="number" id="modalGrade" step="0.1" value="${course.grade ?? ""}" />
    </div>

    <div class="field">
      <label>Ciclo en que lo cursaste (opcional, ayuda a estimar tu ritmo)</label>
      <input type="number" id="modalCycleTaken" value="${course.cycleTaken ?? ""}" />
    </div>

    <button class="btn btn-primary" id="modalSaveBtn">Guardar</button>
  `;

  modal.style.display = "flex";

  document.getElementById("modalSaveBtn").addEventListener("click", async () => {
    const status = document.getElementById("modalStatus").value;
    const gradeVal = document.getElementById("modalGrade").value;
    const cycleVal = document.getElementById("modalCycleTaken").value;
    const poolSelect = document.getElementById("poolAssignSelect");

    const payload = {
      status,
      grade: gradeVal !== "" ? Number(gradeVal) : null,
      cycleTaken: cycleVal !== "" ? Number(cycleVal) : null,
    };
    if (poolSelect) payload.assignedCourseCode = poolSelect.value || null;

    await apiPut(`/progress/${course.code}`, payload);
    modal.style.display = "none";
    await loadMalla();
  });
}

document.getElementById("modalClose").addEventListener("click", () => {
  document.getElementById("courseModal").style.display = "none";
});
document.getElementById("courseModal").addEventListener("click", (e) => {
  if (e.target.id === "courseModal") document.getElementById("courseModal").style.display = "none";
});

// ---------------------------------------------------------------------------
// TAB: CARGAR NOTAS
// ---------------------------------------------------------------------------
document.getElementById("btnUploadCsv").addEventListener("click", async () => {
  const fileInput = document.getElementById("csvInput");
  if (!fileInput.files.length) return alert("Selecciona un archivo CSV primero.");
  const fd = new FormData();
  fd.append("file", fileInput.files[0]);
  const res = await fetch(`${API}/upload/csv`, { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "Error procesando el CSV.");
  showUploadWarning(null);
  showPreview(data.preview);
});

document.getElementById("btnUploadPdf").addEventListener("click", async () => {
  const fileInput = document.getElementById("pdfInput");
  if (!fileInput.files.length) return alert("Selecciona un archivo PDF primero.");
  const fd = new FormData();
  fd.append("file", fileInput.files[0]);
  const res = await fetch(`${API}/upload/pdf`, { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "Error procesando el PDF.");
  showUploadWarning(data.warning);
  showPreview(data.preview);
});

function showUploadWarning(msg) {
  const box = document.getElementById("uploadWarning");
  if (msg) {
    box.style.display = "block";
    box.textContent = "⚠️ " + msg;
  } else {
    box.style.display = "none";
  }
}

function showPreview(rows) {
  lastPreviewRows = rows;
  const section = document.getElementById("previewSection");
  const tbody = document.getElementById("previewTableBody");
  tbody.innerHTML = "";

  if (!rows.length) {
    section.style.display = "block";
    tbody.innerHTML = `<tr><td colspan="6" class="muted">No se detectaron cursos reconocibles de tu malla en el archivo.</td></tr>`;
    return;
  }

  rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    const statusLabel = row.status === "completed" ? "Culminado" : row.status === "in_progress" ? "En curso" : "No aprobado / revisar";
    const statusClass = row.status === "completed" ? "completed" : row.status === "in_progress" ? "in_progress" : "locked";
    const gradeLabel = row.grade ?? row.letterGrade ?? "-";
    const nameCell = row.found
      ? `${row.courseName ?? ""}${row.note ? `<br/><span class="muted small">${row.note}</span>` : ""}`
      : `<span class='muted small'>${row.courseName ? row.courseName + " — " : ""}no encontrado en la malla</span>${row.note ? `<br/><span class="muted small">${row.note}</span>` : ""}`;
    tr.innerHTML = `
      <td><input type="checkbox" class="rowApply" data-idx="${idx}" ${row.found ? "checked" : ""} ${row.found ? "" : "disabled"} /></td>
      <td>${row.code ?? "-"}</td>
      <td>${nameCell}</td>
      <td>${gradeLabel}</td>
      <td>${row.cycleTaken ?? "-"}</td>
      <td><span class="chip status-${statusClass}">${statusLabel}</span></td>
    `;
    tbody.appendChild(tr);
  });

  section.style.display = "block";
}

document.getElementById("minGrade").addEventListener("change", () => {
  // Re-evalúa localmente el estado según la nueva nota mínima, sin reprocesar el archivo
  const min = Number(document.getElementById("minGrade").value);
  lastPreviewRows = lastPreviewRows.map((r) => ({
    ...r,
    status: r.grade === null || r.grade === undefined ? r.status : (r.grade >= min ? "completed" : "pending"),
  }));
  showPreview(lastPreviewRows);
});

document.getElementById("btnConfirmImport").addEventListener("click", async () => {
  const checkboxes = document.querySelectorAll(".rowApply:checked");
  const updates = [];
  checkboxes.forEach((cb) => {
    const row = lastPreviewRows[Number(cb.dataset.idx)];
    if (row && row.found) {
      updates.push({
        code: row.code,
        status: row.status,
        grade: row.grade,
        cycleTaken: row.cycleTaken,
        assignedCourseCode: row.assignedCourseCode,
      });
    }
  });
  if (!updates.length) return alert("No hay filas seleccionadas para importar.");
  const res = await apiPost("/progress/bulk", { updates });
  alert(`Se importaron ${res.applied.length} cursos correctamente.`);
  document.getElementById("previewSection").style.display = "none";
  await loadMalla();
});

// ---- actualización manual ----
async function populateManualSelect() {
  if (!curriculumCache) await loadMalla();
  const select = document.getElementById("manualCourseSelect");
  select.innerHTML = "";
  curriculumCache.cycles.forEach((cycleData) => {
    const group = document.createElement("optgroup");
    group.label = `Ciclo ${cycleData.cycle}`;
    cycleData.courses.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = `${c.name} (${c.code})`;
      group.appendChild(opt);
    });
    select.appendChild(group);
  });
}

document.getElementById("btnManualUpdate").addEventListener("click", async () => {
  const code = document.getElementById("manualCourseSelect").value;
  const status = document.getElementById("manualStatusSelect").value;
  const gradeVal = document.getElementById("manualGrade").value;
  const cycleVal = document.getElementById("manualCycle").value;
  await apiPut(`/progress/${code}`, {
    status,
    grade: gradeVal !== "" ? Number(gradeVal) : null,
    cycleTaken: cycleVal !== "" ? Number(cycleVal) : null,
  });
  alert("Curso actualizado.");
  await loadMalla();
});

document.getElementById("btnReset").addEventListener("click", async () => {
  if (!confirm("¿Seguro que deseas borrar todo tu avance registrado? Esta acción no se puede deshacer.")) return;
  await apiPost("/progress/reset", {});
  alert("Avance reiniciado.");
  await loadMalla();
});

// ---------------------------------------------------------------------------
// TAB: INFORME
// ---------------------------------------------------------------------------
async function loadReport() {
  const r = await apiGet("/report");
  const container = document.getElementById("reportContainer");

  const cycleBars = r.byCycleSummary.map((c) => {
    const donePct = c.totalCredits > 0 ? (c.completedCredits / c.totalCredits) * 100 : 0;
    const progPct = c.totalCredits > 0 ? (c.inProgressCredits / c.totalCredits) * 100 : 0;
    return `
      <div class="cycle-bar-row">
        <div>Ciclo ${c.cycle}</div>
        <div class="cycle-bar-track">
          <div class="cycle-bar-done" style="width:${donePct}%"></div>
          <div class="cycle-bar-prog" style="width:${progPct}%"></div>
        </div>
        <div class="muted small">${c.completedCredits}/${c.totalCredits}</div>
      </div>
    `;
  }).join("");

  const unlockedList = r.unlockedCourses.map((c) => `
    <div class="list-item">
      <div class="lname">${c.name}</div>
      <div class="lmeta">${c.code} · Ciclo ${c.cycle} · ${c.credits} créditos</div>
    </div>
  `).join("") || `<p class="muted small">No hay cursos disponibles pendientes por tomar.</p>`;

  const lockedList = r.lockedCourses.map((c) => `
    <div class="list-item">
      <div class="lname">${c.name}</div>
      <div class="lmeta">
        ${c.code} · Ciclo ${c.cycle} · ${c.credits} créditos
        ${c.missingPrereqCourses.length ? `<div class="blocked-reason"><strong>Necesitas aprobar:</strong> ${c.missingPrereqCourses.map((p) => `${p.name} (${p.code})`).join(", ")}</div>` : ""}
        ${c.missingPrereqCredits > 0 ? ` · Faltan ${c.missingPrereqCredits} créditos acumulados` : ""}
      </div>
    </div>
  `).join("") || `<p class="muted small">No tienes cursos bloqueados. ¡Vas muy bien!</p>`;

  const currentList = r.currentCourses.map((c) => `
    <div class="list-item action-item">
      <div>
        <div class="lname">${c.name}</div>
        <div class="lmeta">${c.code} · ${c.credits} créditos · Ciclo ${c.cycleTaken ?? c.cycle}</div>
      </div>
      <button class="btn btn-small btn-complete-course" data-code="${c.code}">Marcar culminado</button>
    </div>
  `).join("") || `<p class="muted small">No tienes cursos marcados como en curso.</p>`;

  const plannedList = r.plannedCourses.map((c) => `
    <div class="list-item action-item">
      <div>
        <div class="lname">${c.name}</div>
        <div class="lmeta">${c.code} · ${c.credits} créditos · Ciclo previsto ${c.cycleTaken ?? "nuevo ciclo"}</div>
      </div>
      <div class="action-buttons">
        <button class="btn btn-small btn-start-course" data-code="${c.code}">Iniciar ciclo</button>
        <button class="btn btn-small btn-remove-course" data-code="${c.code}">Quitar</button>
      </div>
    </div>
  `).join("") || `<p class="muted small">Todavía no has agregado cursos al nuevo ciclo.</p>`;

  const pendingByCycle = r.pendingByCycle.map((group) => `
    <div class="planning-cycle">
      <div class="planning-cycle-heading">
        <strong>Ciclo ${group.cycle}</strong>
        <span class="muted small">${group.courses.length} curso(s) · ${group.totalCredits} créditos pendientes</span>
      </div>
      ${group.courses.length ? group.courses.map((c) => `
        <div class="list-item compact-item">
          <div class="lname">${c.name}</div>
          <div class="lmeta">${c.code} · ${c.credits} créditos</div>
        </div>
      `).join("") : `<p class="muted small">Sin cursos pendientes.</p>`}
    </div>
  `).join("");

  const forecastByCycle = r.forecastByCycle.map((group) => `
    <div class="planning-cycle">
      <div class="planning-cycle-heading">
        <strong>Ciclo proyectado ${group.cycle}</strong>
        <span class="muted small">${group.plannedCredits}/${group.limitCredits} créditos</span>
      </div>
      ${group.courses.map((c) => `
        <div class="list-item compact-item">
          <div class="lname">${c.name}</div>
          <div class="lmeta">${c.code} · ${c.credits} créditos · corresponde al ciclo ${c.cycle}</div>
          <button class="btn btn-small btn-plan-course" data-code="${c.code}" data-cycle="${group.cycle}">Agregar al nuevo ciclo</button>
        </div>
      `).join("")}
    </div>
  `).join("") || `<p class="muted small">No hay cursos disponibles para proyectar con los prerrequisitos actuales.</p>`;

  const unplannedList = r.forecastUnplannedCourses?.length
    ? `<p class="muted small">Estos cursos no entraron en el pronóstico porque todavía tienen prerrequisitos pendientes:</p>${r.forecastUnplannedCourses.map((c) => `<div class="list-item compact-item"><div class="lname">${c.name}</div><div class="lmeta">${c.code} · Ciclo ${c.cycle} · ${c.credits} créditos</div></div>`).join("")}`
    : "";

  container.innerHTML = `
    <div class="progress-ring-wrap">
      <div class="big-pct">${r.pctComplete}%</div>
      <div>
        <p style="margin:2px 0"><strong>${r.completedCredits}</strong> de <strong>${r.totalCreditos}</strong> créditos culminados</p>
        <p style="margin:2px 0" class="muted small">${r.inProgressCredits} créditos en curso actualmente</p>
        <p style="margin:2px 0" class="muted small">${r.remainingCredits} créditos restantes por completar</p>
      </div>
    </div>

    <div class="report-grid">
      <div class="stat-box"><div class="value">${r.completedCourseCount}</div><div class="label">Cursos culminados</div></div>
      <div class="stat-box"><div class="value">${r.inProgressCourseCount}</div><div class="label">Cursos en curso</div></div>
      <div class="stat-box"><div class="value">${r.unlockedAvailableCount}</div><div class="label">Disponibles para llevar</div></div>
      <div class="stat-box"><div class="value">${r.lockedCount}</div><div class="label">Bloqueados por prerrequisito</div></div>
      <div class="stat-box"><div class="value">${r.avgCreditsPerCycle}</div><div class="label">Créditos/ciclo (tu ritmo)</div></div>
      <div class="stat-box"><div class="value">${r.estimatedCyclesRemaining}</div><div class="label">Ciclos estimados restantes</div></div>
    </div>

    <div class="card">
      <h2>Proyección de cierre de carrera</h2>
      <p>Según tu ritmo actual (<strong>${r.avgCreditsPerCycle} créditos/ciclo</strong>), estás aproximadamente en el
        <strong>ciclo ${r.currentCycleGuess}</strong> y te faltarían alrededor de
        <strong>${r.estimatedCyclesRemaining} ciclo(s)</strong> más para culminar todos los créditos
        (proyección: ciclo <strong>${r.projectedGraduationCycle}</strong>).</p>
      <p class="muted small">Esta estimación es referencial: se basa en los créditos que aún te faltan (${r.remainingCredits})
        dividido entre tu ritmo de créditos por ciclo. Si registras el "ciclo cursado" al marcar tus cursos, el cálculo
        se ajusta a tu ritmo histórico real; si no, usa un valor típico de 20 créditos/ciclo.</p>
    </div>

    <h2>Avance por ciclo</h2>
    <div class="card">
      <div class="cycle-bars">${cycleBars}</div>
    </div>

    <div class="two-col">
      <div class="card">
        <h2>✅ Disponibles ahora (${r.unlockedAvailableCount})</h2>
        <div class="list-box">${unlockedList}</div>
      </div>
      <div class="card">
        <h2>🔒 Bloqueados (${r.lockedCount})</h2>
        <div class="list-box">${lockedList}</div>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <h2>Cursos que estoy cursando (${r.currentCourses.length})</h2>
        <p class="muted small">Cuando termines un curso, pulsa “Marcar culminado” para guardarlo en tu historial.</p>
        <div class="list-box">${currentList}</div>
      </div>
      <div class="card">
        <h2>Nuevo ciclo (${r.plannedCourses.length})</h2>
        <p class="muted small">${r.plannedCredits} créditos planificados. Agrega cursos desde el pronóstico; “Quitar” los devuelve a pendientes.</p>
        <div class="list-box">${plannedList}</div>
      </div>
    </div>

    <div class="card">
      <h2>Cursos que faltan por ciclo</h2>
      <p class="muted small">Incluye todos los cursos pendientes de la malla, agrupados por el ciclo al que pertenecen.</p>
      <div class="planning-list">${pendingByCycle}</div>
    </div>

    <div class="card">
      <h2>Pronóstico de cursos por llevar</h2>
      <p class="muted small">Proyección desde el siguiente ciclo, respetando un máximo de <strong>${r.avgCreditsPerCycle} créditos por ciclo</strong> y liberando cursos solo cuando sus prerrequisitos quedan cumplidos.</p>
      <div class="planning-list">${forecastByCycle}</div>
      ${unplannedList}
    </div>
  `;

  container.querySelectorAll(".btn-complete-course").forEach((button) => {
    button.addEventListener("click", async () => {
      const grade = prompt("Nota final (opcional):", "");
      if (grade === null) return;
      await apiPut(`/progress/${button.dataset.code}`, {
        status: "completed",
        grade: grade === "" ? null : Number(grade),
      });
      await loadReport();
      await loadMalla();
    });
  });

  container.querySelectorAll(".btn-start-course").forEach((button) => {
    button.addEventListener("click", async () => {
      await apiPut(`/progress/${button.dataset.code}`, { status: "in_progress" });
      await loadReport();
      await loadMalla();
    });
  });

  container.querySelectorAll(".btn-plan-course").forEach((button) => {
    button.addEventListener("click", async () => {
      const courseName = button.closest(".list-item")?.querySelector(".lname")?.textContent || button.dataset.code;
      if (!confirm(`¿Agregar "${courseName}" al nuevo ciclo?`)) return;
      await apiPut(`/progress/${button.dataset.code}`, {
        status: "planned",
        cycleTaken: Number(button.dataset.cycle),
      });
      await loadReport();
      await loadMalla();
    });
  });

  container.querySelectorAll(".btn-remove-course").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("¿Quitar este curso del nuevo ciclo y devolverlo a pendientes?")) return;
      await apiPut(`/progress/${button.dataset.code}`, { status: "pending", cycleTaken: null });
      await loadReport();
      await loadMalla();
    });
  });
}

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
loadMalla();
