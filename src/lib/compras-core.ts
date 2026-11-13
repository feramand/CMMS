// Compras: proveedores, solicitudes de compra (SC), órdenes de compra (OC), autorizaciones y recepciones.
// Flujo: SC enviada → visada por el planificador o el jefe → abastecimiento emite una o más OC →
// cada OC la autorizan el jefe de mantenimiento y el gerente de producción (el gerente general
// puede firmar además, es opcional) → recibida en bodega (parcial o total).
import { randomBytes } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  almacenes,
  autorizacionesOc,
  centrosCosto,
  cuentasContables,
  lineasOc,
  lineasRecepcion,
  lineasSc,
  ordenesCompra,
  proveedores,
  recepciones,
  repuestos,
  solicitudesCompra,
  usuarios,
  type EstadoOc,
  type Moneda,
  type RolAutorizacion,
} from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import { operaBodega, r2, registrarEntrada } from "./bodega-core";
import { idsPorPerfil, notificar } from "./notificar";
import { normalizarRut } from "./rut";
import { ErrorDeNegocio } from "./usuarios-core";

export const MONEDAS: Record<Moneda, string> = {
  CLP: "Pesos (CLP)",
  UF: "UF",
  USD: "Dólares (USD)",
  EUR: "Euros (EUR)",
  CHF: "Francos suizos (CHF)",
};

export const ESTADOS_OC: Record<EstadoOc, string> = {
  EMITIDA: "Emitida, sin autorizar",
  AUTORIZADA: "Autorizada",
  RECIBIDA_PARCIAL: "Recibida parcial",
  RECIBIDA_TOTAL: "Recibida total",
  RECHAZADA: "Rechazada",
  ANULADA: "Anulada",
};

export const ROLES_AUTORIZACION: Record<RolAutorizacion, string> = {
  JEFE_MANTENIMIENTO: "Jefe de mantenimiento",
  GERENTE_PRODUCCION: "Gerente de producción",
  GERENTE_GENERAL: "Gerente general",
};
/** Las dos firmas sin las que una OC no queda autorizada. La del gerente general es opcional. */
export const ROLES_OBLIGATORIOS: RolAutorizacion[] = ["JEFE_MANTENIMIENTO", "GERENTE_PRODUCCION"];
const OC_VIGENTE: EstadoOc[] = ["EMITIDA", "AUTORIZADA", "RECIBIDA_PARCIAL", "RECIBIDA_TOTAL"];

export const IVA = 0.19;

/** Número visible de la OC y de la SC. */
export const folioOc = (id: number) => `OC-${String(id).padStart(5, "0")}`;
export const folioSc = (id: number) => `SC-${String(id).padStart(5, "0")}`;

export function gestionaCompras(actor: UsuarioSesion): boolean {
  return actor.perfil === "ABASTECIMIENTO" || actor.perfil === "ADMINISTRADOR";
}

export function puedePedirCompra(actor: UsuarioSesion): boolean {
  return actor.perfil !== "TECNICO" && actor.perfil !== "OPERADOR";
}

/** Visan las solicitudes de compra el planificador o el jefe (y el administrador). */
export function visaCompras(actor: UsuarioSesion): boolean {
  return actor.perfil === "JEFE_PLANIFICADOR" || actor.perfil === "ADMINISTRADOR";
}

function exigirGestion(actor: UsuarioSesion) {
  if (!gestionaCompras(actor)) throw new ErrorDeNegocio("Solo abastecimiento puede hacer esto.");
}

/** Neto, IVA y total de una OC en su moneda. Pesos sin decimales; el resto, con 2. Exenta: IVA 0. */
export function totales(lineas: { cantidad: number; precioUnitario: number }[], moneda: Moneda, exento = false) {
  const red = (n: number) => (moneda === "CLP" ? Math.round(n) : r2(n));
  const neto = red(lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0));
  const iva = exento ? 0 : red(neto * IVA);
  return { neto, iva, total: red(neto + iva) };
}

/** Cargos con los que puede firmar cada perfil. El primero es el que se asume si no se indica otro. */
export function cargosDe(perfil: UsuarioSesion["perfil"]): RolAutorizacion[] {
  if (perfil === "JEFE_PLANIFICADOR") return ["JEFE_MANTENIMIENTO"];
  if (perfil === "ADMINISTRADOR") return ["GERENTE_PRODUCCION", "GERENTE_GENERAL"];
  return [];
}

