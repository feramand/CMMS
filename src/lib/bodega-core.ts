// Bodega: catálogo de repuestos, existencias por almacén, movimientos e inventarios.
// Regla central: las existencias nunca se editan directamente; toda variación es un movimiento
// con usuario y fecha.
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  almacenes,
  bitacora,
  existencias,
  lineasToma,
  movimientos,
  ordenesTrabajo,
  repuestos,
  repuestosActivo,
  solicitudesRepuesto,
  tomasInventario,
  type TipoMovimiento,
} from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import { cargar, type Columna, type Fila, normalizar } from "./carga-core";
import { idsPorPerfil, notificar } from "./notificar";
import { ErrorDeNegocio } from "./usuarios-core";

export const TIPOS_MOVIMIENTO: Record<TipoMovimiento, string> = {
  ENTRADA: "Entrada",
  SALIDA: "Entrega",
  TRASLADO: "Traslado",
  AJUSTE: "Ajuste",
  DEVOLUCION: "Devolución",
};

/** Quienes operan la bodega: mueven existencias. */
export function operaBodega(actor: UsuarioSesion): boolean {
  return actor.perfil === "BODEGUERO" || actor.perfil === "ADMINISTRADOR";
}

/** Quienes consultan la bodega completa (existencias, movimientos, costos). */
export function veBodega(actor: UsuarioSesion): boolean {
  return actor.perfil !== "OPERADOR" && actor.perfil !== "TECNICO";
}

function exigirOperar(actor: UsuarioSesion) {
  if (!operaBodega(actor)) throw new ErrorDeNegocio("Solo bodega puede mover existencias.");
}

/** Redondeo a 2 decimales, sin los errores típicos de sumar decimales. */
export function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Precio medio ponderado. Ejemplo: 10 unidades a $1.000 más 5 recibidas a $1.300 quedan a $1.100.
 * Si no había existencias, el costo pasa a ser el de la entrada.
 */
export function precioMedio(stock: number, costo: number, entra: number, costoEntrada: number): number {
  if (stock <= 0) return r2(costoEntrada);
  return r2((stock * costo + entra * costoEntrada) / (stock + entra));
}

/**
 * Lee un número escrito a la chilena ("1.234,5", "3.500") o con punto decimal ("1234.5"). Vacío es null.
 * Un punto seguido de exactamente 3 cifras se toma como separador de miles: las cantidades
 * y costos admiten 2 decimales como máximo, así que no puede ser un decimal.
 */
