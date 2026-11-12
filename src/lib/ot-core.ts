// Órdenes de trabajo: creación manual, asignación, cambios de estado y causa raíz.
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import {
  activos,
  bitacora,
  especialidades,
  ordenesTrabajo,
  solicitudes,
  solicitudesRepuesto,
  usuarios,
  type EstadoOt,
  type Prioridad,
  type TipoOt,
  ciclosPauta,
  pautas,
} from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import { idsPorPerfil, notificar } from "./notificar";
import { registrarApoyos, siguienteFolio } from "./sat-core";
import { ErrorDeNegocio } from "./usuarios-core";

export const ESTADOS_OT: { valor: EstadoOt; nombre: string }[] = [
  { valor: "CREADA", nombre: "Creada" },
  { valor: "ASIGNADA", nombre: "Asignada" },
  { valor: "EN_CURSO", nombre: "En curso" },
  { valor: "ESPERA_REPUESTOS", nombre: "En espera de repuestos" },
  { valor: "FINALIZADA", nombre: "Finalizada" },
  { valor: "CANCELADA", nombre: "Cancelada" },
];

export function nombreEstadoOt(e: EstadoOt): string {
  return ESTADOS_OT.find((x) => x.valor === e)?.nombre ?? e;
}

/** Cambios de estado permitidos. Finalizada y Cancelada son finales. */
const TRANSICIONES: Record<EstadoOt, EstadoOt[]> = {
  CREADA: ["ASIGNADA", "EN_CURSO", "CANCELADA"],
  ASIGNADA: ["EN_CURSO", "ESPERA_REPUESTOS", "CANCELADA"],
  EN_CURSO: ["ESPERA_REPUESTOS", "FINALIZADA", "CANCELADA"],
  ESPERA_REPUESTOS: ["EN_CURSO", "FINALIZADA", "CANCELADA"],
  FINALIZADA: [],
  CANCELADA: [],
};

export function estadosSiguientes(actual: EstadoOt, esAdministrativo: boolean): EstadoOt[] {
  return TRANSICIONES[actual].filter((e) => esAdministrativo || (e !== "CANCELADA" && e !== "ASIGNADA"));
}

function administrativo(actor: UsuarioSesion): boolean {
  return actor.perfil === "JEFE_PLANIFICADOR" || actor.perfil === "ADMINISTRADOR";
}

export type DatosOt = {
  activoId: number;
  tipo: TipoOt;
  descripcion: string;
  especialidadId: number;
  prioridad: Prioridad;
  responsableId?: number | null;
  proveedorExterno?: string | null;
  fechaProgramada?: string | null;
};

export async function crearOt(
  db: DB,
  actor: UsuarioSesion,
  datos: DatosOt,
): Promise<{ id: number; folio: string }> {
  if (!administrativo(actor)) throw new ErrorDeNegocio("No tienes permiso para crear órdenes de trabajo.");
  const descripcion = datos.descripcion.trim();
  if (!descripcion) throw new ErrorDeNegocio("Describe el trabajo.");
  if (datos.fechaProgramada && !/^\d{4}-\d{2}-\d{2}$/.test(datos.fechaProgramada)) {
    throw new ErrorDeNegocio("La fecha programada no es válida.");
  }
  return db.transaction(async (tx) => {
    const [activo] = await tx
      .select({ id: activos.id, estado: activos.estadoOperativo })
      .from(activos)
      .where(eq(activos.id, datos.activoId));
    if (!activo) throw new ErrorDeNegocio("Elige una máquina.");
    if (activo.estado === "DESINSTALADO") {
      throw new ErrorDeNegocio("Esta máquina está desinstalada: no admite órdenes de trabajo nuevas.");
    }
    const [esp] = await tx
      .select({ id: especialidades.id })
      .from(especialidades)
      .where(eq(especialidades.id, datos.especialidadId));
    if (!esp) throw new ErrorDeNegocio("Elige una especialidad.");
    const responsableId = datos.responsableId || null;
    if (responsableId) await exigirTecnico(tx, responsableId);
    const folio = await siguienteFolio(tx);
    const [ot] = await tx
      .insert(ordenesTrabajo)
      .values({
        folio,
        activoId: datos.activoId,
        tipo: datos.tipo,
        descripcion,
        especialidadId: datos.especialidadId,
        prioridad: datos.prioridad,
        responsableId,
        proveedorExterno: datos.proveedorExterno?.trim() || null,
        fechaProgramada: datos.fechaProgramada || null,
        creadaPor: actor.id,
        estado: responsableId || datos.proveedorExterno?.trim() ? "ASIGNADA" : "CREADA",
      })
      .returning({ id: ordenesTrabajo.id });
    if (responsableId) {
      await notificar(tx, [responsableId], `Te asignaron la orden de trabajo ${folio}`, `/ot/${ot.id}`);
    }
    await tx.insert(bitacora).values({
      usuarioId: actor.id,
      accion: "CREAR_OT",
      entidad: "ot",
      entidadId: String(ot.id),
      detalle: { folio },
    });
    return { id: ot.id, folio };
  });
}