/** Cargo con el que una persona autoriza, o null si no tiene el permiso personal. */
export function rolDe(u: { perfil: UsuarioSesion["perfil"]; puedeAutorizarOc: boolean; cargoOc: RolAutorizacion | null }): RolAutorizacion | null {
  if (!u.puedeAutorizarOc) return null;
  const posibles = cargosDe(u.perfil);
  return u.cargoOc && posibles.includes(u.cargoOc) ? u.cargoOc : (posibles[0] ?? null);
}

// ---------- Catálogos contables ----------

type Catalogo = typeof cuentasContables | typeof centrosCosto;

async function guardarCatalogo(db: DB, actor: UsuarioSesion, tabla: Catalogo, que: string, d: { id?: number; codigo: string; nombre: string; activo?: boolean }) {
  exigirGestion(actor);
  const codigo = d.codigo.trim().toUpperCase();
  const nombre = d.nombre.trim();
  if (!codigo || !nombre) throw new ErrorDeNegocio(`Falta el código o el nombre de ${que}.`);
  const [otro] = await db
    .select({ id: tabla.id })
    .from(tabla)
    .where(d.id ? and(eq(tabla.codigo, codigo), ne(tabla.id, d.id)) : eq(tabla.codigo, codigo));
  if (otro) throw new ErrorDeNegocio(`Ya existe ${que} con el código ${codigo}.`);
  if (d.id) await db.update(tabla).set({ codigo, nombre, activo: d.activo ?? true }).where(eq(tabla.id, d.id));
  else await db.insert(tabla).values({ codigo, nombre });
}

export const guardarCuenta = (db: DB, actor: UsuarioSesion, d: { id?: number; codigo: string; nombre: string; activo?: boolean }) =>
  guardarCatalogo(db, actor, cuentasContables, "una cuenta contable", d);
export const guardarCentro = (db: DB, actor: UsuarioSesion, d: { id?: number; codigo: string; nombre: string; activo?: boolean }) =>
  guardarCatalogo(db, actor, centrosCosto, "un centro de costo", d);

/**
 * Cargo con el que una persona autoriza OC, o null para quitarle el permiso. Solo lo cambia el
 * administrador. Un jefe/planificador firma como jefe de mantenimiento; un administrador, como
 * gerente de producción o gerente general.
 */
export async function fijarAutorizador(db: DB, actor: UsuarioSesion, usuarioId: number, cargo: RolAutorizacion | null): Promise<void> {
  if (actor.perfil !== "ADMINISTRADOR") throw new ErrorDeNegocio("Solo el administrador define quién autoriza órdenes de compra.");
  const [u] = await db.select().from(usuarios).where(eq(usuarios.id, usuarioId));
  if (!u || cargosDe(u.perfil).length === 0) throw new ErrorDeNegocio("Solo un jefe o un administrador pueden autorizar órdenes de compra.");
  if (cargo && !cargosDe(u.perfil).includes(cargo)) {
    throw new ErrorDeNegocio(`${u.nombre} no puede firmar como ${ROLES_AUTORIZACION[cargo].toLowerCase()} con su perfil.`);
  }
  await db.update(usuarios).set({ puedeAutorizarOc: cargo !== null, cargoOc: cargo }).where(eq(usuarios.id, usuarioId));
}

// ---------- Proveedores ----------

export type DatosProveedor = {
  rut?: string | null;
  nombre: string;
  giro?: string | null;
  contacto?: string | null;
  email?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  condicionPago?: string | null;
  esTecnico?: boolean;
  activo?: boolean;
};

