import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  activos,
  especialidades,
  fichasTecnico,
  notificaciones,
  ordenesTrabajo,
  plantas,
  sectores,
  tiposMaquina,
  solicitudes,
  usuarios,
} from "@/db/schema";
import { estaDisponible } from "./disponibilidad";
import { contextoDisponibilidad } from "./horarios-core";

const responsable = alias(usuarios, "responsable");
const creador = alias(usuarios, "creador");

export function listarSolicitudes(filtro?: SQL, limite = 200) {
  return db
    .select({
      id: solicitudes.id,
      estado: solicitudes.estado,
      categoria: solicitudes.categoria,
      origen: solicitudes.origen,
      comentario: solicitudes.comentario,
      creadaEn: solicitudes.creadaEn,
      detenidaEn: solicitudes.detenidaEn,
      maquinaDetenida: solicitudes.maquinaDetenida,
      tomadaEn: solicitudes.tomadaEn,
      cerradaEn: solicitudes.cerradaEn,
      solucion: solicitudes.solucion,
      origenReal: solicitudes.origenReal,
      otId: solicitudes.otId,
      folioOt: ordenesTrabajo.folio,
      activoId: activos.id,
      activo: activos.nombre,
      planta: plantas.nombre,
      seccion: activos.seccion,
      sector: sectores.nombre,
      responsableId: solicitudes.responsableId,
      responsable: responsable.nombre,
      creadaPor: solicitudes.creadaPor,
      creador: creador.nombre,
    })
    .from(solicitudes)
    .innerJoin(activos, eq(activos.id, solicitudes.activoId))
    .innerJoin(plantas, eq(plantas.id, activos.plantaId))
    .leftJoin(sectores, eq(sectores.id, solicitudes.sectorId))
    .leftJoin(ordenesTrabajo, eq(ordenesTrabajo.id, solicitudes.otId))
    .leftJoin(responsable, eq(responsable.id, solicitudes.responsableId))
    .leftJoin(creador, eq(creador.id, solicitudes.creadaPor))
    .where(filtro)
    .orderBy(desc(solicitudes.creadaEn))
    .limit(limite);
}

export type FilaSolicitud = Awaited<ReturnType<typeof listarSolicitudes>>[number];

export function listarOts(filtro?: SQL, limite = 200) {
  return db
    .select({
      id: ordenesTrabajo.id,
      folio: ordenesTrabajo.folio,
      estado: ordenesTrabajo.estado,
      tipo: ordenesTrabajo.tipo,
      descripcion: ordenesTrabajo.descripcion,
      prioridad: ordenesTrabajo.prioridad,
      fechaProgramada: ordenesTrabajo.fechaProgramada,
      creadaEn: ordenesTrabajo.creadaEn,
      inicioEn: ordenesTrabajo.inicioEn,
      terminoEn: ordenesTrabajo.terminoEn,
      proveedorExterno: ordenesTrabajo.proveedorExterno,
      observaciones: ordenesTrabajo.observaciones,
      rcaCausa: ordenesTrabajo.rcaCausa,
      rcaSolucion: ordenesTrabajo.rcaSolucion,
      rcaAcciones: ordenesTrabajo.rcaAcciones,
      rcaObservaciones: ordenesTrabajo.rcaObservaciones,
      activoId: activos.id,
      activo: activos.nombre,
      planta: plantas.nombre,
      especialidad: especialidades.nombre,
      responsableId: ordenesTrabajo.responsableId,
      responsable: responsable.nombre,
    })
    .from(ordenesTrabajo)
    .innerJoin(activos, eq(activos.id, ordenesTrabajo.activoId))
    .innerJoin(plantas, eq(plantas.id, activos.plantaId))
    .innerJoin(especialidades, eq(especialidades.id, ordenesTrabajo.especialidadId))
    .leftJoin(responsable, eq(responsable.id, ordenesTrabajo.responsableId))
    .where(filtro)
    .orderBy(desc(ordenesTrabajo.creadaEn))
    .limit(limite);
}

export type FilaOt = Awaited<ReturnType<typeof listarOts>>[number];

/** Técnicos activos con su especialidad, disponibilidad y cantidad de trabajos abiertos. */
export async function listarTecnicos() {
  const [tecnicos, satAbiertas, otAbiertas, contexto] = await Promise.all([
    db
      .select({
        id: usuarios.id,
        nombre: usuarios.nombre,
        especialidad: especialidades.nombre,
        codigo: especialidades.codigo,
        modalidad: fichasTecnico.modalidad,
        enTurno: fichasTecnico.enTurno,
        turnoDesde: fichasTecnico.turnoDesde,
        diasLaborales: fichasTecnico.diasLaborales,
        horaEntrada: fichasTecnico.horaEntrada,
        horaSalida: fichasTecnico.horaSalida,
      })
      .from(usuarios)
      .innerJoin(fichasTecnico, eq(fichasTecnico.usuarioId, usuarios.id))
      .innerJoin(especialidades, eq(especialidades.id, fichasTecnico.especialidadId))
      .where(and(eq(usuarios.perfil, "TECNICO"), eq(usuarios.activo, true)))
      .orderBy(asc(usuarios.nombre)),
    db
      .select({ id: solicitudes.responsableId, n: count() })
      .from(solicitudes)
      .where(eq(solicitudes.estado, "EN_ATENCION"))
      .groupBy(solicitudes.responsableId),
    db
      .select({ id: ordenesTrabajo.responsableId, n: count() })
      .from(ordenesTrabajo)
      .where(inArray(ordenesTrabajo.estado, ["ASIGNADA", "EN_CURSO", "ESPERA_REPUESTOS"]))
      .groupBy(ordenesTrabajo.responsableId),
    contextoDisponibilidad(db),
  ]);
  const ahora = new Date();
  const abiertos = new Map<number, number>();
  for (const f of [...satAbiertas, ...otAbiertas]) {
    if (f.id) abiertos.set(f.id, (abiertos.get(f.id) ?? 0) + f.n);
  }
  return tecnicos.map((t) => ({
    ...t,
    disponible: estaDisponible(t, ahora, contexto.feriados, contexto.horasApagado),
    trabajosAbiertos: abiertos.get(t.id) ?? 0,
  }));
}

export type Tecnico = Awaited<ReturnType<typeof listarTecnicos>>[number];

/** Máquinas para elegir al reportar una falla o crear una OT: sin las desinstaladas. */
export async function listarActivosVigentes() {
  return (await listarActivos()).filter((a) => a.estadoOperativo !== "DESINSTALADO");
}

export function listarActivos() {
  return db
    .select({
      id: activos.id,
      codigo: activos.codigo,
      nombre: activos.nombre,
      tipo: tiposMaquina.nombre,
      seccion: activos.seccion,
      estadoOperativo: activos.estadoOperativo,
      planta: plantas.nombre,
    })
    .from(activos)
    .innerJoin(plantas, eq(plantas.id, activos.plantaId))
    .leftJoin(tiposMaquina, eq(tiposMaquina.id, activos.tipoMaquinaId))
    .where(eq(activos.activo, true))
    .orderBy(asc(plantas.nombre), asc(activos.nombre));
}

export async function notificacionesSinLeer(usuarioId: number): Promise<number> {
  const [f] = await db
    .select({ n: count() })
    .from(notificaciones)
    .where(and(eq(notificaciones.usuarioId, usuarioId), isNull(notificaciones.leidaEn)));
  return f.n;
}