async function exigirTecnico(
  ex: Parameters<typeof notificar>[0],
  usuarioId: number,
): Promise<void> {
  const [t] = await ex
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(and(eq(usuarios.id, usuarioId), eq(usuarios.perfil, "TECNICO"), eq(usuarios.activo, true)));
  if (!t) throw new ErrorDeNegocio("Elige un técnico.");
}

/** Asigna o reasigna el responsable y, si se indica, la fecha programada. */
export async function asignarOt(
  db: DB,
  actor: UsuarioSesion,
  otId: number,
  datos: { responsableId: number; fechaProgramada?: string | null },
): Promise<void> {
  if (!administrativo(actor)) throw new ErrorDeNegocio("No tienes permiso para asignar.");
  await db.transaction(async (tx) => {
    const [ot] = await tx.select().from(ordenesTrabajo).where(eq(ordenesTrabajo.id, otId)).for("update");
    if (!ot) throw new ErrorDeNegocio("La orden no existe.");
    if (ot.estado === "FINALIZADA" || ot.estado === "CANCELADA") {
      throw new ErrorDeNegocio("La orden ya está cerrada.");
    }
    await exigirTecnico(tx, datos.responsableId);
    await tx
      .update(ordenesTrabajo)
      .set({
        responsableId: datos.responsableId,
        fechaProgramada: datos.fechaProgramada || ot.fechaProgramada,
        estado: ot.estado === "CREADA" ? "ASIGNADA" : ot.estado,
      })
      .where(eq(ordenesTrabajo.id, otId));
    await notificar(tx, [datos.responsableId], `Te asignaron la orden de trabajo ${ot.folio}`, `/ot/${otId}`);
    await tx.insert(bitacora).values({
      usuarioId: actor.id,
      accion: "ASIGNAR_OT",
      entidad: "ot",
      entidadId: String(otId),
      detalle: { responsableId: datos.responsableId },
    });
  });
}

/**
 * Cambia el estado de una OT. La hace el responsable o un administrativo.
 * Al finalizar, cierra la solicitud de origen y registra los técnicos de apoyo.
 */
export async function cambiarEstadoOt(
  db: DB,
  actor: UsuarioSesion,
  otId: number,
  nuevo: EstadoOt,
  extra: { apoyoIds?: number[]; observaciones?: string | null } = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    const [ot] = await tx.select().from(ordenesTrabajo).where(eq(ordenesTrabajo.id, otId)).for("update");
    if (!ot) throw new ErrorDeNegocio("La orden no existe.");
    const admin = administrativo(actor);
    if (!admin && ot.responsableId !== actor.id) {
      throw new ErrorDeNegocio("Solo el responsable puede cambiar el estado de esta orden.");
    }
    if (!estadosSiguientes(ot.estado, admin).includes(nuevo)) {
      throw new ErrorDeNegocio("Ese cambio de estado no está permitido.");
    }
    const ahora = new Date();
    await tx
      .update(ordenesTrabajo)
      .set({
        estado: nuevo,
        inicioEn: ot.inicioEn ?? (nuevo === "EN_CURSO" || nuevo === "FINALIZADA" ? ahora : null),
        terminoEn: nuevo === "FINALIZADA" ? ahora : null,
        observaciones: extra.observaciones?.trim() || ot.observaciones,
      })
      .where(eq(ordenesTrabajo.id, otId));
    if (nuevo === "FINALIZADA") {
      await registrarApoyos(tx, actor, { otId }, extra.apoyoIds ?? [], `/ot/${otId}`);
      const cerradas = await tx
        .update(solicitudes)
        .set({ estado: "CERRADA", cerradaEn: ahora })
        .where(and(eq(solicitudes.otId, otId), eq(solicitudes.estado, "ESCALADA")))
        .returning({ id: solicitudes.id, creadaPor: solicitudes.creadaPor });
      for (const s of cerradas) {
        if (s.creadaPor) {
          await notificar(tx, [s.creadaPor], "Tu solicitud fue solucionada con una orden de trabajo", `/sat/${s.id}`);
        }
      }
    }
    const interesados = [
      ...(await idsPorPerfil(tx, "JEFE_PLANIFICADOR", "ADMINISTRADOR")),
      ...(ot.responsableId ? [ot.responsableId] : []),
    ].filter((id) => id !== actor.id);
    await notificar(tx, interesados, `OT ${ot.folio}: ${nombreEstadoOt(nuevo)}`, `/ot/${otId}`);
    await tx.insert(bitacora).values({
      usuarioId: actor.id,
      accion: "ESTADO_OT",
      entidad: "ot",
      entidadId: String(otId),
      detalle: { de: ot.estado, a: nuevo },
    });
  });
}

