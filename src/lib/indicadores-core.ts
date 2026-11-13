// Indicadores de mantenimiento de un período. Los usan la pantalla y la exportación a Excel,
// para que ambas muestren exactamente las mismas cifras.
import { and, asc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  actividadesCiclo,
  activos,
  apoyos,
  ciclosPauta,
  ordenesTrabajo,
  pautas,
  plantas,
  sectores,
  solicitudes,
  usuarios,
  type Categoria,
} from "@/db/schema";
import { downtimePorMaquina, porcentajeDetenida } from "./downtime";
import {
  cumplimiento,
  esATiempo,
  mtbf,
  porcentaje,
  recurrentesDelPeriodo,
  tiemposDeAtencion,
  type CicloIndicador,
  type Cumplimiento,
  type Tiempos,
} from "./indicadores";
import { esFechaValida, sumarDias } from "./pautas-calculo";
import { inicioDelDiaEnChile, minutosEntre, partesEnChile } from "./tiempo";

/** Fallas del mismo sistema de una máquina que hacen «recurrente» en el período. */
export const UMBRAL_RECURRENTE = 3;

/** Período pedido en la dirección: fechas de Chile, ambas inclusive. Por defecto, el mes en curso. */
export function periodoPedido(pedido: { desde?: string | null; hasta?: string | null }, ahora = new Date()) {
  const hoy = partesEnChile(ahora).fecha;
  let desde = pedido.desde && esFechaValida(pedido.desde) ? pedido.desde : `${hoy.slice(0, 8)}01`;
  let hasta = pedido.hasta && esFechaValida(pedido.hasta) ? pedido.hasta : hoy;
  if (hasta < desde) [desde, hasta] = [hasta, desde];
  return { desde, hasta, hoy };
}

export type FilaMaquina = Tiempos & {
  activoId: number;
  activo: string;
  planta: string;
  /** Fallas con detención que tocan el período. */
  fallas: number;
  /** De ellas, las que empezaron dentro del período (base del MTBF). */
  iniciadas: number;
  abiertas: number;
  minutosDetenida: number;
  pctDetenida: number;
  mtbf: number | null;
};

export type FilaFalla = {
  id: number;
  activo: string;
  sistema: string | null;
  categoria: Categoria;
  desde: Date;
  tomadaEn: Date | null;
  hasta: Date | null;
  conOt: boolean;
  /** Minutos detenida dentro del período. */
  minutos: number;
};

export type FilaPreventivo = Cumplimiento & { activoId: number; activo: string };

export type FilaCiclo = {
  activo: string;
  pauta: string;
  vuelta: string | null;
  estado: "EJECUTADA" | "INCUMPLIDA";
  aTiempo: boolean;
  cerradoEn: Date;
  objetivo: string;
  real: string;
  ejecuto: string | null;
};

export type FilaTecnico = {
  usuarioId: number;
  nombre: string;
  solicitudes: number;
  ordenes: number;
  apoyos: number;
  pautas: number;
  actividades: number;
};

export type Informe = Awaited<ReturnType<typeof informe>>;