export async function guardarProveedor(db: DB, actor: UsuarioSesion, d: DatosProveedor, id?: number): Promise<number> {
  exigirGestion(actor);
  const nombre = d.nombre.trim();
  if (!nombre) throw new ErrorDeNegocio("Falta el nombre o razón social del proveedor.");
  let rut: string | null = null;
  if (d.rut?.trim()) {
    const normal = normalizarRut(d.rut);
    if (!normal) throw new ErrorDeNegocio("El RUT del proveedor no es válido.");
    rut = normal;
    const [otro] = await db
      .select({ id: proveedores.id })
      .from(proveedores)
      .where(id ? and(eq(proveedores.rut, normal), ne(proveedores.id, id)) : eq(proveedores.rut, normal));
    if (otro) throw new ErrorDeNegocio("Ya existe un proveedor con ese RUT.");
  }
  const l = (v?: string | null) => v?.trim() || null;
  const valores = {
    rut,
    nombre,
    giro: l(d.giro),
    contacto: l(d.contacto),
    email: l(d.email),
    telefono: l(d.telefono),
    direccion: l(d.direccion),
    condicionPago: l(d.condicionPago),
    esTecnico: d.esTecnico ?? false,
    activo: d.activo ?? true,
  };
  if (id) {
    await db.update(proveedores).set(valores).where(eq(proveedores.id, id));
    return id;
  }
  const [nuevo] = await db.insert(proveedores).values(valores).returning({ id: proveedores.id });
  return nuevo.id;
}

// ---------- Solicitud de compra ----------

export type LineaPedida = { repuestoId?: number | null; descripcion?: string | null; cantidad: number };

async function limpiarLineas(tx: DB, lineas: LineaPedida[]) {
  if (lineas.length === 0) throw new ErrorDeNegocio("Agrega al menos una línea.");
  const limpias = [];
  for (const [i, l] of lineas.entries()) {
    if (!Number.isFinite(l.cantidad) || l.cantidad <= 0 || r2(l.cantidad) !== l.cantidad) {
      throw new ErrorDeNegocio(`Línea ${i + 1}: la cantidad debe ser mayor que cero, con hasta 2 decimales.`);
    }
    let descripcion = l.descripcion?.trim() ?? "";
    if (l.repuestoId) {
      const [r] = await tx.select().from(repuestos).where(eq(repuestos.id, l.repuestoId));
      if (!r) throw new ErrorDeNegocio(`Línea ${i + 1}: el repuesto no existe en el catálogo.`);
      descripcion = `${r.codigo} · ${r.descripcion}`;
    }
    if (!descripcion) throw new ErrorDeNegocio(`Línea ${i + 1}: falta la descripción.`);
    limpias.push({ repuestoId: l.repuestoId ?? null, descripcion, cantidad: l.cantidad });
  }
  return limpias;
}

async function exigirCatalogo(tx: DB, tabla: Catalogo, id: number | null | undefined, que: string): Promise<number | null> {
  if (!id) return null;
  const [c] = await tx.select({ id: tabla.id, activo: tabla.activo }).from(tabla).where(eq(tabla.id, id));
  if (!c || !c.activo) throw new ErrorDeNegocio(`Elige ${que} vigente.`);
  return c.id;
}

/**
 * Crea una SC. La visa el planificador o el jefe; si la crea uno de ellos (o el administrador),
 * nace visada y pasa directo a abastecimiento. Cuenta contable y centro de costo son opcionales aquí.
 */
export async function crearSc(
  db: DB,
  actor: UsuarioSesion,
  d: { lineas: LineaPedida[]; centroCostoId?: number | null; cuentaId?: number | null; nota?: string | null },
): Promise<number> {
  if (!puedePedirCompra(actor)) throw new ErrorDeNegocio("Tu perfil no puede crear solicitudes de compra.");
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const lineas = await limpiarLineas(t, d.lineas);
    const visada = visaCompras(actor);
    const [sc] = await tx
      .insert(solicitudesCompra)
      .values({
        solicitanteId: actor.id,
        centroCostoId: await exigirCatalogo(t, centrosCosto, d.centroCostoId, "un centro de costo"),
        cuentaId: await exigirCatalogo(t, cuentasContables, d.cuentaId, "una cuenta contable"),
        nota: d.nota?.trim() || null,
        ...(visada ? { estado: "APROBADA" as const, resueltaPor: actor.id, resueltaEn: new Date() } : {}),
      })
      .returning({ id: solicitudesCompra.id });
    await tx.insert(lineasSc).values(lineas.map((l) => ({ ...l, scId: sc.id })));
    if (visada) {
      await notificar(tx, await idsPorPerfil(tx, "ABASTECIMIENTO"), `Solicitud de compra ${folioSc(sc.id)} visada: lista para cotizar`, `/compras/sc/${sc.id}`);
    } else {
      await notificar(tx, await idsPorPerfil(tx, "JEFE_PLANIFICADOR"), `Solicitud de compra ${folioSc(sc.id)} de ${actor.nombre} por visar`, `/compras/sc/${sc.id}`);
    }
    return sc.id;
  });
}