export function numero(texto: string | null | undefined): number | null {
  const t = (texto ?? "").trim().replace(/\s|\$/g, "");
  if (!t) return null;
  const miles = /^-?\d{1,3}(\.\d{3})+$/.test(t);
  const n = Number(t.includes(",") || miles ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : NaN;
}

function cantidadValida(n: number, que = "La cantidad"): number {
  if (!Number.isFinite(n) || n <= 0) throw new ErrorDeNegocio(`${que} debe ser un número mayor que cero.`);
  if (r2(n) !== n) throw new ErrorDeNegocio(`${que} admite hasta 2 decimales.`);
  return n;
}

// ---------- Catálogo ----------

export type DatosRepuesto = {
  codigo: string;
  codigoFabricante?: string | null;
  marca?: string | null;
  descripcion: string;
  unidad?: string | null;
  familia?: string | null;
  stockMinimo?: number | null;
  stockMaximo?: number | null;
  activoIds?: number[];
};

function exigirCatalogo(actor: UsuarioSesion) {
  if (!operaBodega(actor) && actor.perfil !== "ABASTECIMIENTO") {
    throw new ErrorDeNegocio("Solo bodega y abastecimiento pueden modificar el catálogo.");
  }
}

function limpiarRepuesto(d: DatosRepuesto) {
  const codigo = d.codigo.trim().toUpperCase();
  const descripcion = d.descripcion.trim();
  if (!codigo) throw new ErrorDeNegocio("Falta el código del repuesto.");
  if (!descripcion) throw new ErrorDeNegocio("Falta la descripción del repuesto.");
  const stockMinimo = d.stockMinimo ?? 0;
  const stockMaximo = d.stockMaximo ?? null;
  if (!Number.isFinite(stockMinimo) || stockMinimo < 0) throw new ErrorDeNegocio("El stock mínimo no puede ser negativo.");
  if (stockMaximo !== null && (!Number.isFinite(stockMaximo) || stockMaximo < stockMinimo)) {
    throw new ErrorDeNegocio("El stock máximo no puede ser menor que el mínimo.");
  }
  return {
    codigo,
    descripcion,
    codigoFabricante: d.codigoFabricante?.trim() || null,
    marca: d.marca?.trim() || null,
    unidad: d.unidad?.trim().toLowerCase() || "unidad",
    familia: d.familia?.trim() || null,
    stockMinimo: r2(stockMinimo),
    stockMaximo: stockMaximo === null ? null : r2(stockMaximo),
  };
}

async function fijarMaquinas(tx: DB, repuestoId: number, activoIds: number[] | undefined) {
  if (!activoIds) return;
  await tx.delete(repuestosActivo).where(eq(repuestosActivo.repuestoId, repuestoId));
  const unicos = [...new Set(activoIds.filter((n) => Number.isInteger(n)))];
  if (unicos.length) await tx.insert(repuestosActivo).values(unicos.map((activoId) => ({ repuestoId, activoId })));
}

export async function crearRepuesto(db: DB, actor: UsuarioSesion, datos: DatosRepuesto): Promise<number> {
  exigirCatalogo(actor);
  const v = limpiarRepuesto(datos);
  return db.transaction(async (tx) => {
    const [existe] = await tx.select({ id: repuestos.id }).from(repuestos).where(eq(repuestos.codigo, v.codigo));
    if (existe) throw new ErrorDeNegocio(`Ya existe un repuesto con el código ${v.codigo}.`);
    const [nuevo] = await tx.insert(repuestos).values(v).returning({ id: repuestos.id });
    await fijarMaquinas(tx as unknown as DB, nuevo.id, datos.activoIds);
    await tx.insert(bitacora).values({ usuarioId: actor.id, accion: "CREAR_REPUESTO", entidad: "repuesto", entidadId: String(nuevo.id), detalle: { codigo: v.codigo, descripcion: v.descripcion } });
    return nuevo.id;
  });
}

export async function actualizarRepuesto(
  db: DB,
  actor: UsuarioSesion,
  id: number,
  datos: DatosRepuesto & { activo?: boolean },
): Promise<void> {
  exigirCatalogo(actor);
  const v = limpiarRepuesto(datos);
  await db.transaction(async (tx) => {
    const [otro] = await tx
      .select({ id: repuestos.id })
      .from(repuestos)
      .where(and(eq(repuestos.codigo, v.codigo), ne(repuestos.id, id)));
    if (otro) throw new ErrorDeNegocio(`Ya existe otro repuesto con el código ${v.codigo}.`);
    if (datos.activo === false) {
      const [{ total }] = await tx
        .select({ total: sql<number>`coalesce(sum(${existencias.cantidad}), 0)`.mapWith(Number) })
        .from(existencias)
        .where(eq(existencias.repuestoId, id));
      if (total > 0) throw new ErrorDeNegocio("No se puede dar de baja un repuesto que todavía tiene existencias.");
    }
    const cambiados = await tx
      .update(repuestos)
      .set({ ...v, ...(datos.activo === undefined ? {} : { activo: datos.activo }) })
      .where(eq(repuestos.id, id))
      .returning({ id: repuestos.id });
    if (cambiados.length === 0) throw new ErrorDeNegocio("El repuesto no existe.");
    await fijarMaquinas(tx as unknown as DB, id, datos.activoIds);
    await tx.insert(bitacora).values({ usuarioId: actor.id, accion: "EDITAR_REPUESTO", entidad: "repuesto", entidadId: String(id), detalle: v });
  });
}

// ---------- Movimientos ----------

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Bloquea el repuesto mientras dura la operación y devuelve sus datos y el total en todos los almacenes. */
async function tomarRepuesto(tx: Tx, repuestoId: number) {
  const [r] = await tx.select().from(repuestos).where(eq(repuestos.id, repuestoId)).for("update");
  if (!r) throw new ErrorDeNegocio("El repuesto no existe en el catálogo.");
  const [{ total }] = await tx
    .select({ total: sql<number>`coalesce(sum(${existencias.cantidad}), 0)`.mapWith(Number) })
    .from(existencias)
    .where(eq(existencias.repuestoId, repuestoId));
  return { r, total };
}

async function exigirAlmacen(tx: Tx, almacenId: number) {
  const [a] = await tx.select().from(almacenes).where(eq(almacenes.id, almacenId));
  if (!a || !a.activo) throw new ErrorDeNegocio("Elige un almacén.");
  return a;
}

async function enAlmacen(tx: Tx, repuestoId: number, almacenId: number): Promise<number> {
  const [e] = await tx
    .select({ cantidad: existencias.cantidad })
    .from(existencias)
    .where(and(eq(existencias.repuestoId, repuestoId), eq(existencias.almacenId, almacenId)));
  return e?.cantidad ?? 0;
}

/** Suma (o resta) existencias en un almacén. Nunca deja un saldo negativo. */
async function variar(tx: Tx, repuestoId: number, almacenId: number, delta: number, unidad: string) {
  const hay = await enAlmacen(tx, repuestoId, almacenId);
  const queda = r2(hay + delta);
  if (queda < 0) {
    const a = await exigirAlmacen(tx, almacenId);
    throw new ErrorDeNegocio(`No hay existencias suficientes en ${a.nombre}: hay ${hay} ${unidad}.`);
  }
  await tx
    .insert(existencias)
    .values({ repuestoId, almacenId, cantidad: queda })
    .onConflictDoUpdate({ target: [existencias.repuestoId, existencias.almacenId], set: { cantidad: queda } });
}

/** Avisa a bodega y abastecimiento cuando un repuesto cruza hacia abajo su stock mínimo. */
async function avisarSiBajoMinimo(
  tx: Tx,
  r: { id: number; codigo: string; descripcion: string; stockMinimo: number; unidad: string },
  antes: number,
  despues: number,
) {
  if (r.stockMinimo > 0 && antes >= r.stockMinimo && despues < r.stockMinimo) {
    await notificar(
      tx,
      await idsPorPerfil(tx, "BODEGUERO", "ABASTECIMIENTO"),
      `Stock bajo el mínimo: ${r.codigo} ${r.descripcion} (quedan ${despues} ${r.unidad}, mínimo ${r.stockMinimo})`,
      `/bodega/repuesto/${r.id}`,
    );
  }
}

export type DatosEntrada = {
  repuestoId: number;
  almacenId: number;
  cantidad: number;
  /** Costo unitario en pesos. Vacío: entra al costo medio vigente, que no cambia. */
  costoUnitario?: number | null;
  documento?: string | null;
  nota?: string | null;
};

/** Entrada de mercadería. Actualiza el costo por precio medio ponderado. */
export async function registrarEntrada(db: DB, actor: UsuarioSesion, d: DatosEntrada): Promise<number> {
  exigirOperar(actor);
  const cantidad = cantidadValida(d.cantidad);
  const costo = d.costoUnitario ?? null;
  if (costo !== null && (!Number.isFinite(costo) || costo < 0)) throw new ErrorDeNegocio("El costo no puede ser negativo.");
  return db.transaction(async (tx) => {
    const { r, total } = await tomarRepuesto(tx, d.repuestoId);
    if (!r.activo) throw new ErrorDeNegocio("El repuesto está dado de baja.");
    await exigirAlmacen(tx, d.almacenId);
    await variar(tx, r.id, d.almacenId, cantidad, r.unidad);
    const costoEntrada = costo ?? r.costoMedio;
    await tx.update(repuestos).set({ costoMedio: precioMedio(total, r.costoMedio, cantidad, costoEntrada) }).where(eq(repuestos.id, r.id));
    const [m] = await tx
      .insert(movimientos)
      .values({
        tipo: "ENTRADA",
        repuestoId: r.id,
        almacenId: d.almacenId,
        cantidad,
        costoUnitario: r2(costoEntrada),
        usuarioId: actor.id,
        documento: d.documento?.trim() || null,
        nota: d.nota?.trim() || null,
      })
      .returning({ id: movimientos.id });
    return m.id;
  });
}

export type DatosSalida = {
  repuestoId: number;
  almacenId: number;
  cantidad: number;
  otId?: number | null;
  activoId?: number | null;
  recibeId?: number | null;
  solicitudRepuestoId?: number | null;
  nota?: string | null;
};

async function salida(tx: Tx, actor: UsuarioSesion, d: DatosSalida): Promise<number> {
  const cantidad = cantidadValida(d.cantidad);
  const { r, total } = await tomarRepuesto(tx, d.repuestoId);
  await exigirAlmacen(tx, d.almacenId);
  await variar(tx, r.id, d.almacenId, -cantidad, r.unidad);
  let activoId = d.activoId ?? null;
  if (d.otId) {
    const [ot] = await tx.select({ activoId: ordenesTrabajo.activoId }).from(ordenesTrabajo).where(eq(ordenesTrabajo.id, d.otId));
    if (!ot) throw new ErrorDeNegocio("La orden de trabajo no existe.");
    activoId = ot.activoId;
  }
  const [m] = await tx
    .insert(movimientos)
    .values({
      tipo: "SALIDA",
      repuestoId: r.id,
      almacenId: d.almacenId,
      cantidad: -cantidad,
      costoUnitario: r.costoMedio,
      usuarioId: actor.id,
      otId: d.otId ?? null,
      activoId,
      recibeId: d.recibeId ?? null,
      solicitudRepuestoId: d.solicitudRepuestoId ?? null,
      nota: d.nota?.trim() || null,
    })
    .returning({ id: movimientos.id });
  await avisarSiBajoMinimo(tx, r, total, r2(total - cantidad));
  return m.id;
}

/** Entrega directa en el mesón, sin solicitud previa. El costo se carga a la OT si se indica. */
export async function registrarSalida(db: DB, actor: UsuarioSesion, d: DatosSalida): Promise<number> {
  exigirOperar(actor);
  return db.transaction((tx) => salida(tx, actor, d));
}

/**
 * Entrega de una solicitud de repuesto: descuenta existencias, carga el costo a la OT de la
 * solicitud y avisa a quien pidió.
 */
export async function entregarSolicitud(
  db: DB,
  actor: UsuarioSesion,
  solicitudId: number,
  d: { repuestoId: number; almacenId: number; cantidad: number },
): Promise<void> {
  exigirOperar(actor);
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(solicitudesRepuesto).where(eq(solicitudesRepuesto.id, solicitudId)).for("update");
    if (!s) throw new ErrorDeNegocio("La solicitud no existe.");
    if (s.estado !== "PENDIENTE" && s.estado !== "APROBADA") throw new ErrorDeNegocio("La solicitud ya fue resuelta.");
    await salida(tx, actor, {
      repuestoId: d.repuestoId,
      almacenId: d.almacenId,
      cantidad: d.cantidad,
      otId: s.otId,
      activoId: s.activoId,
      recibeId: s.solicitanteId,
      solicitudRepuestoId: s.id,
    });
    await tx
      .update(solicitudesRepuesto)
      .set({ estado: "ENTREGADA", repuestoId: d.repuestoId, resueltaEn: new Date(), resueltaPor: actor.id })
      .where(eq(solicitudesRepuesto.id, s.id));
    await notificar(tx, [s.solicitanteId], `Repuesto entregado: ${s.descripcion}`, "/inicio");
  });
}

