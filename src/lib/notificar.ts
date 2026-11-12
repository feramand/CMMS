import { and, eq, inArray, or } from "drizzle-orm";
import type { DB } from "@/db";
import { especialidades, fichasTecnico, notificaciones, usuarios, type Perfil } from "@/db/schema";

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
 * Técnicos disponibles de las especialidades indicadas: los de turnos rotativos
 * solo si están de turno; los de horario fijo, siempre (su horario semanal llega más adelante).
 */
export async function tecnicosDisponibles(ex: Ejecutor, codigos: string[]): Promise<number[]> {
  const filas = await ex
    .select({ id: usuarios.id })
    .from(usuarios)
    .innerJoin(fichasTecnico, eq(fichasTecnico.usuarioId, usuarios.id))
    .innerJoin(especialidades, eq(especialidades.id, fichasTecnico.especialidadId))
    .where(
      and(
        eq(usuarios.perfil, "TECNICO"),
        eq(usuarios.activo, true),
        inArray(especialidades.codigo, codigos),
        or(eq(fichasTecnico.modalidad, "HORARIO_FIJO"), eq(fichasTecnico.enTurno, true)),
      ),
    );
  return filas.map((f) => f.id);
}
