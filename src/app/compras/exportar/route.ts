import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import ExcelJS from "exceljs";
import { db } from "@/db";
import {
  activos,
  almacenes,
  centrosCosto,
  cuentasContables,
  lineasRecepcion,
  movimientos,
  ordenesCompra,
  ordenesTrabajo,
  recepciones,
  repuestos,
  usuarios,
} from "@/db/schema";
import { TIPOS_MOVIMIENTO } from "@/lib/bodega-core";
import { usuarioActual } from "@/lib/dal";
import { fechaHora, inicioDelDiaEnChile } from "@/lib/tiempo";

// Una entrada por orden de compra se imputa a la cuenta y al centro de costo de esa orden.
const cuentaOc = alias(cuentasContables, "cuenta_oc");
const centroOc = alias(centrosCosto, "centro_oc");

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Movimientos de bodega valorizados de un período, con cuenta contable y centro de costo, para contabilidad.
export async function GET(request: Request) {
  const usuario = await usuarioActual();
  if (!usuario || usuario.perfil === "TECNICO" || usuario.perfil === "OPERADOR") return new Response("No autorizado", { status: 403 });
  const p = new URL(request.url).searchParams;
  const desde = p.get("desde") ?? "";
  const hasta = p.get("hasta") ?? "";
  if (!FECHA.test(desde) || !FECHA.test(hasta) || hasta < desde) return new Response("Fechas no válidas", { status: 400 });
  const fin = new Date(inicioDelDiaEnChile(hasta).getTime() + 24 * 3_600_000);
  const filas = await db
    .select({
      fecha: movimientos.fecha,
      tipo: movimientos.tipo,
      documento: movimientos.documento,
      codigo: repuestos.codigo,
      descripcion: repuestos.descripcion,
      unidad: repuestos.unidad,
      cantidad: movimientos.cantidad,
      costo: movimientos.costoUnitario,
      cuenta: sql<string | null>`coalesce(${cuentaOc.codigo}, ${cuentasContables.codigo})`,
      cuentaNombre: sql<string | null>`coalesce(${cuentaOc.nombre}, ${cuentasContables.nombre})`,
      centro: sql<string | null>`coalesce(${centroOc.codigo}, ${centrosCosto.codigo})`,
      centroNombre: sql<string | null>`coalesce(${centroOc.nombre}, ${centrosCosto.nombre})`,
      folio: ordenesTrabajo.folio,
      maquina: activos.nombre,
      almacen: almacenes.nombre,
      usuario: usuarios.nombre,
      nota: movimientos.nota,
    })
    .from(movimientos)
    .innerJoin(repuestos, eq(repuestos.id, movimientos.repuestoId))
    .innerJoin(almacenes, eq(almacenes.id, movimientos.almacenId))
    .innerJoin(usuarios, eq(usuarios.id, movimientos.usuarioId))
    .leftJoin(cuentasContables, eq(cuentasContables.id, repuestos.cuentaId))
    .leftJoin(activos, eq(activos.id, movimientos.activoId))
    .leftJoin(centrosCosto, eq(centrosCosto.id, activos.centroCostoId))
    .leftJoin(ordenesTrabajo, eq(ordenesTrabajo.id, movimientos.otId))
    .leftJoin(lineasRecepcion, eq(lineasRecepcion.movimientoId, movimientos.id))
    .leftJoin(recepciones, eq(recepciones.id, lineasRecepcion.recepcionId))
    .leftJoin(ordenesCompra, eq(ordenesCompra.id, recepciones.ocId))
    .leftJoin(cuentaOc, eq(cuentaOc.id, ordenesCompra.cuentaId))
    .leftJoin(centroOc, eq(centroOc.id, ordenesCompra.centroCostoId))
    // Un traslado no cambia el valor de las existencias: no va a contabilidad.
    .where(and(gte(movimientos.fecha, inicioDelDiaEnChile(desde)), lt(movimientos.fecha, fin)))
    .orderBy(asc(movimientos.fecha), asc(movimientos.id));
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Movimientos");
  hoja.columns = [
    { header: "Fecha", width: 18 },
    { header: "Tipo", width: 12 },
    { header: "Documento", width: 22 },
    { header: "Código repuesto", width: 16 },
    { header: "Descripción", width: 36 },
    { header: "Unidad", width: 10 },
    { header: "Cantidad", width: 11 },
    { header: "Costo unitario ($)", width: 17 },
    { header: "Total ($)", width: 14 },
    { header: "Cuenta contable", width: 16 },
    { header: "Nombre cuenta", width: 26 },
    { header: "Centro de costo", width: 16 },
    { header: "Nombre centro", width: 26 },
    { header: "OT", width: 10 },
    { header: "Máquina", width: 24 },
    { header: "Almacén", width: 18 },
    { header: "Usuario", width: 20 },
    { header: "Nota", width: 30 },
  ];
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: "frozen", ySplit: 1 }];
  for (const f of filas) {
    if (f.tipo === "TRASLADO") continue;
    hoja.addRow([
      fechaHora(f.fecha),
      TIPOS_MOVIMIENTO[f.tipo],
      f.documento ?? "",
      f.codigo,
      f.descripcion,
      f.unidad,
      f.cantidad,
      f.costo,
      Math.round(f.cantidad * f.costo),
      f.cuenta ?? "",
      f.cuentaNombre ?? "",
      f.centro ?? "",
      f.centroNombre ?? "",
      f.folio ?? "",
      f.maquina ?? "",
      f.almacen,
      f.usuario,
      f.nota ?? "",
    ]);
  }
  return new Response(new Uint8Array(await libro.xlsx.writeBuffer()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="movimientos-bodega-${desde}-a-${hasta}.xlsx"`,
    },
  });
}
