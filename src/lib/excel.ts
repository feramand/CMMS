// Lectura y generación de planillas Excel para la carga inicial.
import ExcelJS from "exceljs";
import { normalizar, type Columna, type Fila } from "./carga-core";
import { ErrorDeNegocio } from "./usuarios-core";

/** Planilla con los encabezados del sistema y una fila de ejemplo. */
export async function plantilla(nombreHoja: string, columnas: Columna[]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet(nombreHoja);
  hoja.addRow(columnas.map((c) => c.titulo));
  hoja.addRow(columnas.map((c) => c.ejemplo));
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: "frozen", ySplit: 1 }];
  columnas.forEach((c, i) => {
    const col = hoja.getColumn(i + 1);
    col.width = Math.max(16, c.titulo.length + 2);
    // Todo como texto: evita que Excel convierta un RUT, un PIN "0123" o un código en número.
    col.numFmt = "@";
    if (c.obligatoria) {
      hoja.getCell(1, i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE68A" } };
    }
  });
  return Buffer.from(await libro.xlsx.writeBuffer());
}

/**
 * Lee la primera hoja y devuelve una fila por registro, con las claves de `columnas`.
 * Reconoce los encabezados aunque cambien mayúsculas o tildes; ignora las filas vacías.
 */
export async function leerPlanilla(contenido: ArrayBuffer, columnas: Columna[]): Promise<Fila[]> {
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(contenido);
  } catch {
    throw new ErrorDeNegocio("El archivo no es una planilla Excel (.xlsx) válida.");
  }
  const hoja = libro.worksheets[0];
  if (!hoja) throw new ErrorDeNegocio("La planilla no tiene hojas.");
  const porEncabezado = new Map(columnas.map((c) => [normalizar(c.titulo), c.clave]));
  // Los encabezados suelen estar en la fila 1, pero una planilla con título encima también sirve:
  // se toma la primera fila, entre las 30 primeras, que tenga todas las columnas obligatorias.
  let claves: (string | undefined)[] = [];
  let filaEncabezado = 1;
  for (let n = 1; n <= Math.min(30, hoja.rowCount); n++) {
    const candidata: (string | undefined)[] = [];
    hoja.getRow(n).eachCell((celda, i) => {
      candidata[i] = porEncabezado.get(normalizar(celda.text));
    });
    if (n === 1) claves = candidata;
    if (columnas.every((c) => !c.obligatoria || candidata.includes(c.clave))) {
      claves = candidata;
      filaEncabezado = n;
      break;
    }
  }
  const faltan = columnas.filter((c) => c.obligatoria && !claves.includes(c.clave));
  if (faltan.length > 0) {
    throw new ErrorDeNegocio(
      `Faltan columnas en la planilla: ${faltan.map((c) => c.titulo).join(", ")}. Usa la plantilla descargable.`,
    );
  }
  const filas: Fila[] = [];
  for (let n = filaEncabezado + 1; n <= hoja.rowCount; n++) {
    const fila: Fila = {};
    hoja.getRow(n).eachCell((celda, i) => {
      const clave = claves[i];
      if (clave) fila[clave] = celda.text.trim();
    });
    // `_fila` guarda el número de fila de la planilla, para señalar los errores.
    if (Object.values(fila).some((v) => v !== "")) filas.push({ ...fila, _fila: String(n) });
  }
  return filas;
}
