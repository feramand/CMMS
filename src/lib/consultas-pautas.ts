import "server-only";
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { activos, ciclosPauta, especialidades, pautas, plantas, usuarios } from "@/db/schema";
import { avance, diasEntre } from "./pautas-calculo";
import { partesEnChile } from "./tiempo";

const n = (x: number) => x.toLocaleString("es-CL");

export function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}-${m}-${a}`;
}

export function intervaloTexto(tipo: "TIEMPO" | "GIROS", intervalo: number): string {
  return tipo === "GIROS" ? `cada ${n(intervalo)} giros` : `cada ${n(intervalo)} ${intervalo === 1 ? "día" : "días"}`;
}

type CicloAbierto = typeof ciclosPauta.$inferSelect & { responsable: string | null };

/** Avance del ciclo en porcentaje y los tres hitos en palabras. */
export function resumenCiclo(tipo: "TIEMPO" | "GIROS", c: typeof ciclosPauta.$inferSelect, giros: number | null, hoy: string) {
  if (tipo === "GIROS") {
    return {
      avance: avance(c.baseGiros!, c.objetivoGiros!, giros ?? c.baseGiros!),
      liberacion: `${n(c.liberacionGiros!)} giros`,
      objetivo: `${n(c.objetivoGiros!)} giros`,
      limite: `${n(c.limiteGiros!)} giros`,
      base: `${n(c.baseGiros!)} giros`,
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
    return { ...p, ciclo, resumen: ciclo ? resumenCiclo(p.tipo, ciclo, p.giros, hoy) : null };
  });
}

export type PautaListada = Awaited<ReturnType<typeof listarPautas>>[number];

/** Pautas liberadas (pendientes de ejecutar) de una especialidad, las más avanzadas primero. */
export async function pautasLiberadas(especialidadId?: number) {
  const lista = await listarPautas(and(eq(pautas.activa, true), especialidadId ? eq(pautas.especialidadId, especialidadId) : undefined));
  return lista
    .filter((p) => p.ciclo?.estado === "LIBERADA")
    .sort((a, b) => (b.resumen?.avance ?? 0) - (a.resumen?.avance ?? 0));
}
