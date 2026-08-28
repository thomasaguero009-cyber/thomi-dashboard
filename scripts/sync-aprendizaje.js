// Lee el CSV publicado de la hoja "Thom.i — Aprendizaje" y actualiza
// data/aprendizaje.json — reemplaza el export manual que hacía antes un
// humano (pedirle a Claude que arme el JSON a mano). Corre sola por cron
// en GitHub Actions, sin depender de Netlify ni de ninguna cuenta.
const fs = require("fs");
const path = require("path");

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS7PYOuQhFlTcz_1nEtcJrqq5k1mp0A3jwPTWEZzCB5-vB60fFhL17lkAeL8shjSMIJLjeUsau2gxsl/pub?gid=0&single=true&output=csv";
const OUTPUT_PATH = path.join(__dirname, "..", "data", "aprendizaje.json");

async function main() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`No se pudo bajar el CSV: HTTP ${res.status}`);
  const csv = await res.text();

  const filas = parseCsv(csv);
  if (!filas.length) {
    console.log("CSV vacío, no hay nada que sincronizar.");
    return;
  }

  const [header, ...resto] = filas;
  const idx = {
    fecha: header.indexOf("Fecha"),
    mensaje: header.indexOf("Mensaje"),
    boton: header.indexOf("Boton"),
    respuesta: header.indexOf("Respuesta"),
    subscriberId: header.indexOf("SubscriberId"),
    setter: header.indexOf("Setter"),
    pageId: header.indexOf("PageId"),
    nombreContacto: header.indexOf("NombreContacto")
  };

  const entradas = resto
    .filter((fila) => fila.some((celda) => celda.trim() !== ""))
    .map((fila) => ({
      ts: parseFechaSheet(fila[idx.fecha]),
      mensaje: fila[idx.mensaje] || "",
      boton: fila[idx.boton] || "",
      respuesta: fila[idx.respuesta] || "",
      subscriberId: fila[idx.subscriberId] || "",
      setter: fila[idx.setter] || "",
      pageId: fila[idx.pageId] || "",
      nombreContacto: idx.nombreContacto >= 0 ? fila[idx.nombreContacto] || "" : ""
    }));

  const actual = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, "utf8") : "";
  const nuevo = JSON.stringify(entradas, null, 2) + "\n";

  if (actual === nuevo) {
    console.log(`Sin cambios (${entradas.length} entradas).`);
    return;
  }

  fs.writeFileSync(OUTPUT_PATH, nuevo);
  console.log(`Actualizado data/aprendizaje.json con ${entradas.length} entradas.`);
}

// La hoja guarda "Fecha" como fecha/hora de Google Sheets (tz America/Bogota)
// y el export CSV la manda como texto "dd/mm/yyyy hh:mm:ss". Se convierte a
// epoch ms para que el dashboard pueda ordenar/mostrar igual que con ts.
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

// Parser CSV mínimo que respeta comillas dobles (Google escapa así cualquier
// campo con comas o saltos de línea) — evita depender de un paquete npm
// solo para esto.
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