/** Repuesto que vuelve sin usar. Entra al costo medio vigente, que no cambia. */
export async function registrarDevolucion(
  db: DB,
  actor: UsuarioSesion,
  d: { repuestoId: number; almacenId: number; cantidad: number; otId?: number | null; nota?: string | null },
): Promise<number> {
  exigirOperar(actor);
  const cantidad = cantidadValida(d.cantidad);
  return db.transaction(async (tx) => {
    const { r } = await tomarRepuesto(tx, d.repuestoId);
    await exigirAlmacen(tx, d.almacenId);
    let activoId: number | null = null;
    if (d.otId) {
      const [ot] = await tx.select({ activoId: ordenesTrabajo.activoId }).from(ordenesTrabajo).where(eq(ordenesTrabajo.id, d.otId));
      if (!ot) throw new ErrorDeNegocio("La orden de trabajo no existe.");
      activoId = ot.activoId;
      // No se puede devolver a una OT más de lo que se le entregó.
      const [{ neto }] = await tx
        .select({ neto: sql<number>`coalesce(sum(${movimientos.cantidad}), 0)`.mapWith(Number) })
        .from(movimientos)
        .where(
          and(
            eq(movimientos.otId, d.otId),
            eq(movimientos.repuestoId, r.id),
            inArray(movimientos.tipo, ["SALIDA", "DEVOLUCION"]),
          ),
        );
      if (r2(-neto) < cantidad) {
        throw new ErrorDeNegocio(`A esa orden de trabajo solo se le han entregado ${r2(-neto)} ${r.unidad} de este repuesto.`);
      }
    }
    await variar(tx, r.id, d.almacenId, cantidad, r.unidad);
    const [m] = await tx
      .insert(movimientos)
      .values({
        tipo: "DEVOLUCION",
        repuestoId: r.id,
        almacenId: d.almacenId,
        cantidad,
        costoUnitario: r.costoMedio,
        usuarioId: actor.id,
        otId: d.otId ?? null,
        activoId,
        nota: d.nota?.trim() || null,
      })
      .returning({ id: movimientos.id });
    return m.id;
  });
}

