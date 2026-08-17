# Seguimiento de Malla Curricular — Ingeniería Informática (UPCH)

Aplicación full-stack para llevar el seguimiento completo de tu carrera:
qué cursos ya culminaste, cuáles están en curso, cuáles puedes llevar ya
(prerrequisitos cumplidos), cuáles siguen bloqueados, y una proyección de
cuánto te falta para terminar.

La malla curricular (todos los ciclos, créditos, prerrequisitos, electivas
y actividades complementarias) fue extraída directamente del PDF oficial
"Plan de Estudios 2022 — Carrera de Ingeniería Informática" y ya viene
precargada en el sistema — **no necesitas volver a subirla**.

## ¿Qué incluye?

- **Backend** (Node.js + Express + SQLite): API REST con toda la malla,
  cálculo automático de prerrequisitos, estado de cada curso y el informe
  de avance.
- **Frontend** (HTML + CSS + JS, sin frameworks ni build tools): interfaz
  visual con 3 pestañas — Malla, Cargar notas, Informe.
- Carga de tu **ficha de notas** en CSV (100% confiable) o PDF (extracción
  aproximada, con vista previa editable antes de confirmar).
- Marcado manual de cursos como "en curso" o "culminado", ciclo a ciclo.
- Asignación de qué curso real corresponde a cada espacio de "Electiva" o
  "Actividad Complementaria".
- Informe con: % de avance, créditos que faltan, cursos ya disponibles
  para llevar, cursos bloqueados y por qué, y una proyección de en cuántos
  ciclos más terminarías según tu ritmo (o el ritmo típico de 20 créditos/ciclo).

## Requisitos

- [Node.js](https://nodejs.org/) 18 o superior (instalado en tu computadora).

## Instalación y ejecución (todo en un solo comando)

```bash
cd backend
npm install
npm run seed      # crea la base de datos y siembra la malla curricular (una sola vez)
npm start
```

Luego abre tu navegador en:

```
http://localhost:4000
```

Ya está — el backend también sirve el frontend, no necesitas otro servidor.

> Si prefieres correr el frontend por separado (por ejemplo con "Live Server"
> de VSCode), puedes abrir directamente `frontend/index.html`, pero asegúrate
> de que el backend siga corriendo en el puerto 4000 (el frontend llama a
> `http://localhost:<mismo host>:4000` vía rutas relativas `/api/...`, así
> que lo más simple es siempre usar `http://localhost:4000`).

## Cómo usarlo

1. **Pestaña "Malla"**: verás los 10 ciclos con todos tus cursos. Haz clic
   en cualquier curso para ver sus prerrequisitos y cambiar su estado
   (Pendiente / En curso / Culminado), poner tu nota y el ciclo en que lo
   llevaste. Para los espacios de "Electiva" o "Actividad Complementaria"
   podrás elegir de un listado qué curso específico tomaste.

2. **Pestaña "Cargar notas"**:
   - **CSV** (recomendado): sube un archivo con columnas `codigo,nota,ciclo`.
     Se muestra una vista previa donde puedes revisar y desmarcar filas antes
     de confirmar la importación masiva.
   - **PDF**: sube tu ficha de notas en PDF. La extracción es aproximada
     (busca patrones de código de curso + nota en el texto), así que
     **siempre revisa la vista previa** antes de confirmar — puedes ajustar
     la nota mínima aprobatoria si tu ficha usa una escala distinta.
   - También hay una actualización manual rápida curso por curso, sin
     necesidad de subir archivos.
   - Botón de reinicio total de tu avance, por si quieres empezar de cero.

3. **Pestaña "Informe"**: resumen completo — % de avance, créditos
   culminados/en curso/pendientes, avance visual por ciclo, lista de cursos
   ya disponibles para tomar, lista de cursos bloqueados (y qué prerrequisito
   te falta), y la proyección de ciclos restantes para terminar la carrera.

Todo tu progreso se guarda automáticamente en una base de datos local
(`backend/data/plan.db`), así que puedes cerrar y volver a abrir la app
sin perder nada.

## Estructura del proyecto

```
plan-estudios/
├── backend/
│   ├── server.js          # servidor Express (API + sirve el frontend)
│   ├── db.js               # conexión y esquema SQLite
│   ├── seed.js              # siembra la malla curricular desde seed/curriculum.json
│   ├── logic.js             # cálculo de prerrequisitos, estado y reporte
│   ├── seed/curriculum.json # la malla curricular completa extraída del PDF
│   ├── routes/
│   │   ├── curriculum.js    # GET /api/curriculum, /api/curriculum/pool/:group
│   │   ├── progress.js      # PUT/POST /api/progress/*
│   │   ├── report.js        # GET /api/report
│   │   └── upload.js        # POST /api/upload/csv, /api/upload/pdf
│   └── data/                # aquí se crea plan.db (se genera con npm run seed)
└── frontend/
    ├── index.html
    ├── styles.css
    └── app.js
```

## Notas importantes

- **Ajusta si algo de la malla no calza con tu situación real**: los
  espacios de "Asignatura Electiva I–VI" y "Actividad Complementaria I–IV"
  vienen con el pool completo de cursos electivos y talleres listados en tu
  plan de estudios; solo asigna cuál tomaste en cada espacio.
- Si tu universidad actualiza el plan de estudios o detectas algún dato
  distinto al de tu ficha real, puedes editar directamente
  `backend/seed/curriculum.json` y correr `npm run seed` de nuevo.
- La extracción desde PDF es una ayuda, no un reemplazo de tu verificación:
  siempre revisa la vista previa antes de confirmar la importación.
