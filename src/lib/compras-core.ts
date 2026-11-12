// Compras: proveedores, solicitudes de compra (SC), órdenes de compra (OC), autorizaciones y recepciones.
// Flujo: SC enviada → aprobada por abastecimiento → OC emitida → autorizada por el jefe de
// mantenimiento y el gerente de producción → recibida en bodega (parcial o total).
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
};

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

function exigirGestion(actor: UsuarioSesion) {
  if (!gestionaCompras(actor)) throw new ErrorDeNegocio("Solo abastecimiento puede hacer esto.");
}

/** Neto, IVA y total de una OC en su moneda. Pesos sin decimales; el resto, con 2. */
export function totales(lineas: { cantidad: number; precioUnitario: number }[], moneda: Moneda) {
  const red = (n: number) => (moneda === "CLP" ? Math.round(n) : r2(n));
  const neto = red(lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0));
  const iva = red(neto * IVA);
  return { neto, iva, total: red(neto + iva) };
}

/** Rol con el que una persona autoriza: lo da su perfil, y además necesita el permiso personal. */
export function rolDe(perfil: UsuarioSesion["perfil"]): RolAutorizacion | null {
  if (perfil === "JEFE_PLANIFICADOR") return "JEFE_MANTENIMIENTO";
  if (perfil === "ADMINISTRADOR") return "GERENTE_PRODUCCION";
  return null;
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

/** Permiso personal para autorizar OC. Solo lo cambia el administrador y solo aplica a jefe/planificador y administrador. */
export async function fijarAutorizador(db: DB, actor: UsuarioSesion, usuarioId: number, puede: boolean): Promise<void> {
  if (actor.perfil !== "ADMINISTRADOR") throw new ErrorDeNegocio("Solo el administrador define quién autoriza órdenes de compra.");
  const [u] = await db.select().from(usuarios).where(eq(usuarios.id, usuarioId));
  if (!u || !rolDe(u.perfil)) throw new ErrorDeNegocio("Solo un jefe o un administrador pueden autorizar órdenes de compra.");
  await db.update(usuarios).set({ puedeAutorizarOc: puede }).where(eq(usuarios.id, usuarioId));
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

/** Crea una SC. Si la crea abastecimiento queda aprobada de inmediato: es quien aprueba. */
export async function crearSc(
  db: DB,
  actor: UsuarioSesion,
  d: { lineas: LineaPedida[]; centroCostoId?: number | null; nota?: string | null },
): Promise<number> {
  if (!puedePedirCompra(actor)) throw new ErrorDeNegocio("Tu perfil no puede crear solicitudes de compra.");
  return db.transaction(async (tx) => {
    const lineas = await limpiarLineas(tx as unknown as DB, d.lineas);
    const aprueba = gestionaCompras(actor);
    const [sc] = await tx
      .insert(solicitudesCompra)
      .values({
        solicitanteId: actor.id,
        centroCostoId: d.centroCostoId || null,
        nota: d.nota?.trim() || null,
        ...(aprueba ? { estado: "APROBADA" as const, resueltaPor: actor.id, resueltaEn: new Date() } : {}),
      })
      .returning({ id: solicitudesCompra.id });
    await tx.insert(lineasSc).values(lineas.map((l) => ({ ...l, scId: sc.id })));
    if (!aprueba) {
      await notificar(tx, await idsPorPerfil(tx, "ABASTECIMIENTO"), `Nueva solicitud de compra ${folioSc(sc.id)} de ${actor.nombre}`, `/compras/sc/${sc.id}`);
    }
    return sc.id;
  });
}

export async function resolverSc(db: DB, actor: UsuarioSesion, id: number, aprobar: boolean, motivo?: string): Promise<void> {
  exigirGestion(actor);
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
    `Solicitud de compra ${folioSc(id)} ${aprobar ? "aprobada" : `rechazada: ${motivo!.trim()}`}`,
    `/compras/sc/${id}`,
  );
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
      enSc: sql<number>`coalesce((select sum(l.cantidad) from lineas_sc l join solicitudes_compra s on s.id = l.sc_id where l.repuesto_id = repuestos.id and s.estado in ('ENVIADA','APROBADA')), 0)`.mapWith(Number),
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
  fechaEntrega?: string | null;
  condicionPago?: string | null;
  nota?: string | null;
  /** Precio neto unitario de cada línea de la SC, por id de línea. Las líneas sin precio no se compran. */
  precios: Record<number, number | null>;
};

/** Emite la OC de una SC aprobada. La SC queda convertida. */
export async function emitirOc(db: DB, actor: UsuarioSesion, d: DatosOc): Promise<number> {
  exigirGestion(actor);
  if (!(d.moneda in MONEDAS)) throw new ErrorDeNegocio("Elige la moneda.");
  if (d.fechaEntrega && !/^\d{4}-\d{2}-\d{2}$/.test(d.fechaEntrega)) throw new ErrorDeNegocio("La fecha de entrega no es válida.");
  return db.transaction(async (tx) => {
    const [sc] = await tx.select().from(solicitudesCompra).where(eq(solicitudesCompra.id, d.scId)).for("update");
    if (!sc) throw new ErrorDeNegocio("La solicitud de compra no existe.");
    if (sc.estado !== "APROBADA") throw new ErrorDeNegocio("Solo se emite una orden de compra desde una solicitud aprobada.");
    const [prov] = await tx.select().from(proveedores).where(eq(proveedores.id, d.proveedorId));
    if (!prov || !prov.activo) throw new ErrorDeNegocio("Elige un proveedor vigente.");
    const pedidas = await tx.select().from(lineasSc).where(eq(lineasSc.scId, sc.id)).orderBy(lineasSc.id);
    const lineas = [];
    for (const l of pedidas) {
      const precio = d.precios[l.id];
      if (precio === null || precio === undefined) continue;
      if (!Number.isFinite(precio) || precio <= 0) throw new ErrorDeNegocio(`${l.descripcion}: el precio debe ser mayor que cero.`);
      lineas.push({ repuestoId: l.repuestoId, descripcion: l.descripcion, cantidad: l.cantidad, precioUnitario: Math.round(precio * 10000) / 10000 });
    }
    if (lineas.length === 0) throw new ErrorDeNegocio("Escribe el precio de al menos una línea.");
    const [oc] = await tx
      .insert(ordenesCompra)
      .values({
        scId: sc.id,
        proveedorId: prov.id,
        moneda: d.moneda,
        centroCostoId: sc.centroCostoId,
        fechaEntrega: d.fechaEntrega || null,
        condicionPago: d.condicionPago?.trim() || prov.condicionPago,
        nota: d.nota?.trim() || null,
        emitidaPor: actor.id,
      })
      .returning({ id: ordenesCompra.id });
    await tx.insert(lineasOc).values(lineas.map((l) => ({ ...l, ocId: oc.id })));
    await tx.update(solicitudesCompra).set({ estado: "CONVERTIDA" }).where(eq(solicitudesCompra.id, sc.id));
    const autorizan = await tx
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(and(eq(usuarios.puedeAutorizarOc, true), eq(usuarios.activo, true), inArray(usuarios.perfil, ["JEFE_PLANIFICADOR", "ADMINISTRADOR"])));
    await notificar(tx, autorizan.map((u) => u.id), `Orden de compra ${folioOc(oc.id)} por autorizar: ${prov.nombre}`, `/compras/oc/${oc.id}`);
    return oc.id;
  });
}

async function ocParaCambiar(tx: Parameters<Parameters<DB["transaction"]>[0]>[0], id: number) {
  const [oc] = await tx.select().from(ordenesCompra).where(eq(ordenesCompra.id, id)).for("update");
  if (!oc) throw new ErrorDeNegocio("La orden de compra no existe.");
  return oc;
}

async function exigirAutorizador(db: DB, actor: UsuarioSesion): Promise<RolAutorizacion> {
  const [u] = await db.select().from(usuarios).where(eq(usuarios.id, actor.id));
  const rol = rolDe(actor.perfil);
  if (!u?.puedeAutorizarOc || !u.activo || !rol) throw new ErrorDeNegocio("No tienes permiso para autorizar órdenes de compra.");
  return rol;
}

/**
 * Autoriza una OC. Hacen falta dos autorizaciones: la del jefe de mantenimiento y la del gerente
 * de producción. Con la segunda, la OC queda autorizada y recibe su código de verificación.
 */
export async function autorizarOc(db: DB, actor: UsuarioSesion, id: number): Promise<{ completa: boolean }> {
  const rol = await exigirAutorizador(db, actor);
  return db.transaction(async (tx) => {
    const oc = await ocParaCambiar(tx, id);
    if (oc.estado !== "EMITIDA") throw new ErrorDeNegocio("La orden de compra ya no está pendiente de autorización.");
    const previas = await tx.select().from(autorizacionesOc).where(eq(autorizacionesOc.ocId, id));
    if (previas.some((a) => a.rol === rol)) {
      throw new ErrorDeNegocio(`Ya está la autorización de ${ROLES_AUTORIZACION[rol].toLowerCase()}. Falta la otra.`);
    }
    await tx.insert(autorizacionesOc).values({ ocId: id, rol, usuarioId: actor.id, nombre: actor.nombre });
    const completa = previas.length === 1;
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

/** Un autorizador rechaza la OC. Queda cerrada; abastecimiento puede emitir otra desde una nueva solicitud. */
export async function rechazarOc(db: DB, actor: UsuarioSesion, id: number, motivo: string): Promise<void> {
  await exigirAutorizador(db, actor);
  if (!motivo.trim()) throw new ErrorDeNegocio("Indica el motivo del rechazo.");
  await db.transaction(async (tx) => {
    const oc = await ocParaCambiar(tx, id);
    if (oc.estado !== "EMITIDA") throw new ErrorDeNegocio("La orden de compra ya no está pendiente de autorización.");
    await tx.update(ordenesCompra).set({ estado: "RECHAZADA", motivo: `${actor.nombre}: ${motivo.trim()}` }).where(eq(ordenesCompra.id, id));
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