/** Traslado entre bodega y pañoles. No cambia el total ni el costo. */
export async function registrarTraslado(
  db: DB,
  actor: UsuarioSesion,
  d: { repuestoId: number; origenId: number; destinoId: number; cantidad: number; nota?: string | null },
): Promise<number> {
  exigirOperar(actor);
  const cantidad = cantidadValida(d.cantidad);
  if (d.origenId === d.destinoId) throw new ErrorDeNegocio("El almacén de destino debe ser distinto al de origen.");
  return db.transaction(async (tx) => {
    const { r } = await tomarRepuesto(tx, d.repuestoId);
    await exigirAlmacen(tx, d.origenId);
    await exigirAlmacen(tx, d.destinoId);
    await variar(tx, r.id, d.origenId, -cantidad, r.unidad);
    await variar(tx, r.id, d.destinoId, cantidad, r.unidad);
    const [m] = await tx
      .insert(movimientos)
      .values({
        tipo: "TRASLADO",
        repuestoId: r.id,
        almacenId: d.origenId,
        almacenDestinoId: d.destinoId,
        cantidad,
        costoUnitario: r.costoMedio,
        usuarioId: actor.id,
        nota: d.nota?.trim() || null,
      })
      .returning({ id: movimientos.id });
    return m.id;
  });
}

