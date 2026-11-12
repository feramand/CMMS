import "server-only";
import { asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  autorizacionesOc,
  centrosCosto,
  cuentasContables,
  lineasOc,
  lineasSc,
  ordenesCompra,
  proveedores,
  solicitudesCompra,
  usuarios,
} from "@/db/schema";
import { totales } from "./compras-core";

export const listarCuentas = () => db.select().from(cuentasContables).orderBy(asc(cuentasContables.codigo));
export const listarCentros = () => db.select().from(centrosCosto).orderBy(asc(centrosCosto.codigo));
export const listarProveedores = () => db.select().from(proveedores).orderBy(asc(proveedores.nombre));

export async function listarSc(filtro?: SQL, limite = 200) {
  const scs = await db
    .select({
      id: solicitudesCompra.id,
      estado: solicitudesCompra.estado,
      nota: solicitudesCompra.nota,
      motivoRechazo: solicitudesCompra.motivoRechazo,
      creadaEn: solicitudesCompra.creadaEn,
      solicitante: usuarios.nombre,
      centroCostoId: solicitudesCompra.centroCostoId,
      centro: centrosCosto.nombre,
    })
    .from(solicitudesCompra)
    .innerJoin(usuarios, eq(usuarios.id, solicitudesCompra.solicitanteId))
    .leftJoin(centrosCosto, eq(centrosCosto.id, solicitudesCompra.centroCostoId))
    .where(filtro)
    .orderBy(desc(solicitudesCompra.id))
    .limit(limite);
  const lineas = scs.length ? await db.select().from(lineasSc).where(inArray(lineasSc.scId, scs.map((s) => s.id))).orderBy(asc(lineasSc.id)) : [];
  return scs.map((s) => ({ ...s, lineas: lineas.filter((l) => l.scId === s.id) }));
}

const emisor = alias(usuarios, "emisor");

export async function listarOc(filtro?: SQL, limite = 200) {
  const ocs = await db
    .select({
      id: ordenesCompra.id,
      scId: ordenesCompra.scId,
      estado: ordenesCompra.estado,
      moneda: ordenesCompra.moneda,
      fechaEntrega: ordenesCompra.fechaEntrega,
      condicionPago: ordenesCompra.condicionPago,
      nota: ordenesCompra.nota,
      motivo: ordenesCompra.motivo,
      codigoVerificacion: ordenesCompra.codigoVerificacion,
      emitidaEn: ordenesCompra.emitidaEn,
      emisor: emisor.nombre,
      proveedor: proveedores.nombre,
      proveedorRut: proveedores.rut,
      proveedorDireccion: proveedores.direccion,
      proveedorContacto: proveedores.contacto,
      centro: centrosCosto.nombre,
      centroCodigo: centrosCosto.codigo,
    })
    .from(ordenesCompra)
    .innerJoin(proveedores, eq(proveedores.id, ordenesCompra.proveedorId))
    .innerJoin(emisor, eq(emisor.id, ordenesCompra.emitidaPor))
    .leftJoin(centrosCosto, eq(centrosCosto.id, ordenesCompra.centroCostoId))
    .where(filtro)
    .orderBy(desc(ordenesCompra.id))
    .limit(limite);
  if (ocs.length === 0) return [];
  const ids = ocs.map((o) => o.id);
  const [lineas, firmas] = await Promise.all([
    db.select().from(lineasOc).where(inArray(lineasOc.ocId, ids)).orderBy(asc(lineasOc.id)),
    db.select().from(autorizacionesOc).where(inArray(autorizacionesOc.ocId, ids)).orderBy(asc(autorizacionesOc.fecha)),
  ]);
  return ocs.map((o) => {
    const propias = lineas.filter((l) => l.ocId === o.id);
    return { ...o, lineas: propias, autorizaciones: firmas.filter((f) => f.ocId === o.id), ...totales(propias, o.moneda) };
  });
}
