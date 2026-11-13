// Matriz de competencias: qué nivel tiene cada técnico en cada máquina.
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { activos, bitacora, competencias, nivelEnum, usuarios } from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import { ErrorDeNegocio } from "./usuarios-core";

export type Nivel = (typeof nivelEnum.enumValues)[number];

export const NIVELES: { valor: Nivel; nombre: string; sigla: string }[] = [
  { valor: "BASICO", nombre: "Básico", sigla: "B" },
  { valor: "INTERMEDIO", nombre: "Intermedio", sigla: "I" },
  { valor: "AVANZADO", nombre: "Avanzado", sigla: "A" },
];

/**
 * Guarda las competencias de un técnico. `niveles` trae un valor por máquina: un nivel, o vacío
 * para dejarlo sin competencia registrada. Las máquinas que no vienen no se tocan.
 */
export async function guardarCompetencias(db: DB, actor: UsuarioSesion, usuarioId: number, niveles: Record<number, string>): Promise<void> {
  if (actor.perfil !== "ADMINISTRADOR" && actor.perfil !== "JEFE_PLANIFICADOR") {
    throw new ErrorDeNegocio("Solo jefe, planificador o administrador editan la matriz de competencias.");
  }
  const [tecnico] = await db.select({ id: usuarios.id, perfil: usuarios.perfil }).from(usuarios).where(eq(usuarios.id, usuarioId));
  if (!tecnico || tecnico.perfil !== "TECNICO") throw new ErrorDeNegocio("Elige un técnico.");
  const validos = new Set((await db.select({ id: activos.id }).from(activos)).map((a) => a.id));
  await db.transaction(async (tx) => {
    for (const [clave, valor] of Object.entries(niveles)) {
      const activoId = Number(clave);
      if (!validos.has(activoId)) throw new ErrorDeNegocio("Una de las máquinas no existe.");
      if (!valor) {
        await tx.delete(competencias).where(and(eq(competencias.usuarioId, usuarioId), eq(competencias.activoId, activoId)));
        continue;
      }
      if (!NIVELES.some((n) => n.valor === valor)) throw new ErrorDeNegocio("Nivel no válido: usa básico, intermedio o avanzado.");
      const nivel = valor as Nivel;
      await tx
        .insert(competencias)
        .values({ usuarioId, activoId, nivel })
        .onConflictDoUpdate({ target: [competencias.usuarioId, competencias.activoId], set: { nivel } });
    }
    await tx.insert(bitacora).values({ usuarioId: actor.id, accion: "GUARDAR_COMPETENCIAS", entidad: "usuario", entidadId: String(usuarioId), detalle: niveles });
  });
}
