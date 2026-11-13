import ExcelJS from "exceljs";
import { listarAlmacenes, listarExistencias } from "@/lib/consultas-bodega";
import { usuarioActual } from "@/lib/dal";
import { partesEnChile } from "@/lib/tiempo";

// Existencias de bodega al momento de la descarga, valorizadas al costo medio, con una columna por almacén.
export async function GET() {
  const usuario = await usuarioActual();
  if (!usuario || usuario.perfil === "TECNICO" || usuario.perfil === "OPERADOR") return new Response("No autorizado", { status: 403 });
  const [almacenes, filas] = await Promise.all([listarAlmacenes(), listarExistencias()]);
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Existencias");
  hoja.columns = [
    { header: "Código interno", width: 16 },
    { header: "Descripción", width: 38 },
    { header: "Código de fabricante", width: 20 },
    { header: "Marca", width: 14 },
    { header: "Familia", width: 16 },
    { header: "Unidad", width: 10 },
    { header: "Stock mínimo", width: 13 },
    { header: "Stock máximo", width: 13 },
    ...almacenes.flatMap((a) => [
      { header: a.nombre, width: 16 },
      { header: `Ubicación · ${a.nombre}`, width: 22 },
    ]),
    { header: "Existencia total", width: 16 },
    { header: "Costo medio ($)", width: 15 },
    { header: "Valor ($)", width: 14 },
    { header: "Bajo el mínimo", width: 14 },
  ];
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of filas) {
    hoja.addRow([
      r.codigo,
      r.descripcion,
      r.codigoFabricante ?? (r.sinCodigoFabricante ? "Sin código" : ""),
      r.marca ?? "",
      r.familia ?? "",
      r.unidad,
      r.stockMinimo,
      r.stockMaximo ?? "",
      ...almacenes.flatMap((a) => [r.porAlmacen[a.id]?.cantidad ?? 0, r.porAlmacen[a.id]?.ubicacion ?? ""]),
      r.total,
      r.costoMedio,
      Math.round(r.total * r.costoMedio),
      r.stockMinimo > 0 && r.total <= r.stockMinimo ? "Sí" : "No",
    ]);
  }
  return new Response(new Uint8Array(await libro.xlsx.writeBuffer()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="existencias-bodega-${partesEnChile(new Date()).fecha}.xlsx"`,
    },
  });
}