/** Ajuste manual: se indica la cantidad real y el motivo. Queda registrada la diferencia. */
export async function registrarAjuste(
  db: DB,
  actor: UsuarioSesion,
  d: { repuestoId: number; almacenId: number; cantidadReal: number; nota: string },
): Promise<number | null> {
  exigirOperar(actor);
  if (!Number.isFinite(d.cantidadReal) || d.cantidadReal < 0 || r2(d.cantidadReal) !== d.cantidadReal) {
    throw new ErrorDeNegocio("La cantidad real debe ser cero o más, con hasta 2 decimales.");
  }
  const nota = d.nota.trim();
  if (!nota) throw new ErrorDeNegocio("Indica el motivo del ajuste.");
  return db.transaction(async (tx) => {
    const { r, total } = await tomarRepuesto(tx, d.repuestoId);
    await exigirAlmacen(tx, d.almacenId);
    const delta = r2(d.cantidadReal - (await enAlmacen(tx, r.id, d.almacenId)));
    if (delta === 0) return null;
    await variar(tx, r.id, d.almacenId, delta, r.unidad);
    const [m] = await tx
      .insert(movimientos)
      .values({ tipo: "AJUSTE", repuestoId: r.id, almacenId: d.almacenId, cantidad: delta, costoUnitario: r.costoMedio, usuarioId: actor.id, nota })
      .returning({ id: movimientos.id });
    await avisarSiBajoMinimo(tx, r, total, r2(total + delta));
    return m.id;
  });
}