/** El planificador o el jefe visa (o rechaza) una SC. Visada, queda liberada para abastecimiento. */
export async function resolverSc(db: DB, actor: UsuarioSesion, id: number, aprobar: boolean, motivo?: string): Promise<void> {
  if (!visaCompras(actor)) throw new ErrorDeNegocio("Las solicitudes de compra las visa el planificador o el jefe.");
  if (!aprobar && !motivo?.trim()) throw new ErrorDeNegocio("Indica el motivo del rechazo.");
  const cambiadas = await db
    .update(solicitudesCompra)
    .set({ estado: aprobar ? "APROBADA" : "RECHAZADA", motivoRechazo: aprobar ? null : motivo!.trim(), resueltaPor: actor.id, resueltaEn: new Date() })
    .where(and(eq(solicitudesCompra.id, id), eq(solicitudesCompra.estado, "ENVIADA")))
    .returning({ solicitanteId: solicitudesCompra.solicitanteId });
  if (cambiadas.length === 0) throw new ErrorDeNegocio("La solicitud de compra ya fue resuelta.");
  await notificar(
    db,
    [cambiadas[0].solicitanteId],
    `Solicitud de compra ${folioSc(id)} ${aprobar ? "visada" : `rechazada: ${motivo!.trim()}`}`,
    `/compras/sc/${id}`,
  );
  if (aprobar) {
    await notificar(db, await idsPorPerfil(db, "ABASTECIMIENTO"), `Solicitud de compra ${folioSc(id)} visada: lista para cotizar`, `/compras/sc/${id}`);
  }
}

/** Ids de las líneas de una SC que ya están en una orden de compra vigente (no rechazada ni anulada). */
export async function lineasConOc(db: DB, scId: number): Promise<Map<number, number>> {
  const filas = await db
    .select({ lineaScId: lineasOc.lineaScId, ocId: lineasOc.ocId })
    .from(lineasOc)
    .innerJoin(ordenesCompra, eq(ordenesCompra.id, lineasOc.ocId))
    .where(and(eq(ordenesCompra.scId, scId), inArray(ordenesCompra.estado, OC_VIGENTE)));
  return new Map(filas.flatMap((f) => (f.lineaScId ? [[f.lineaScId, f.ocId] as [number, number]] : [])));
}

/** La SC queda convertida cuando todas sus líneas tienen orden de compra; si no, sigue visada con líneas pendientes. */
async function ajustarEstadoSc(tx: DB, scId: number) {
  const [sc] = await tx.select().from(solicitudesCompra).where(eq(solicitudesCompra.id, scId));
  if (!sc || (sc.estado !== "APROBADA" && sc.estado !== "CONVERTIDA") || sc.cerradaEn) return;
  const todas = await tx.select({ id: lineasSc.id }).from(lineasSc).where(eq(lineasSc.scId, scId));
  const cubiertas = await lineasConOc(tx, scId);
  const estado = todas.every((l) => cubiertas.has(l.id)) ? "CONVERTIDA" : "APROBADA";
  if (estado !== sc.estado) await tx.update(solicitudesCompra).set({ estado }).where(eq(solicitudesCompra.id, scId));
}

/** Abastecimiento cierra una SC visada cuyas líneas pendientes ya no se van a comprar. */
export async function cerrarSc(db: DB, actor: UsuarioSesion, id: number): Promise<void> {
  exigirGestion(actor);
  const cambiadas = await db
    .update(solicitudesCompra)
    .set({ estado: "CONVERTIDA", cerradaEn: new Date() })
    .where(and(eq(solicitudesCompra.id, id), eq(solicitudesCompra.estado, "APROBADA")))
    .returning({ id: solicitudesCompra.id });
  if (cambiadas.length === 0) throw new ErrorDeNegocio("Solo se cierra una solicitud visada con líneas pendientes.");
}

/**
 * Propuesta de compra: repuestos vigentes bajo su stock mínimo. Sugiere comprar hasta el máximo
 * (o hasta el mínimo, si no hay máximo), descontando lo que ya viene en camino.
 */
