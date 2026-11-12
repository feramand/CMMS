import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { especialidades, fichasTecnico, notificaciones, usuarios, type Perfil } from "@/db/schema";
import { estaDisponible } from "./disponibilidad";
import { contextoDisponibilidad } from "./horarios-core";

/** Base de datos o transacción en curso. */
export type Ejecutor = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

export async function notificar(
  ex: Ejecutor,
  usuarioIds: number[],
  mensaje: string,
  enlace: string,
): Promise<void> {
  const unicos = [...new Set(usuarioIds)];
  if (unicos.length === 0) return;
  await ex.insert(notificaciones).values(unicos.map((usuarioId) => ({ usuarioId, mensaje, enlace })));
}

export async function idsPorPerfil(ex: Ejecutor, ...perfiles: Perfil[]): Promise<number[]> {
  const filas = await ex
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(and(inArray(usuarios.perfil, perfiles), eq(usuarios.activo, true)));
  return filas.map((f) => f.id);
}

/**
 * Técnicos de las especialidades indicadas que están disponibles en este momento
 * (turno activado, o dentro de su horario fijo y fuera de feriados).
 */
export async function tecnicosDisponibles(ex: Ejecutor, codigos: string[], ahora = new Date()): Promise<number[]> {
  const [filas, contexto] = await Promise.all([
    ex
      .select({
        id: usuarios.id,
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
      .where(and(eq(usuarios.perfil, "TECNICO"), eq(usuarios.activo, true), inArray(especialidades.codigo, codigos))),
    contextoDisponibilidad(ex),
  ]);
  return filas
    .filter((f) => estaDisponible(f, ahora, contexto.feriados, contexto.horasApagado))
    .map((f) => f.id);
}
