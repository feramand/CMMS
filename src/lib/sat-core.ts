// Solicitudes de atención técnica (SAT): creación, toma, asignación, cierre y escalamiento a OT.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  activos,
  apoyos,
  avisosSolicitud,
  bitacora,
  especialidades,
  fichasTecnico,
  foliosOt,
  ordenesTrabajo,
  sectores,
  solicitudes,
  usuarios,
  type Categoria,
  type Prioridad,
} from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import { especialidadesDe, nombreCategoria, ORIGENES_REALES } from "./categorias";
import { idsPorPerfil, notificar, tecnicosDisponibles, type Ejecutor } from "./notificar";
import { anioEnChile, formatoFolio } from "./tiempo";
import { ErrorDeNegocio } from "./usuarios-core";

const ADMINISTRATIVOS = ["JEFE_PLANIFICADOR", "ADMINISTRADOR"] as const;

function esAdministrativo(actor: UsuarioSesion): boolean {
  return actor.perfil === "JEFE_PLANIFICADOR" || actor.perfil === "ADMINISTRADOR";
}

async function codigoEspecialidad(ex: Ejecutor, usuarioId: number): Promise<string | null> {
  const [f] = await ex
    .select({ codigo: especialidades.codigo })
    .from(fichasTecnico)
    .innerJoin(especialidades, eq(especialidades.id, fichasTecnico.especialidadId))
    .where(eq(fichasTecnico.usuarioId, usuarioId));
  return f?.codigo ?? null;
}

/** Siguiente folio de OT del año, sin huecos ni repetidos aunque se pidan varios a la vez. */
export async function siguienteFolio(ex: Ejecutor, ahora = new Date()): Promise<string> {
  const anio = anioEnChile(ahora);
  const [fila] = await ex
    .insert(foliosOt)
    .values({ anio, ultimo: 1 })
    .onConflictDoUpdate({ target: foliosOt.anio, set: { ultimo: sql`${foliosOt.ultimo} + 1` } })
    .returning({ ultimo: foliosOt.ultimo });
  return formatoFolio(anio, fila.ultimo);
}

export type DatosSolicitud = {
  activoId: number;
  categoria: Categoria;
  comentario?: string | null;
  /** ¿La falla tiene la máquina detenida? Si no se indica, se asume que sí. */
  maquinaDetenida?: boolean;
};

/**
 * Crea una solicitud. Si ya hay una abierta para la misma máquina y categoría,
 * no la duplica: registra el aviso en la existente y devuelve su id.
 */
export async function crearSolicitud(
  db: DB,
  actor: UsuarioSesion,
  datos: DatosSolicitud,
): Promise<{ id: number; duplicada: boolean }> {
  if (actor.perfil === "BODEGUERO" || actor.perfil === "ABASTECIMIENTO") {
    throw new ErrorDeNegocio("Tu perfil no puede reportar fallas.");
  }
  const origen = actor.perfil === "OPERADOR" ? "OPERADOR" : actor.perfil === "TECNICO" ? "TECNICO" : "JEFE";
  return registrarSolicitud(db, { ...datos, origen, creadaPor: actor.id });
}

/**
 * Crea la solicitud sin revisar permisos: la usan el reporte de una persona y la detención
 * que llega de Metrics (sin usuario del CMMS, con el id y la hora de la detención).
 */
export async function registrarSolicitud(
  db: DB,
  datos: DatosSolicitud & {
    origen: "METRICS" | "OPERADOR" | "TECNICO" | "JEFE";
    creadaPor: number | null;
    idDetencionMetrics?: string;
    detenidaEn?: Date;
  },
): Promise<{ id: number; duplicada: boolean }> {
  const actor = { id: datos.creadaPor };
  const comentario = datos.comentario?.trim() || null;
  return db.transaction(async (tx) => {
    const [activo] = await tx
      .select({ id: activos.id, nombre: activos.nombre, activo: activos.activo, estado: activos.estadoOperativo })
      .from(activos)
      .where(eq(activos.id, datos.activoId))
      // Bloquea la fila de la máquina: dos reportes simultáneos no crean dos solicitudes.
      .for("update");
    if (!activo || !activo.activo) throw new ErrorDeNegocio("Elige una máquina.");
    if (activo.estado === "DESINSTALADO") {
      throw new ErrorDeNegocio("Esta máquina está desinstalada: no admite solicitudes nuevas.");
    }

    const [abierta] = await tx
      .select({ id: solicitudes.id })
      .from(solicitudes)
      .where(
        and(
          eq(solicitudes.activoId, datos.activoId),
          eq(solicitudes.categoria, datos.categoria),
          inArray(solicitudes.estado, ["PENDIENTE", "EN_ATENCION"]),
        ),
      )
      .limit(1);
    if (abierta) {
      await tx
        .insert(avisosSolicitud)
        .values({
          solicitudId: abierta.id,
          usuarioId: actor.id,
          comentario,
          idDetencionMetrics: datos.idDetencionMetrics ?? null,
        });
      return { id: abierta.id, duplicada: true };
    }

    const [nueva] = await tx
      .insert(solicitudes)
      .values({
        activoId: datos.activoId,
        categoria: datos.categoria,
        origen: datos.origen,
        creadaPor: actor.id,
        comentario,
        idDetencionMetrics: datos.idDetencionMetrics ?? null,
        detenidaEn: datos.detenidaEn ?? null,
        maquinaDetenida: datos.maquinaDetenida ?? true,
      })
      .returning({ id: solicitudes.id });

    const destinatarios = [
      ...(await idsPorPerfil(tx, ...ADMINISTRATIVOS)),
      ...(await tecnicosDisponibles(tx, especialidadesDe(datos.categoria))),
    ].filter((id) => id !== actor.id);
    await notificar(
      tx,
      destinatarios,
      `Nueva solicitud: ${activo.nombre} · ${nombreCategoria(datos.categoria)}`,
      `/sat/${nueva.id}`,
    );
    return { id: nueva.id, duplicada: false };
  });
}