/** Estante o casillero donde se guarda un repuesto dentro de un almacén. */
export async function fijarUbicacion(db: DB, actor: UsuarioSesion, repuestoId: number, almacenId: number, ubicacion: string) {
  exigirOperar(actor);
  await db
    .insert(existencias)
    .values({ repuestoId, almacenId, cantidad: 0, ubicacion: ubicacion.trim() || null })
    .onConflictDoUpdate({ target: [existencias.repuestoId, existencias.almacenId], set: { ubicacion: ubicacion.trim() || null } });
}

/** El bodeguero rechaza una solicitud de repuesto, con motivo. */
export async function rechazarSolicitud(db: DB, actor: UsuarioSesion, id: number, motivo: string): Promise<void> {
  exigirOperar(actor);
  const cambiadas = await db
    .update(solicitudesRepuesto)
    .set({ estado: "RECHAZADA", motivoRechazo: motivo.trim() || null, resueltaEn: new Date(), resueltaPor: actor.id })
    .where(and(eq(solicitudesRepuesto.id, id), inArray(solicitudesRepuesto.estado, ["PENDIENTE", "APROBADA"])))
    .returning({ solicitanteId: solicitudesRepuesto.solicitanteId, descripcion: solicitudesRepuesto.descripcion });
  if (cambiadas.length === 0) throw new ErrorDeNegocio("La solicitud ya fue resuelta.");
  await notificar(
    db,
    [cambiadas[0].solicitanteId],
    `Repuesto rechazado: ${cambiadas[0].descripcion}${motivo.trim() ? ` (${motivo.trim()})` : ""}`,
    "/inicio",
  );
}

// ---------- Toma de inventario ----------

/** Abre un conteo físico de un almacén, con una línea por cada repuesto que el sistema registra ahí. */
export async function abrirToma(db: DB, actor: UsuarioSesion, almacenId: number): Promise<number> {
  exigirOperar(actor);
  return db.transaction(async (tx) => {
    const a = await exigirAlmacen(tx, almacenId);
    const [abierta] = await tx
      .select({ id: tomasInventario.id })
      .from(tomasInventario)
      .where(and(eq(tomasInventario.almacenId, almacenId), eq(tomasInventario.estado, "ABIERTA")));
    if (abierta) throw new ErrorDeNegocio(`Ya hay un inventario abierto en ${a.nombre}.`);
    const [t] = await tx.insert(tomasInventario).values({ almacenId, creadaPor: actor.id }).returning({ id: tomasInventario.id });
    const filas = await tx
      .select({ repuestoId: existencias.repuestoId, cantidad: existencias.cantidad })
      .from(existencias)
      .innerJoin(repuestos, eq(repuestos.id, existencias.repuestoId))
      .where(and(eq(existencias.almacenId, almacenId), eq(repuestos.activo, true)));
    if (filas.length) {
      await tx.insert(lineasToma).values(filas.map((f) => ({ tomaId: t.id, repuestoId: f.repuestoId, sistema: f.cantidad })));
    }
    return t.id;
  });
}

async function tomaAbierta(tx: Tx, tomaId: number) {
  const [t] = await tx.select().from(tomasInventario).where(eq(tomasInventario.id, tomaId)).for("update");
  if (!t) throw new ErrorDeNegocio("El inventario no existe.");
  if (t.estado !== "ABIERTA") throw new ErrorDeNegocio("El inventario ya está cerrado.");
  return t;
}

