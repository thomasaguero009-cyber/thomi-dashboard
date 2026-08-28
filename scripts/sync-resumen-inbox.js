// Lee el CSV publicado de la pestaña "InboxSnapshot" (se sobrescribe sola,
// no se acumula) y actualiza data/resumen-inbox.json — la foto más
// reciente de cómo está el inbox: cuántos chats sin responder hay y qué
// temas se repiten.
const fs = require("fs");
const path = require("path");

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS7PYOuQhFlTcz_1nEtcJrqq5k1mp0A3jwPTWEZzCB5-vB60fFhL17lkAeL8shjSMIJLjeUsau2gxsl/pub?gid=545589246&single=true&output=csv";
const OUTPUT_PATH = path.join(__dirname, "..", "data", "resumen-inbox.json");

// El CSV publicado de esta pestaña es más inestable que el de Hoja 1 (a
// veces devuelve 401/307 transitorios mientras Google propaga el cache) —
// se reintenta unas veces antes de rendirse, y si igual falla NO se corta
// todo el workflow: esto es "la foto más reciente", no algo crítico, se
// recupera solo en la próxima corrida del cron.
async function bajarCsvConReintento() {
  for (let intento = 1; intento <= 3; intento++) {
    const res = await fetch(CSV_URL);
    if (res.ok) return res.text();
    console.warn(`Intento ${intento}: HTTP ${res.status}`);
    if (intento < 3) await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

async function main() {
  const csv = await bajarCsvConReintento();
  if (csv === null) {
    console.log("No se pudo bajar el CSV del resumen de inbox esta vez — se reintenta en la próxima corrida.");
    return;
  }

  const filas = parseCsv(csv);
  if (filas.length < 2) {
    console.log("Sin snapshot todavía.");
    return;
  }

  const [header, fila] = filas;
  const idx = {
    fecha: header.indexOf("Fecha"),
    cantidadSinResponder: header.indexOf("CantidadSinResponder"),
    temasComunes: header.indexOf("TemasComunes"),
    ejemplo: header.indexOf("Ejemplo"),
    pageId: header.indexOf("PageId")
  };

  const resumen = {
    ts: parseFechaSheet(fila[idx.fecha]),
    cantidadSinResponder: Number(fila[idx.cantidadSinResponder]) || 0,
    temasComunes: fila[idx.temasComunes] || "",
    ejemplo: fila[idx.ejemplo] || "",
    pageId: fila[idx.pageId] || ""
  };

  const actual = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, "utf8") : "";
  const nuevo = JSON.stringify(resumen, null, 2) + "\n";

  if (actual === nuevo) {
    console.log("Sin cambios en el resumen de inbox.");
    return;
  }

  fs.writeFileSync(OUTPUT_PATH, nuevo);
  console.log("Actualizado data/resumen-inbox.json.");
}

function parseFechaSheet(texto) {
  if (!texto) return 0;
  const m = texto.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  const [, dd, mm, yyyy, hh, min, ss] = m;
  return new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(min),
    Number(ss || 0)
  ).getTime();
}

function parseCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = "";
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') {
        entreComillas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else {
      campo += c;
    }
  }
  if (campo !== "" || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.length > 1 || f[0] !== "");
}

main().catch((err) => {
  console.error("FALLO:", err);
  process.exit(1);
});