export async function propuestaDeCompra(db: DB) {
  const filas = await db
    .select({
      id: repuestos.id,
      codigo: repuestos.codigo,
      descripcion: repuestos.descripcion,
      unidad: repuestos.unidad,
      stockMinimo: repuestos.stockMinimo,
      stockMaximo: repuestos.stockMaximo,
      total: sql<number>`coalesce((select sum(e.cantidad) from existencias e where e.repuesto_id = repuestos.id), 0)`.mapWith(Number),
      // Pendiente de recibir en órdenes de compra vigentes.
      enOc: sql<number>`coalesce((select sum(l.cantidad - l.recibida) from lineas_oc l join ordenes_compra o on o.id = l.oc_id where l.repuesto_id = repuestos.id and o.estado in ('EMITIDA','AUTORIZADA','RECIBIDA_PARCIAL')), 0)`.mapWith(Number),
      // Pedido en solicitudes de compra que todavía no son una orden.
      enSc: sql<number>`coalesce((select sum(l.cantidad) from lineas_sc l join solicitudes_compra s on s.id = l.sc_id where l.repuesto_id = repuestos.id and s.estado in ('ENVIADA','APROBADA') and not exists (select 1 from lineas_oc lo join ordenes_compra o on o.id = lo.oc_id where lo.linea_sc_id = l.id and o.estado in ('EMITIDA','AUTORIZADA','RECIBIDA_PARCIAL','RECIBIDA_TOTAL'))), 0)`.mapWith(Number),
    })
    .from(repuestos)
    .where(and(eq(repuestos.activo, true), sql`${repuestos.stockMinimo} > 0`))
    .orderBy(repuestos.codigo);
  return filas
    .filter((f) => f.total < f.stockMinimo)
    .map((f) => {
      const enCamino = r2(f.enOc + f.enSc);
      return { ...f, enCamino, sugerida: Math.max(0, r2((f.stockMaximo ?? f.stockMinimo) - f.total - enCamino)) };
    });
}

// ---------- Orden de compra ----------

export type DatosOc = {
  scId: number;
  proveedorId: number;
  moneda: Moneda;
  /** Obligatorios en la OC. Si no se indican, se toman de la SC. */
  cuentaId?: number | null;
  centroCostoId?: number | null;
  ivaExento?: boolean;
  cotizacionRef?: string | null;
  referencia?: string | null;
  fechaEntrega?: string | null;
  condicionPago?: string | null;
  nota?: string | null;
  /** Precio neto unitario de cada línea de la SC, por id de línea. Las líneas sin precio quedan para otra OC. */
  precios: Record<number, number | null>;
};

/**
 * Emite una OC con las líneas de una SC visada que traen precio. Una SC puede repartirse en varias
 * OC (distintos proveedores); queda convertida cuando todas sus líneas tienen orden.
 */
