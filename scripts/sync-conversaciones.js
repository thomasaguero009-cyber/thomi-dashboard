// Lee el CSV publicado de la pestaña "Conversaciones" (se acumula para
// siempre, un mensaje real por fila, de los dos lados) y actualiza
// data/conversaciones.json — la base para el informe por contacto.
const fs = require("fs");
const path = require("path");

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS7PYOuQhFlTcz_1nEtcJrqq5k1mp0A3jwPTWEZzCB5-vB60fFhL17lkAeL8shjSMIJLjeUsau2gxsl/pub?gid=417032551&single=true&output=csv";
const OUTPUT_PATH = path.join(__dirname, "..", "data", "conversaciones.json");

// Misma cautela que sync-resumen-inbox.js: el publish-cache de Sheets a
// veces devuelve 401/307 transitorios. Si falla, no corta el workflow —
// se recupera solo en la próxima corrida.
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
    console.log("No se pudo bajar el CSV de conversaciones esta vez — se reintenta en la próxima corrida.");
    return;
  }

  const filas = parseCsv(csv);
  if (filas.length < 2) {
    console.log("Sin mensajes todavía.");
    return;
  }

  const [header, ...resto] = filas;
  const idx = {
    fecha: header.indexOf("Fecha"),
    subscriberId: header.indexOf("SubscriberId"),
    nombreContacto: header.indexOf("NombreContacto"),
    remitente: header.indexOf("Remitente"),
    texto: header.indexOf("Texto")
  };

  const mensajes = resto
    .filter((fila) => fila[idx.subscriberId])
    .map((fila) => ({
      ts: parseFechaSheet(fila[idx.fecha]),
      subscriberId: fila[idx.subscriberId] || "",
      nombreContacto: fila[idx.nombreContacto] || "",
      remitente: fila[idx.remitente] || "",
      texto: fila[idx.texto] || ""
    }));

  const actual = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, "utf8") : "";
  const nuevo = JSON.stringify(mensajes, null, 2) + "\n";

  if (actual === nuevo) {
    console.log("Sin cambios en conversaciones.");
    return;
  }

  fs.writeFileSync(OUTPUT_PATH, nuevo);
  console.log(`Actualizado data/conversaciones.json (${mensajes.length} mensajes).`);
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