/** El técnico toma una solicitud pendiente de su especialidad. Solo el primero lo consigue. */
export async function tomarSolicitud(db: DB, actor: UsuarioSesion, solicitudId: number): Promise<void> {
  if (actor.perfil !== "TECNICO") throw new ErrorDeNegocio("Solo un técnico puede tomar una solicitud.");
  await db.transaction(async (tx) => {
    const [s] = await tx
      .select({ categoria: solicitudes.categoria })
      .from(solicitudes)
      .where(eq(solicitudes.id, solicitudId));
    if (!s) throw new ErrorDeNegocio("La solicitud no existe.");
    const codigo = await codigoEspecialidad(tx, actor.id);
    if (!codigo || !especialidadesDe(s.categoria).includes(codigo)) {
      throw new ErrorDeNegocio("Esta solicitud no es de tu especialidad.");
    }
    // Toma atómica: la condición sobre el estado decide quién gana.
    const tomadas = await tx
      .update(solicitudes)
      .set({ estado: "EN_ATENCION", responsableId: actor.id, tomadaEn: new Date() })
      .where(and(eq(solicitudes.id, solicitudId), eq(solicitudes.estado, "PENDIENTE")))
      .returning({ id: solicitudes.id });
    if (tomadas.length === 0) {
      throw new ErrorDeNegocio("Otra persona ya tomó esta solicitud.");
    }
    await tx.insert(bitacora).values({
      usuarioId: actor.id,
      accion: "TOMAR_SOLICITUD",
      entidad: "solicitud",
      entidadId: String(solicitudId),
    });
  });
}

/** Jefe, planificador o administrador asignan o reasignan una solicitud abierta. */
export async function asignarSolicitud(
  db: DB,
  actor: UsuarioSesion,
  solicitudId: number,
  tecnicoId: number,
): Promise<void> {
  if (!esAdministrativo(actor)) throw new ErrorDeNegocio("No tienes permiso para asignar.");
  await db.transaction(async (tx) => {
    const [tecnico] = await tx
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(and(eq(usuarios.id, tecnicoId), eq(usuarios.perfil, "TECNICO"), eq(usuarios.activo, true)));
    if (!tecnico) throw new ErrorDeNegocio("Elige un técnico.");
    const cambiadas = await tx
      .update(solicitudes)
      .set({
        estado: "EN_ATENCION",
        responsableId: tecnicoId,
        tomadaEn: sql`coalesce(${solicitudes.tomadaEn}, now())`,
      })
      .where(
        and(eq(solicitudes.id, solicitudId), inArray(solicitudes.estado, ["PENDIENTE", "EN_ATENCION"])),
      )
      .returning({ activoId: solicitudes.activoId });
    if (cambiadas.length === 0) throw new ErrorDeNegocio("La solicitud ya no está abierta.");
    const [a] = await tx
      .select({ nombre: activos.nombre })
      .from(activos)
      .where(eq(activos.id, cambiadas[0].activoId));
    await notificar(tx, [tecnicoId], `Te asignaron una solicitud: ${a.nombre}`, `/sat/${solicitudId}`);
    await tx.insert(bitacora).values({
      usuarioId: actor.id,
      accion: "ASIGNAR_SOLICITUD",
      entidad: "solicitud",
      entidadId: String(solicitudId),
      detalle: { tecnicoId },
    });
  });
}

async function solicitudDelResponsable(ex: Ejecutor, actor: UsuarioSesion, solicitudId: number) {
  const [s] = await ex
    .select()
    .from(solicitudes)
    .where(eq(solicitudes.id, solicitudId))
    .for("update");
  if (!s) throw new ErrorDeNegocio("La solicitud no existe.");
  if (s.estado !== "EN_ATENCION") throw new ErrorDeNegocio("La solicitud no está en atención.");
  if (s.responsableId !== actor.id) {
    throw new ErrorDeNegocio("Solo el técnico responsable puede hacer esto.");
  }
  return s;
}