export async function emitirOc(db: DB, actor: UsuarioSesion, d: DatosOc): Promise<number> {
  exigirGestion(actor);
  if (!(d.moneda in MONEDAS)) throw new ErrorDeNegocio("Elige la moneda.");
  if (d.fechaEntrega && !/^\d{4}-\d{2}-\d{2}$/.test(d.fechaEntrega)) throw new ErrorDeNegocio("La fecha de entrega no es válida.");
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [sc] = await tx.select().from(solicitudesCompra).where(eq(solicitudesCompra.id, d.scId)).for("update");
    if (!sc) throw new ErrorDeNegocio("La solicitud de compra no existe.");
    if (sc.estado !== "APROBADA") throw new ErrorDeNegocio("Solo se emite una orden de compra desde una solicitud visada con líneas pendientes.");
    const [prov] = await tx.select().from(proveedores).where(eq(proveedores.id, d.proveedorId));
    if (!prov || !prov.activo) throw new ErrorDeNegocio("Elige un proveedor vigente.");
    const cuentaId = await exigirCatalogo(t, cuentasContables, d.cuentaId ?? sc.cuentaId, "una cuenta contable");
    const centroCostoId = await exigirCatalogo(t, centrosCosto, d.centroCostoId ?? sc.centroCostoId, "un centro de costo");
    if (!cuentaId) throw new ErrorDeNegocio("La orden de compra necesita una cuenta contable.");
    if (!centroCostoId) throw new ErrorDeNegocio("La orden de compra necesita un centro de costo.");
    const pedidas = await tx.select().from(lineasSc).where(eq(lineasSc.scId, sc.id)).orderBy(lineasSc.id);
    const cubiertas = await lineasConOc(t, sc.id);
    const lineas = [];
    for (const l of pedidas) {
      const precio = d.precios[l.id];
      if (precio === null || precio === undefined) continue;
      if (cubiertas.has(l.id)) throw new ErrorDeNegocio(`${l.descripcion}: ya está en la orden de compra ${folioOc(cubiertas.get(l.id)!)}.`);
      if (!Number.isFinite(precio) || precio <= 0) throw new ErrorDeNegocio(`${l.descripcion}: el precio debe ser mayor que cero.`);
      lineas.push({ lineaScId: l.id, repuestoId: l.repuestoId, descripcion: l.descripcion, cantidad: l.cantidad, precioUnitario: Math.round(precio * 10000) / 10000 });
    }
    if (lineas.length === 0) throw new ErrorDeNegocio("Escribe el precio de al menos una línea.");
    const [oc] = await tx
      .insert(ordenesCompra)
      .values({
        scId: sc.id,
        proveedorId: prov.id,
        moneda: d.moneda,
        centroCostoId,
        cuentaId,
        ivaExento: d.ivaExento ?? false,
        cotizacionRef: d.cotizacionRef?.trim() || null,
        referencia: d.referencia?.trim() || null,
        fechaEntrega: d.fechaEntrega || null,
        condicionPago: d.condicionPago?.trim() || prov.condicionPago,
        nota: d.nota?.trim() || null,
        emitidaPor: actor.id,
      })
      .returning({ id: ordenesCompra.id });
    await tx.insert(lineasOc).values(lineas.map((l) => ({ ...l, ocId: oc.id })));
    await ajustarEstadoSc(t, sc.id);
    const autorizan = await tx
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(and(eq(usuarios.puedeAutorizarOc, true), eq(usuarios.activo, true), inArray(usuarios.perfil, ["JEFE_PLANIFICADOR", "ADMINISTRADOR"])));
    await notificar(tx, autorizan.map((u) => u.id), `Orden de compra ${folioOc(oc.id)} por autorizar: ${prov.nombre}`, `/compras/oc/${oc.id}`);
    return oc.id;
  });
}

/** Abastecimiento corrige la cuenta contable o el centro de costo de una OC que aún no se recibe. */
export async function cambiarImputacionOc(db: DB, actor: UsuarioSesion, id: number, d: { cuentaId: number; centroCostoId: number }): Promise<void> {
  exigirGestion(actor);
  await db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const oc = await ocParaCambiar(tx, id);
    if (oc.estado !== "EMITIDA" && oc.estado !== "AUTORIZADA") throw new ErrorDeNegocio("Ya no se puede cambiar la imputación de esta orden.");
    const cuentaId = oc.cuentaId === d.cuentaId ? d.cuentaId : await exigirCatalogo(t, cuentasContables, d.cuentaId, "una cuenta contable");
    const centroCostoId = oc.centroCostoId === d.centroCostoId ? d.centroCostoId : await exigirCatalogo(t, centrosCosto, d.centroCostoId, "un centro de costo");
    if (!cuentaId || !centroCostoId) throw new ErrorDeNegocio("La orden de compra necesita cuenta contable y centro de costo.");
    await tx.update(ordenesCompra).set({ cuentaId, centroCostoId }).where(eq(ordenesCompra.id, id));
  });
}

async function ocParaCambiar(tx: Parameters<Parameters<DB["transaction"]>[0]>[0], id: number) {
  const [oc] = await tx.select().from(ordenesCompra).where(eq(ordenesCompra.id, id)).for("update");
  if (!oc) throw new ErrorDeNegocio("La orden de compra no existe.");
  return oc;
}

async function exigirAutorizador(db: DB, actor: UsuarioSesion): Promise<RolAutorizacion> {
  const [u] = await db.select().from(usuarios).where(eq(usuarios.id, actor.id));
  const rol = u?.activo ? rolDe(u) : null;
  if (!rol) throw new ErrorDeNegocio("No tienes permiso para autorizar órdenes de compra.");
  return rol;
}