export async function informe(db: DB, desde: string, hasta: string, ahora = new Date()) {
  const inicio = inicioDelDiaEnChile(desde);
  const fin = inicioDelDiaEnChile(sumarDias(hasta, 1));
  const tope = new Date(Math.min(fin.getTime(), ahora.getTime()));
  const minutosPeriodo = Math.max(0, minutosEntre(inicio, tope) ?? 0);
  const empieza = sql<Date>`coalesce(${solicitudes.detenidaEn}, ${solicitudes.creadaEn})`;

  // ---------- Fallas con detención: downtime, MTTR, MTBF ----------
  const crudas = await db
    .select({
      id: solicitudes.id,
      activoId: solicitudes.activoId,
      activo: activos.nombre,
      planta: plantas.nombre,
      sistema: sectores.nombre,
      categoria: solicitudes.categoria,
      origenReal: solicitudes.origenReal,
      detenidaEn: solicitudes.detenidaEn,
      creadaEn: solicitudes.creadaEn,
      tomadaEn: solicitudes.tomadaEn,
      cerradaEn: solicitudes.cerradaEn,
      otId: solicitudes.otId,
    })
    .from(solicitudes)
    .innerJoin(activos, eq(activos.id, solicitudes.activoId))
    .innerJoin(plantas, eq(plantas.id, activos.plantaId))
    .leftJoin(sectores, eq(sectores.id, solicitudes.sectorId))
    .where(
      and(
        eq(solicitudes.maquinaDetenida, true),
        ne(solicitudes.estado, "ANULADA"),
        lt(empieza, fin),
        or(isNull(solicitudes.cerradaEn), gt(solicitudes.cerradaEn, inicio)),
      ),
    );
  const fallas = crudas.map((f) => ({ ...f, desde: f.detenidaEn ?? f.creadaEn, hasta: f.cerradaEn }));
  const maquinas: FilaMaquina[] = downtimePorMaquina(fallas, inicio, fin, ahora)
    .map((d) => {
      const propias = fallas.filter((f) => f.activoId === d.activoId);
      const iniciadas = propias.filter((f) => f.desde >= inicio && f.desde < tope).length;
      return {
        activoId: d.activoId,
        activo: propias[0].activo,
        planta: propias[0].planta,
        fallas: d.fallas,
        iniciadas,
        abiertas: d.abiertas,
        minutosDetenida: d.minutos,
        pctDetenida: porcentajeDetenida(d.minutos, inicio, fin, ahora),
        mtbf: mtbf(minutosPeriodo, d.minutos, iniciadas),
        ...tiemposDeAtencion(propias, inicio, fin),
      };
    })
    .sort((a, b) => b.minutosDetenida - a.minutosDetenida || a.activo.localeCompare(b.activo, "es"));
  const detalle: FilaFalla[] = fallas
    .flatMap((f) => {
      const a = Math.max(f.desde.getTime(), inicio.getTime());
      const b = Math.min((f.hasta ?? tope).getTime(), tope.getTime());
      const fila: FilaFalla = {
        id: f.id,
        activo: f.activo,
        sistema: f.sistema,
        categoria: f.origenReal ?? f.categoria,
        desde: f.desde,
        tomadaEn: f.tomadaEn,
        hasta: f.hasta,
        conOt: f.otId !== null,
        minutos: Math.max(0, Math.round((b - a) / 60000)),
      };
      // Las mismas fallas que cuenta la tabla por máquina: las que tocan el período.
      return b > a ? [fila] : [];
    })
    .sort((a, b) => b.minutos - a.minutos);
  const detencion = {
    minutos: maquinas.reduce((t, m) => t + m.minutosDetenida, 0),
    fallas: maquinas.reduce((t, m) => t + m.fallas, 0),
    abiertas: maquinas.reduce((t, m) => t + m.abiertas, 0),
    ...tiemposDeAtencion(fallas, inicio, fin),
  };

  // ---------- Solicitudes del período: cuántas se resolvieron sin orden de trabajo ----------
  const delPeriodo = await db
    .select({
      id: solicitudes.id,
      activoId: solicitudes.activoId,
      sectorId: solicitudes.sectorId,
      categoria: solicitudes.categoria,
      origenReal: solicitudes.origenReal,
      estado: solicitudes.estado,
      creadaEn: solicitudes.creadaEn,
      cerradaEn: solicitudes.cerradaEn,
      otId: solicitudes.otId,
    })
    .from(solicitudes)
    .where(
      and(
        ne(solicitudes.estado, "ANULADA"),
        or(and(gte(solicitudes.creadaEn, inicio), lt(solicitudes.creadaEn, fin)), and(gte(solicitudes.cerradaEn, inicio), lt(solicitudes.cerradaEn, fin))),
      ),
    );
  const creadas = delPeriodo.filter((s) => s.creadaEn >= inicio && s.creadaEn < fin);
  const resueltas = delPeriodo.filter(
    (s) => s.cerradaEn && s.cerradaEn >= inicio && s.cerradaEn < fin && (s.estado === "SOLUCIONADA" || s.estado === "CERRADA"),
  );
  const sinOt = resueltas.filter((s) => s.otId === null).length;
  const porCategoria = new Map<Categoria, number>();
  for (const s of creadas) {
    const c = s.origenReal ?? s.categoria;
    porCategoria.set(c, (porCategoria.get(c) ?? 0) + 1);
  }
  const atencion = {
    creadas: creadas.length,
    resueltas: resueltas.length,
    sinOt,
    conOt: resueltas.length - sinOt,
    pctSinOt: porcentaje(sinOt, resueltas.length),
    porCategoria: [...porCategoria.entries()].map(([categoria, cantidad]) => ({ categoria, cantidad })).sort((a, b) => b.cantidad - a.cantidad),
  };

  // ---------- Fallas recurrentes: mismo sistema de la misma máquina ----------
  const repetidas = recurrentesDelPeriodo(creadas, UMBRAL_RECURRENTE);
  const nombresActivo = repetidas.length
    ? await db.select({ id: activos.id, nombre: activos.nombre }).from(activos).where(inArray(activos.id, repetidas.map((r) => r.activoId)))
    : [];
  const nombresSector = repetidas.length
    ? await db.select({ id: sectores.id, nombre: sectores.nombre }).from(sectores).where(inArray(sectores.id, repetidas.map((r) => r.sectorId)))
    : [];
  const recurrentes = repetidas.map((r) => ({
    ...r,
    activo: nombresActivo.find((a) => a.id === r.activoId)?.nombre ?? "—",
    sistema: nombresSector.find((s) => s.id === r.sectorId)?.nombre ?? "—",
  }));

  // ---------- Preventivo: pautas cerradas en el período ----------
  const cerrados = await db
    .select({
      id: ciclosPauta.id,
      activoId: pautas.activoId,
      activo: activos.nombre,
      pauta: pautas.nombre,
      tipo: pautas.tipo,
      unidad: activos.unidadContador,
      estado: ciclosPauta.estado,
      vuelta: ciclosPauta.variante,
      cerradoEn: ciclosPauta.cerradoEn,
      objetivoFecha: ciclosPauta.objetivoFecha,
      objetivoGiros: ciclosPauta.objetivoGiros,
      girosReales: ciclosPauta.girosReales,
      ejecuto: usuarios.nombre,
    })
    .from(ciclosPauta)
    .innerJoin(pautas, eq(pautas.id, ciclosPauta.pautaId))
    .innerJoin(activos, eq(activos.id, pautas.activoId))
    .leftJoin(usuarios, eq(usuarios.id, ciclosPauta.ejecutadoPor))
    .where(and(inArray(ciclosPauta.estado, ["EJECUTADA", "INCUMPLIDA"]), gte(ciclosPauta.cerradoEn, inicio), lt(ciclosPauta.cerradoEn, fin)))
    .orderBy(asc(activos.nombre), asc(ciclosPauta.cerradoEn));
  const n = (x: number | null) => (x === null ? "—" : x.toLocaleString("es-CL"));
  const corta = (iso: string | null) => (iso ? iso.split("-").reverse().join("-") : "—");
  const comoIndicador = (c: (typeof cerrados)[number]): CicloIndicador => ({
    estado: c.estado as "EJECUTADA" | "INCUMPLIDA",
    tipo: c.tipo,
    cerradoFecha: partesEnChile(c.cerradoEn!).fecha,
    objetivoFecha: c.objetivoFecha,
    girosReales: c.girosReales,
    objetivoGiros: c.objetivoGiros,
  });
  const ciclos: FilaCiclo[] = cerrados.map((c) => {
    const i = comoIndicador(c);
    return {
      activo: c.activo,
      pauta: c.pauta,
      vuelta: c.vuelta,
      estado: i.estado,
      aTiempo: esATiempo(i),
      cerradoEn: c.cerradoEn!,
      objetivo: c.tipo === "GIROS" ? `${n(c.objetivoGiros)} ${c.unidad}` : corta(c.objetivoFecha),
      real: i.estado === "INCUMPLIDA" ? "—" : c.tipo === "GIROS" ? `${n(c.girosReales)} ${c.unidad}` : corta(i.cerradoFecha),
      ejecuto: c.ejecuto,
    };
  });
  const preventivoPorMaquina: FilaPreventivo[] = [...new Set(cerrados.map((c) => c.activoId))].map((activoId) => {
    const propios = cerrados.filter((c) => c.activoId === activoId);
    return { activoId, activo: propios[0].activo, ...cumplimiento(propios.map(comoIndicador)) };
  });
  const ejecutados = cerrados.filter((c) => c.estado === "EJECUTADA").map((c) => c.id);
  const actividades = ejecutados.length
    ? await db
        .select({ estado: actividadesCiclo.estado, motivo: actividadesCiclo.motivo, cantidad: sql<number>`count(*)::int` })
        .from(actividadesCiclo)
        .where(inArray(actividadesCiclo.cicloId, ejecutados))
        .groupBy(actividadesCiclo.estado, actividadesCiclo.motivo)
    : [];
  const hechas = actividades.filter((a) => a.estado === "HECHA").reduce((t, a) => t + a.cantidad, 0);
  const noRealizadas = actividades.filter((a) => a.estado === "NO_REALIZADA");
  const preventivo = {
    ...cumplimiento(cerrados.map(comoIndicador)),
    porMaquina: preventivoPorMaquina,
    ciclos,
    actividades: {
      hechas,
      noRealizadas: noRealizadas.reduce((t, a) => t + a.cantidad, 0),
      porMotivo: noRealizadas.map((a) => ({ motivo: a.motivo ?? "OTRO", cantidad: a.cantidad })).sort((a, b) => b.cantidad - a.cantidad),
    },
  };

  // ---------- Trabajo por técnico: cantidades, en orden alfabético y sin posiciones ----------
  const enPeriodo = (columna: Parameters<typeof gte>[0]) => and(gte(columna, inicio), lt(columna, fin));
  const cuenta = sql<number>`count(*)::int`;
  const [tecnicos, porSolicitud, porOt, porApoyo, porPauta, porActividad] = await Promise.all([
    db.select({ id: usuarios.id, nombre: usuarios.nombre }).from(usuarios).where(and(eq(usuarios.perfil, "TECNICO"), eq(usuarios.activo, true))),
    db
      .select({ id: solicitudes.responsableId, cantidad: cuenta })
      .from(solicitudes)
      .where(and(eq(solicitudes.estado, "SOLUCIONADA"), enPeriodo(solicitudes.cerradaEn)))
      .groupBy(solicitudes.responsableId),
    db
      .select({ id: ordenesTrabajo.responsableId, cantidad: cuenta })
      .from(ordenesTrabajo)
      .where(and(eq(ordenesTrabajo.estado, "FINALIZADA"), enPeriodo(ordenesTrabajo.terminoEn)))
      .groupBy(ordenesTrabajo.responsableId),
    db.select({ id: apoyos.usuarioId, cantidad: cuenta }).from(apoyos).where(enPeriodo(apoyos.fecha)).groupBy(apoyos.usuarioId),
    db
      .select({ id: ciclosPauta.ejecutadoPor, cantidad: cuenta })
      .from(ciclosPauta)
      .where(and(eq(ciclosPauta.estado, "EJECUTADA"), isNull(ciclosPauta.incluidoEnCicloId), enPeriodo(ciclosPauta.cerradoEn)))
      .groupBy(ciclosPauta.ejecutadoPor),
    db
      .select({ id: actividadesCiclo.marcadaPor, cantidad: cuenta })
      .from(actividadesCiclo)
      .where(and(eq(actividadesCiclo.estado, "HECHA"), enPeriodo(actividadesCiclo.marcadaEn)))
      .groupBy(actividadesCiclo.marcadaPor),
  ]);
  const de = (lista: { id: number | null; cantidad: number }[], id: number) => lista.find((x) => x.id === id)?.cantidad ?? 0;
  const porTecnico: FilaTecnico[] = tecnicos
    .map((t) => ({
      usuarioId: t.id,
      nombre: t.nombre,
      solicitudes: de(porSolicitud, t.id),
      ordenes: de(porOt, t.id),
      apoyos: de(porApoyo, t.id),
      pautas: de(porPauta, t.id),
      actividades: de(porActividad, t.id),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return { desde, hasta, inicio, fin, tope, minutosPeriodo, maquinas, detalle, detencion, atencion, recurrentes, preventivo, porTecnico };
}