/** Registra lo contado de un repuesto. Vacío (null) borra el conteo. Sirve también para repuestos que no estaban en la lista. */
export async function contar(db: DB, actor: UsuarioSesion, tomaId: number, repuestoId: number, contada: number | null) {
  exigirOperar(actor);
  if (contada !== null && (!Number.isFinite(contada) || contada < 0 || r2(contada) !== contada)) {
    throw new ErrorDeNegocio("Lo contado debe ser cero o más, con hasta 2 decimales.");
  }
  await db.transaction(async (tx) => {
    const t = await tomaAbierta(tx, tomaId);
    const [r] = await tx.select({ id: repuestos.id }).from(repuestos).where(eq(repuestos.id, repuestoId));
    if (!r) throw new ErrorDeNegocio("El repuesto no existe en el catálogo.");
    await tx
      .insert(lineasToma)
      .values({ tomaId, repuestoId, sistema: await enAlmacen(tx, repuestoId, t.almacenId), contada })
      .onConflictDoUpdate({ target: [lineasToma.tomaId, lineasToma.repuestoId], set: { contada } });
  });
}

/**
 * Cierra el inventario: cada diferencia entre lo contado y lo que decía el sistema al abrir
 * se aplica como un ajuste. Lo que se movió durante el conteo se conserva. Las líneas sin contar no se tocan.
 */
export async function cerrarToma(db: DB, actor: UsuarioSesion, tomaId: number): Promise<{ contadas: number; ajustes: number }> {
  exigirOperar(actor);
  return db.transaction(async (tx) => {
    const t = await tomaAbierta(tx, tomaId);
    const lineas = await tx.select().from(lineasToma).where(eq(lineasToma.tomaId, tomaId));
    const contadas = lineas.filter((l) => l.contada !== null);
    if (contadas.length === 0) throw new ErrorDeNegocio("Todavía no se ha contado ningún repuesto.");
    let ajustes = 0;
    for (const l of contadas) {
      const delta = r2((l.contada as number) - l.sistema);
      if (delta === 0) continue;
      const { r, total } = await tomarRepuesto(tx, l.repuestoId);
      try {
        await variar(tx, r.id, t.almacenId, delta, r.unidad);
      } catch (e) {
        if (!(e instanceof ErrorDeNegocio)) throw e;
        throw new ErrorDeNegocio(
          `${r.codigo}: se entregó durante el conteo más de lo que quedaría según lo contado. Vuelve a contarlo.`,
        );
      }
      await tx.insert(movimientos).values({
        tipo: "AJUSTE",
        repuestoId: r.id,
        almacenId: t.almacenId,
        cantidad: delta,
        costoUnitario: r.costoMedio,
        usuarioId: actor.id,
        tomaId,
        nota: `Inventario N.º ${tomaId}`,
      });
      await avisarSiBajoMinimo(tx, r, total, r2(total + delta));
      ajustes++;
    }
    await tx.update(tomasInventario).set({ estado: "CERRADA", cerradaPor: actor.id, cerradaEn: new Date() }).where(eq(tomasInventario.id, tomaId));
    return { contadas: contadas.length, ajustes };
  });
}

export async function anularToma(db: DB, actor: UsuarioSesion, tomaId: number): Promise<void> {
  exigirOperar(actor);
  await db.transaction(async (tx) => {
    await tomaAbierta(tx, tomaId);
    await tx.update(tomasInventario).set({ estado: "ANULADA", cerradaPor: actor.id, cerradaEn: new Date() }).where(eq(tomasInventario.id, tomaId));
  });
}

// ---------- Carga desde Excel (catálogo y existencias iniciales) ----------