/**
 * Autoriza una OC. Son obligatorias dos firmas: jefe de mantenimiento y gerente de producción; al
 * completarse, la OC queda autorizada y recibe su código de verificación. La firma del gerente
 * general es opcional: puede darla antes o después, y no cambia el estado.
 */
export async function autorizarOc(db: DB, actor: UsuarioSesion, id: number): Promise<{ completa: boolean }> {
  const rol = await exigirAutorizador(db, actor);
  return db.transaction(async (tx) => {
    const oc = await ocParaCambiar(tx, id);
    const opcional = !ROLES_OBLIGATORIOS.includes(rol);
    if (oc.estado !== "EMITIDA" && !(opcional && OC_VIGENTE.includes(oc.estado))) {
      throw new ErrorDeNegocio("La orden de compra ya no está pendiente de autorización.");
    }
    const previas = await tx.select().from(autorizacionesOc).where(eq(autorizacionesOc.ocId, id));
    if (previas.some((a) => a.rol === rol)) {
      throw new ErrorDeNegocio(`Ya está la autorización de ${ROLES_AUTORIZACION[rol].toLowerCase()}.`);
    }
    if (previas.some((a) => a.usuarioId === actor.id)) throw new ErrorDeNegocio("Ya firmaste esta orden con otro cargo.");
    await tx.insert(autorizacionesOc).values({ ocId: id, rol, usuarioId: actor.id, nombre: actor.nombre });
    const roles = [...previas.map((a) => a.rol), rol];
    const completa = oc.estado === "EMITIDA" && ROLES_OBLIGATORIOS.every((r) => roles.includes(r));
    if (completa) {
      const codigo = randomBytes(6).toString("hex").toUpperCase();
      await tx.update(ordenesCompra).set({ estado: "AUTORIZADA", codigoVerificacion: codigo }).where(eq(ordenesCompra.id, id));
      await notificar(
        tx,
        [oc.emitidaPor, ...(await idsPorPerfil(tx, "ABASTECIMIENTO", "BODEGUERO"))],
        `Orden de compra ${folioOc(id)} autorizada`,
        `/compras/oc/${id}`,
      );
    }
    return { completa };
  });
}

/** Un autorizador rechaza la OC. Sus líneas vuelven a quedar pendientes en la SC, para emitir otra orden. */
export async function rechazarOc(db: DB, actor: UsuarioSesion, id: number, motivo: string): Promise<void> {
  await exigirAutorizador(db, actor);
  if (!motivo.trim()) throw new ErrorDeNegocio("Indica el motivo del rechazo.");
  await db.transaction(async (tx) => {
    const oc = await ocParaCambiar(tx, id);
    if (oc.estado !== "EMITIDA") throw new ErrorDeNegocio("La orden de compra ya no está pendiente de autorización.");
    await tx.update(ordenesCompra).set({ estado: "RECHAZADA", motivo: `${actor.nombre}: ${motivo.trim()}` }).where(eq(ordenesCompra.id, id));
    await ajustarEstadoSc(tx as unknown as DB, oc.scId);
    await notificar(tx, [oc.emitidaPor], `Orden de compra ${folioOc(id)} rechazada: ${motivo.trim()}`, `/compras/oc/${id}`);
  });
}

/** Abastecimiento anula una OC que todavía no tiene recepciones. */
export async function anularOc(db: DB, actor: UsuarioSesion, id: number, motivo: string): Promise<void> {
  exigirGestion(actor);
  if (!motivo.trim()) throw new ErrorDeNegocio("Indica el motivo de la anulación.");
  await db.transaction(async (tx) => {
    const oc = await ocParaCambiar(tx, id);
    if (oc.estado !== "EMITIDA" && oc.estado !== "AUTORIZADA") {
      throw new ErrorDeNegocio("Solo se anula una orden de compra sin recepciones.");
    }
    await tx.update(ordenesCompra).set({ estado: "ANULADA", motivo: `${actor.nombre}: ${motivo.trim()}` }).where(eq(ordenesCompra.id, id));
    await ajustarEstadoSc(tx as unknown as DB, oc.scId);
  });
}

export type DatosRecepcion = {
  ocId: number;
  almacenId: number;
  /** Pesos por unidad de la moneda de la OC. No se usa si la OC es en pesos. */
  tipoCambio?: number | null;
  documento?: string | null;
  /** Cantidad recibida por id de línea de la OC. */
  cantidades: Record<number, number | null>;
};