export async function guardarCausaRaiz(
  db: DB,
  actor: UsuarioSesion,
  otId: number,
  datos: { causa: string; solucion: string; acciones: string; observaciones: string },
): Promise<void> {
  const [ot] = await db
    .select({ responsableId: ordenesTrabajo.responsableId })
    .from(ordenesTrabajo)
    .where(eq(ordenesTrabajo.id, otId));
  if (!ot) throw new ErrorDeNegocio("La orden no existe.");
  if (!administrativo(actor) && ot.responsableId !== actor.id) {
    throw new ErrorDeNegocio("No tienes permiso para editar esta orden.");
  }
  await db
    .update(ordenesTrabajo)
    .set({
      rcaCausa: datos.causa.trim() || null,
      rcaSolucion: datos.solucion.trim() || null,
      rcaAcciones: datos.acciones.trim() || null,
      rcaObservaciones: datos.observaciones.trim() || null,
    })
    .where(eq(ordenesTrabajo.id, otId));
}

export type DatosRepuesto = {
  solicitudId?: number | null;
  otId?: number | null;
  cicloId?: number | null;
  cantidad: number;
  codigoFabricante?: string | null;
  descripcion: string;
};

/** Solicitud de repuesto desde una SAT, una OT o una pauta. La máquina se hereda del trabajo. */
export async function solicitarRepuesto(
  db: DB,
  actor: UsuarioSesion,
  datos: DatosRepuesto,
): Promise<number> {
  if (actor.perfil !== "TECNICO" && !administrativo(actor)) {
    throw new ErrorDeNegocio("Tu perfil no puede solicitar repuestos.");
  }
  const descripcion = datos.descripcion.trim();
  if (!descripcion) throw new ErrorDeNegocio("Describe el repuesto.");
  if (!Number.isInteger(datos.cantidad) || datos.cantidad < 1) {
    throw new ErrorDeNegocio("La cantidad debe ser un número entero mayor que cero.");
  }
  return db.transaction(async (tx) => {
    let activoId: number | undefined;
    if (datos.otId) {
      const [ot] = await tx
        .select({ activoId: ordenesTrabajo.activoId })
        .from(ordenesTrabajo)
        .where(eq(ordenesTrabajo.id, datos.otId));
      activoId = ot?.activoId;
    } else if (datos.solicitudId) {
      const [s] = await tx
        .select({ activoId: solicitudes.activoId })
        .from(solicitudes)
        .where(eq(solicitudes.id, datos.solicitudId));
      activoId = s?.activoId;
    } else if (datos.cicloId) {
      const [c] = await tx
        .select({ activoId: pautas.activoId })
        .from(ciclosPauta)
        .innerJoin(pautas, eq(pautas.id, ciclosPauta.pautaId))
        .where(eq(ciclosPauta.id, datos.cicloId));
      activoId = c?.activoId;
    }
    if (!activoId) throw new ErrorDeNegocio("El repuesto debe pedirse desde una solicitud, una orden de trabajo o una pauta.");
    const [nueva] = await tx
      .insert(solicitudesRepuesto)
      .values({
        activoId,
        solicitudId: datos.otId ? null : (datos.solicitudId ?? null),
        otId: datos.otId ?? null,
        cicloId: datos.otId || datos.solicitudId ? null : (datos.cicloId ?? null),
        solicitanteId: actor.id,
        cantidad: datos.cantidad,
        codigoFabricante: datos.codigoFabricante?.trim() || null,
        descripcion,
      })
      .returning({ id: solicitudesRepuesto.id });
    await notificar(
      tx,
      await idsPorPerfil(tx, "BODEGUERO"),
      `Solicitud de repuesto: ${datos.cantidad} × ${descripcion}`,
      "/inicio",
    );
    return nueva.id;
  });
}

/** El bodeguero marca una solicitud de repuesto como entregada o rechazada. */
export async function resolverRepuesto(
  db: DB,
  actor: UsuarioSesion,
  id: number,
  estado: "ENTREGADA" | "RECHAZADA",
): Promise<void> {
  if (actor.perfil !== "BODEGUERO" && actor.perfil !== "ADMINISTRADOR") {
    throw new ErrorDeNegocio("Solo bodega puede resolver solicitudes de repuesto.");
  }
  const cambiadas = await db
    .update(solicitudesRepuesto)
    .set({ estado, resueltaEn: new Date(), resueltaPor: actor.id })
    .where(and(eq(solicitudesRepuesto.id, id), inArray(solicitudesRepuesto.estado, ["PENDIENTE", "APROBADA"])))
    .returning({ solicitanteId: solicitudesRepuesto.solicitanteId, descripcion: solicitudesRepuesto.descripcion });
  if (cambiadas.length === 0) throw new ErrorDeNegocio("La solicitud ya fue resuelta.");
  await notificar(
    db,
    [cambiadas[0].solicitanteId],
    `Repuesto ${estado === "ENTREGADA" ? "entregado" : "rechazado"}: ${cambiadas[0].descripcion}`,
    "/inicio",
  );
}