async function registrarApoyos(
  ex: Ejecutor,
  actor: UsuarioSesion,
  destino: { solicitudId: number } | { otId: number },
  apoyoIds: number[],
  enlace: string,
): Promise<void> {
  const ids = [...new Set(apoyoIds)].filter((id) => id !== actor.id);
  if (ids.length === 0) return;
  const validos = await ex
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(and(inArray(usuarios.id, ids), eq(usuarios.perfil, "TECNICO"), eq(usuarios.activo, true)));
  if (validos.length !== ids.length) throw new ErrorDeNegocio("El técnico de apoyo no es válido.");
  await ex
    .insert(apoyos)
    .values(ids.map((usuarioId) => ({ ...destino, usuarioId, registradoPor: actor.id })))
    .onConflictDoNothing();
  await notificar(ex, ids, `${actor.nombre} te registró como apoyo en un trabajo`, enlace);
}

export type DatosCierre = {
  sectorId: number;
  solucion: string;
  origenReal?: Categoria | null;
  apoyoIds?: number[];
};

/** Cierre de falla simple: sector + solución. Sin orden de trabajo. */
export async function cerrarSolicitud(
  db: DB,
  actor: UsuarioSesion,
  solicitudId: number,
  datos: DatosCierre,
): Promise<void> {
  const solucion = datos.solucion.trim();
  if (!solucion) throw new ErrorDeNegocio("Escribe la solución aplicada.");
  await db.transaction(async (tx) => {
    const s = await solicitudDelResponsable(tx, actor, solicitudId);
    const [sector] = await tx
      .select({ id: sectores.id })
      .from(sectores)
      .where(and(eq(sectores.id, datos.sectorId), eq(sectores.activoId, s.activoId), eq(sectores.activo, true)));
    if (!sector) throw new ErrorDeNegocio("Elige el sector de la máquina.");
    let origenReal: Categoria | null = null;
    if (s.categoria === "INDETERMINADA") {
      if (!datos.origenReal || !ORIGENES_REALES.includes(datos.origenReal)) {
        throw new ErrorDeNegocio("Indica el origen real de la falla.");
      }
      origenReal = datos.origenReal;
    }
    await tx
      .update(solicitudes)
      .set({ estado: "SOLUCIONADA", sectorId: sector.id, solucion, origenReal, cerradaEn: new Date() })
      .where(eq(solicitudes.id, solicitudId));
    await registrarApoyos(tx, actor, { solicitudId }, datos.apoyoIds ?? [], `/sat/${solicitudId}`);
    if (s.creadaPor && s.creadaPor !== actor.id) {
      await notificar(tx, [s.creadaPor], `Tu solicitud fue solucionada: ${solucion}`, `/sat/${solicitudId}`);
    }
    await tx.insert(bitacora).values({
      usuarioId: actor.id,
      accion: "CERRAR_SOLICITUD",
      entidad: "solicitud",
      entidadId: String(solicitudId),
    });
  });
}

/** Falla compleja: genera una OT con los datos de la solicitud y deja ambas vinculadas. */
export async function escalarSolicitud(
  db: DB,
  actor: UsuarioSesion,
  solicitudId: number,
  datos: { descripcion: string; prioridad?: Prioridad },
): Promise<{ otId: number; folio: string }> {
  const descripcion = datos.descripcion.trim();
  if (!descripcion) throw new ErrorDeNegocio("Describe el problema.");
  return db.transaction(async (tx) => {
    const s = await solicitudDelResponsable(tx, actor, solicitudId);
    // La especialidad de la OT es la de la falla; si era indeterminada, la del técnico que la atendió.
    const codigos = especialidadesDe(s.categoria);
    const codigo = codigos.length === 1 ? codigos[0] : await codigoEspecialidad(tx, actor.id);
    const [esp] = await tx
      .select({ id: especialidades.id })
      .from(especialidades)
      .where(eq(especialidades.codigo, codigo ?? ""));
    if (!esp) throw new ErrorDeNegocio("No se pudo determinar la especialidad de la orden.");
    const folio = await siguienteFolio(tx);
    const [ot] = await tx
      .insert(ordenesTrabajo)
      .values({
        folio,
        activoId: s.activoId,
        tipo: "CORRECTIVA",
        descripcion,
        especialidadId: esp.id,
        prioridad: datos.prioridad ?? "MEDIA",
        responsableId: actor.id,
        creadaPor: actor.id,
        estado: "ASIGNADA",
      })
      .returning({ id: ordenesTrabajo.id });
    await tx
      .update(solicitudes)
      .set({ estado: "ESCALADA", otId: ot.id })
      .where(eq(solicitudes.id, solicitudId));
    await notificar(
      tx,
      await idsPorPerfil(tx, ...ADMINISTRATIVOS),
      `Nueva orden de trabajo ${folio} desde una solicitud`,
      `/ot/${ot.id}`,
    );
    await tx.insert(bitacora).values({
      usuarioId: actor.id,
      accion: "ESCALAR_SOLICITUD",
      entidad: "solicitud",
      entidadId: String(solicitudId),
      detalle: { otId: ot.id, folio },
    });
    return { otId: ot.id, folio };
  });
}

export { registrarApoyos };
