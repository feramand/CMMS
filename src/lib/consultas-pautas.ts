import "server-only";
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { actividadesCiclo, activos, ciclosPauta, especialidades, pautas, plantas, usuarios } from "@/db/schema";
import { avance, diasEntre, parteDelGrupo, type GrupoVista } from "./pautas-calculo";

export type { GrupoVista };
import { partesEnChile } from "./tiempo";

const n = (x: number) => x.toLocaleString("es-CL");

export function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}-${m}-${a}`;
}

export function intervaloTexto(tipo: "TIEMPO" | "GIROS", intervalo: number, unidad = "giros"): string {
  return tipo === "GIROS" ? `cada ${n(intervalo)} ${unidad}` : `cada ${n(intervalo)} ${intervalo === 1 ? "día" : "días"}`;
}

type CicloAbierto = typeof ciclosPauta.$inferSelect & { responsable: string | null };

/** Avance del ciclo en porcentaje y los tres hitos en palabras. */
export function resumenCiclo(
  tipo: "TIEMPO" | "GIROS",
  c: typeof ciclosPauta.$inferSelect,
  giros: number | null,
  hoy: string,
  unidad = "giros",
) {
  if (tipo === "GIROS") {
    return {
      avance: avance(c.baseGiros!, c.objetivoGiros!, giros ?? c.baseGiros!),
      liberacion: `${n(c.liberacionGiros!)} ${unidad}`,
      objetivo: `${n(c.objetivoGiros!)} ${unidad}`,
      limite: `${n(c.limiteGiros!)} ${unidad}`,
      base: `${n(c.baseGiros!)} ${unidad}`,
      pasoObjetivo: (giros ?? 0) >= c.objetivoGiros!,
    };
  }
  return {
    avance: avance(0, diasEntre(c.baseFecha!, c.objetivoFecha!), diasEntre(c.baseFecha!, hoy)),
    liberacion: fechaCorta(c.liberacionFecha),
    objetivo: fechaCorta(c.objetivoFecha),
    limite: fechaCorta(c.limiteFecha),
    base: fechaCorta(c.baseFecha),
    pasoObjetivo: hoy >= c.objetivoFecha!,
  };
}

/** Pautas con su máquina y su ciclo abierto (programado o liberado), si lo tienen. */
export async function listarPautas(filtro?: SQL) {
  const lista = await db
    .select({
      id: pautas.id,
      nombre: pautas.nombre,
      tipo: pautas.tipo,
      intervalo: pautas.intervalo,
      activa: pautas.activa,
      especialidadId: pautas.especialidadId,
      especialidad: especialidades.nombre,
      activoId: activos.id,
      activo: activos.nombre,
      giros: activos.girosAcumulados,
      unidad: activos.unidadContador,
      planta: plantas.nombre,
    })
    .from(pautas)
    .innerJoin(activos, eq(activos.id, pautas.activoId))
    .innerJoin(plantas, eq(plantas.id, activos.plantaId))
    .innerJoin(especialidades, eq(especialidades.id, pautas.especialidadId))
    .where(filtro)
    .orderBy(asc(activos.nombre), asc(pautas.nombre));
  if (lista.length === 0) return [];
  const abiertos = await db
    .select({ ciclo: ciclosPauta, responsable: usuarios.nombre })
    .from(ciclosPauta)
    .leftJoin(usuarios, eq(usuarios.id, ciclosPauta.responsableId))
    .where(and(inArray(ciclosPauta.pautaId, lista.map((p) => p.id)), inArray(ciclosPauta.estado, ["PROGRAMADA", "LIBERADA"])));
  const hoy = partesEnChile(new Date()).fecha;
  return lista.map((p) => {
    const fila = abiertos.find((a) => a.ciclo.pautaId === p.id);
    const ciclo: CicloAbierto | null = fila ? { ...fila.ciclo, responsable: fila.responsable } : null;
    return { ...p, ciclo, resumen: ciclo ? resumenCiclo(p.tipo, ciclo, p.giros, hoy, p.unidad) : null };
  });
}

export type PautaListada = Awaited<ReturnType<typeof listarPautas>>[number];

/**
 * Cartillas liberadas en las que un grupo (los operadores o una especialidad) tiene actividades,
 * con el avance de su parte. Las más avanzadas en el intervalo van primero.
 */
export async function pautasLiberadas(grupo: GrupoVista, activoId?: number) {
  const lista = (await listarPautas(and(eq(pautas.activa, true), activoId ? eq(pautas.activoId, activoId) : undefined))).filter(
    (p) => p.ciclo?.estado === "LIBERADA",
  );
  if (lista.length === 0) return [];
  const checklist = await db
    .select({ cicloId: actividadesCiclo.cicloId, estado: actividadesCiclo.estado, operador: actividadesCiclo.operador, especialidadId: actividadesCiclo.especialidadId })
    .from(actividadesCiclo)
    .where(inArray(actividadesCiclo.cicloId, lista.map((p) => p.ciclo!.id)));
  return lista
    .map((p) => ({ ...p, ...parteDelGrupo(checklist.filter((a) => a.cicloId === p.ciclo!.id), grupo, p.especialidadId) }))
    .filter((p) => p.participa)
    .sort((a, b) => (b.resumen?.avance ?? 0) - (a.resumen?.avance ?? 0));
}