export const COLUMNAS_REPUESTOS: Columna[] = [
  { clave: "codigo", titulo: "Código interno", obligatoria: true, ejemplo: "ROD-6204" },
  { clave: "descripcion", titulo: "Descripción", obligatoria: true, ejemplo: "Rodamiento 6204 2RS" },
  { clave: "codigoFabricante", titulo: "Código de fabricante", ejemplo: "6204-2RSH" },
  { clave: "marca", titulo: "Marca", ejemplo: "SKF" },
  { clave: "unidad", titulo: "Unidad", ejemplo: "unidad" },
  { clave: "familia", titulo: "Familia", ejemplo: "Rodamientos" },
  { clave: "stockMinimo", titulo: "Stock mínimo", ejemplo: "4" },
  { clave: "stockMaximo", titulo: "Stock máximo", ejemplo: "12" },
  { clave: "costo", titulo: "Costo unitario ($)", ejemplo: "3500" },
  { clave: "almacen", titulo: "Almacén", ejemplo: "Bodega central" },
  { clave: "existencia", titulo: "Existencia", ejemplo: "10" },
  { clave: "ubicacion", titulo: "Ubicación", ejemplo: "Estante A-3" },
];

/**
 * Carga el catálogo y las existencias iniciales (migración desde Maintscape). Una fila por repuesto
 * y almacén: si un repuesto está en dos almacenes, se repite su código en dos filas.
 * Un repuesto que ya existe se actualiza. La existencia inicial solo se acepta si ese repuesto
 * todavía no tiene movimientos en ese almacén; después, las diferencias se corrigen con un ajuste.
 */
export async function importarRepuestos(db: DB, actor: UsuarioSesion, filas: Fila[]): Promise<number> {
  exigirOperar(actor);
  const lista = await db.select().from(almacenes).where(eq(almacenes.activo, true));
  return cargar(db, filas, COLUMNAS_REPUESTOS, async (tx, f) => {
    const num = (clave: string, titulo: string) => {
      const n = numero(f[clave]);
      if (Number.isNaN(n)) throw new ErrorDeNegocio(`"${titulo}" debe ser un número.`);
      return n;
    };
    const datos: DatosRepuesto = {
      codigo: f.codigo,
      descripcion: f.descripcion,
      codigoFabricante: f.codigoFabricante,
      marca: f.marca,
      unidad: f.unidad,
      familia: f.familia,
      stockMinimo: num("stockMinimo", "Stock mínimo"),
      stockMaximo: num("stockMaximo", "Stock máximo"),
    };
    const [existe] = await tx.select({ id: repuestos.id }).from(repuestos).where(eq(repuestos.codigo, f.codigo.trim().toUpperCase()));
    let id: number;
    if (existe) {
      id = existe.id;
      await actualizarRepuesto(tx, actor, id, datos);
    } else {
      id = await crearRepuesto(tx, actor, datos);
    }
    const existencia = num("existencia", "Existencia");
    const costo = num("costo", "Costo unitario ($)");
    const nombreAlmacen = f.almacen?.trim();
    if (!nombreAlmacen) {
      if (existencia) throw new ErrorDeNegocio("falta el almacén de la existencia.");
      return;
    }
    const almacen = lista.find((a) => normalizar(a.nombre) === normalizar(nombreAlmacen));
    if (!almacen) throw new ErrorDeNegocio(`no existe el almacén "${nombreAlmacen}".`);
    if (f.ubicacion?.trim()) await fijarUbicacion(tx, actor, id, almacen.id, f.ubicacion);
    if (!existencia) return;
    const [mov] = await tx
      .select({ id: movimientos.id })
      .from(movimientos)
      .where(
        and(
          eq(movimientos.repuestoId, id),
          sql`(${movimientos.almacenId} = ${almacen.id} or ${movimientos.almacenDestinoId} = ${almacen.id})`,
        ),
      )
      .limit(1);
    if (mov) {
      throw new ErrorDeNegocio(`${datos.codigo.trim().toUpperCase()} ya tiene movimientos en ${almacen.nombre}; su existencia se corrige con un ajuste.`);
    }
    await registrarEntrada(tx, actor, {
      repuestoId: id,
      almacenId: almacen.id,
      cantidad: existencia,
      costoUnitario: costo,
      documento: "Carga inicial",
    });
  });
}