/**
 * Recepción contra una OC autorizada. Cada línea de catálogo genera una entrada a bodega, valorizada
 * en pesos (precio × tipo de cambio), que actualiza el costo medio. No se recibe más de lo pedido.
 */
export async function recibirOc(db: DB, actor: UsuarioSesion, d: DatosRecepcion): Promise<number> {
  if (!operaBodega(actor)) throw new ErrorDeNegocio("Solo bodega recibe mercadería.");
  return db.transaction(async (tx) => {
    const oc = await ocParaCambiar(tx, d.ocId);
    if (oc.estado === "EMITIDA") throw new ErrorDeNegocio("La orden de compra no está autorizada: no admite recepciones.");
    if (oc.estado !== "AUTORIZADA" && oc.estado !== "RECIBIDA_PARCIAL") throw new ErrorDeNegocio("Esta orden de compra no admite recepciones.");
    const [almacen] = await tx.select().from(almacenes).where(eq(almacenes.id, d.almacenId));
    if (!almacen || !almacen.activo) throw new ErrorDeNegocio("Elige el almacén que recibe.");
    let tipoCambio = 1;
    if (oc.moneda !== "CLP") {
      if (!d.tipoCambio || !Number.isFinite(d.tipoCambio) || d.tipoCambio <= 0) {
        throw new ErrorDeNegocio(`Escribe el tipo de cambio: cuántos pesos vale 1 ${oc.moneda}.`);
      }
      tipoCambio = Math.round(d.tipoCambio * 10000) / 10000;
    }
    const lineas = await tx.select().from(lineasOc).where(eq(lineasOc.ocId, oc.id)).orderBy(lineasOc.id);
    const recibidas = [];
    for (const l of lineas) {
      const n = d.cantidades[l.id];
      if (n === null || n === undefined || n === 0) continue;
      if (!Number.isFinite(n) || n < 0 || r2(n) !== n) throw new ErrorDeNegocio(`${l.descripcion}: la cantidad recibida no es válida.`);
      const pendiente = r2(l.cantidad - l.recibida);
      if (n > pendiente) throw new ErrorDeNegocio(`${l.descripcion}: solo quedan ${pendiente} por recibir.`);
      recibidas.push({ linea: l, cantidad: n });
    }
    if (recibidas.length === 0) throw new ErrorDeNegocio("Escribe la cantidad recibida de al menos una línea.");
    const [rec] = await tx
      .insert(recepciones)
      .values({ ocId: oc.id, almacenId: almacen.id, tipoCambio, documento: d.documento?.trim() || null, usuarioId: actor.id })
      .returning({ id: recepciones.id });
    for (const { linea, cantidad } of recibidas) {
      const movimientoId = linea.repuestoId
        ? await registrarEntrada(tx as unknown as DB, actor, {
            repuestoId: linea.repuestoId,
            almacenId: almacen.id,
            cantidad,
            costoUnitario: r2(linea.precioUnitario * tipoCambio),
            documento: [folioOc(oc.id), d.documento?.trim()].filter(Boolean).join(" · "),
          })
        : null;
      await tx.insert(lineasRecepcion).values({ recepcionId: rec.id, lineaOcId: linea.id, cantidad, movimientoId });
      await tx.update(lineasOc).set({ recibida: r2(linea.recibida + cantidad) }).where(eq(lineasOc.id, linea.id));
    }
    const despues = await tx.select().from(lineasOc).where(eq(lineasOc.ocId, oc.id));
    const total = despues.every((l) => l.recibida >= l.cantidad);
    await tx.update(ordenesCompra).set({ estado: total ? "RECIBIDA_TOTAL" : "RECIBIDA_PARCIAL" }).where(eq(ordenesCompra.id, oc.id));
    const [sc] = await tx.select({ solicitanteId: solicitudesCompra.solicitanteId }).from(solicitudesCompra).where(eq(solicitudesCompra.id, oc.scId));
    await notificar(
      tx,
      [oc.emitidaPor, sc.solicitanteId].filter((u) => u !== actor.id),
      `Orden de compra ${folioOc(oc.id)}: recepción ${total ? "total" : "parcial"} en ${almacen.nombre}`,
      `/compras/oc/${oc.id}`,
    );
    return rec.id;
  });
}
