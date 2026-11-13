import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  activos,
  almacenes,
  existencias,
  movimientos,
  ordenesTrabajo,
  repuestos,
  solicitudesRepuesto,
  usuarios,
} from "@/db/schema";

export function listarAlmacenes() {
  return db.select().from(almacenes).where(eq(almacenes.activo, true)).orderBy(asc(almacenes.id));
}

export type FilaExistencia = {
  id: number;
  codigo: string;
  codigoFabricante: string | null;
  sinCodigoFabricante: boolean;
  marca: string | null;
  cuentaId: number | null;
  descripcion: string;
  unidad: string;
  familia: string | null;
  stockMinimo: number;
  stockMaximo: number | null;
  costoMedio: number;
  activo: boolean;
  /** Existencia del inventario: todos los almacenes menos la bodega Capex. */
  total: number;
  /** Lo guardado en la bodega Capex: no entra al total ni a la valorización. */
  capex: number;
  porAlmacen: Record<number, { cantidad: number; ubicacion: string | null }>;
};

/** Catálogo con sus existencias por almacén. `texto` busca en código, código de fabricante y descripción. */
export async function listarExistencias(opciones: { texto?: string; ids?: number[]; inactivos?: boolean } = {}): Promise<FilaExistencia[]> {
  const filtros: (SQL | undefined)[] = [];
  if (!opciones.inactivos) filtros.push(eq(repuestos.activo, true));
  if (opciones.ids) filtros.push(inArray(repuestos.id, opciones.ids.length ? opciones.ids : [-1]));
  const t = opciones.texto?.trim();
  if (t) {
    const patron = `%${t.replace(/[%_\\]/g, "\\$&")}%`;
    filtros.push(or(ilike(repuestos.codigo, patron), ilike(repuestos.codigoFabricante, patron), ilike(repuestos.marca, patron), ilike(repuestos.descripcion, patron), ilike(repuestos.familia, patron)));
  }
  const lista = await db.select().from(repuestos).where(and(...filtros)).orderBy(asc(repuestos.codigo));
  if (lista.length === 0) return [];
  const [ex, bodegasCapex] = await Promise.all([
    db.select().from(existencias).where(inArray(existencias.repuestoId, lista.map((r) => r.id))),
    db.select({ id: almacenes.id }).from(almacenes).where(eq(almacenes.esCapex, true)),
  ]);
  const esCapex = new Set(bodegasCapex.map((a) => a.id));
  const suma = (filas: typeof ex) => Math.round(filas.reduce((s, e) => s + e.cantidad, 0) * 100) / 100;
  return lista.map((r) => {
    const propias = ex.filter((e) => e.repuestoId === r.id);
    return {
      ...r,
      total: suma(propias.filter((e) => !esCapex.has(e.almacenId))),
      capex: suma(propias.filter((e) => esCapex.has(e.almacenId))),
      porAlmacen: Object.fromEntries(propias.map((e) => [e.almacenId, { cantidad: e.cantidad, ubicacion: e.ubicacion }])),
    };
  });
}

const destino = alias(almacenes, "destino");
const recibe = alias(usuarios, "recibe");

export function listarMovimientos(filtro?: SQL, limite = 200) {
  return db
    .select({
      id: movimientos.id,
      tipo: movimientos.tipo,
      fecha: movimientos.fecha,
      cantidad: movimientos.cantidad,
      costoUnitario: movimientos.costoUnitario,
      repuestoId: repuestos.id,
      codigo: repuestos.codigo,
      descripcion: repuestos.descripcion,
      unidad: repuestos.unidad,
      almacenId: movimientos.almacenId,
      almacen: almacenes.nombre,
      almacenDestinoId: movimientos.almacenDestinoId,
      destino: destino.nombre,
      usuario: usuarios.nombre,
      recibe: recibe.nombre,
      otId: movimientos.otId,
      folio: ordenesTrabajo.folio,
      activo: activos.nombre,
      documento: movimientos.documento,
      nota: movimientos.nota,
    })
    .from(movimientos)
    .innerJoin(repuestos, eq(repuestos.id, movimientos.repuestoId))
    .innerJoin(almacenes, eq(almacenes.id, movimientos.almacenId))
    .innerJoin(usuarios, eq(usuarios.id, movimientos.usuarioId))
    .leftJoin(destino, eq(destino.id, movimientos.almacenDestinoId))
    .leftJoin(recibe, eq(recibe.id, movimientos.recibeId))
    .leftJoin(ordenesTrabajo, eq(ordenesTrabajo.id, movimientos.otId))
    .leftJoin(activos, eq(activos.id, movimientos.activoId))
    .where(filtro)
    .orderBy(desc(movimientos.fecha), desc(movimientos.id))
    .limit(limite);
}

/** Repuestos entregados a una OT (entregas menos devoluciones) con su costo. */
export async function consumoDeOt(otId: number) {
  const filas = await db
    .select({
      repuestoId: repuestos.id,
      codigo: repuestos.codigo,
      descripcion: repuestos.descripcion,
      unidad: repuestos.unidad,
      cantidad: sql<number>`-sum(${movimientos.cantidad})`.mapWith(Number),
      costo: sql<number>`-sum(${movimientos.cantidad} * ${movimientos.costoUnitario})`.mapWith(Number),
    })
    .from(movimientos)
    .innerJoin(repuestos, eq(repuestos.id, movimientos.repuestoId))
    .where(and(eq(movimientos.otId, otId), inArray(movimientos.tipo, ["SALIDA", "DEVOLUCION"])))
    .groupBy(repuestos.id)
    .orderBy(asc(repuestos.codigo));
  return filas.filter((f) => f.cantidad !== 0);
}

export function solicitudesPendientes(filtro?: SQL) {
  return db
    .select({
      id: solicitudesRepuesto.id,
      cantidad: solicitudesRepuesto.cantidad,
      entregada: solicitudesRepuesto.entregada,
      scId: solicitudesRepuesto.scId,
      codigo: solicitudesRepuesto.codigoFabricante,
      descripcion: solicitudesRepuesto.descripcion,
      repuestoId: solicitudesRepuesto.repuestoId,
      creadaEn: solicitudesRepuesto.creadaEn,
      activo: activos.nombre,
      solicitante: usuarios.nombre,
      folio: ordenesTrabajo.folio,
    })
    .from(solicitudesRepuesto)
    .innerJoin(activos, eq(activos.id, solicitudesRepuesto.activoId))
    .innerJoin(usuarios, eq(usuarios.id, solicitudesRepuesto.solicitanteId))
    .leftJoin(ordenesTrabajo, eq(ordenesTrabajo.id, solicitudesRepuesto.otId))
    .where(and(inArray(solicitudesRepuesto.estado, ["PENDIENTE", "APROBADA"]), filtro))
    .orderBy(solicitudesRepuesto.creadaEn);
}
