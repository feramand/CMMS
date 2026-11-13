/**
 * Falla recurrente: mismo sector de una máquina, `umbral` o más veces dentro de los últimos `dias` días.
 * Devuelve los sectores que cumplen, con su cantidad, de mayor a menor.
 */
export function fallasRecurrentes(
  filas: { sector: string | null; creadaEn: Date }[],
  ahora: Date = new Date(),
  dias = 30,
  umbral = 3,
): { sector: string; veces: number }[] {
  const desde = ahora.getTime() - dias * 24 * 60 * 60 * 1000;
  const porSector = new Map<string, number>();
  for (const f of filas) {
    if (f.sector && f.creadaEn.getTime() >= desde && f.creadaEn.getTime() <= ahora.getTime()) {
      porSector.set(f.sector, (porSector.get(f.sector) ?? 0) + 1);
    }
  }
  return [...porSector]
    .filter(([, veces]) => veces >= umbral)
    .map(([sector, veces]) => ({ sector, veces }))
    .sort((a, b) => b.veces - a.veces);
}

// ---------- Indicadores de un período: funciones puras, sin base de datos ----------

/** Promedio redondeado al entero; null si no hay datos. */
export function promedio(valores: number[]): number | null {
  return valores.length === 0 ? null : Math.round(valores.reduce((t, v) => t + v, 0) / valores.length);
}

/** Porcentaje con un decimal; null si el total es cero. */
export function porcentaje(parte: number, total: number): number | null {
  return total === 0 ? null : Math.round((parte / total) * 1000) / 10;
}

const minutos = (desde: Date, hasta: Date) => (hasta.getTime() - desde.getTime()) / 60000;

export type FallaIndicador = {
  activoId: number;
  /** Cuándo se detuvo la máquina: la hora de Metrics si existe; si no, la del reporte. */
  desde: Date;
  /** Cuándo llegó el aviso a mantenimiento. */
  creadaEn: Date;
  /** Cuándo la tomó un técnico. null = nadie la ha tomado. */
  tomadaEn: Date | null;
  /** Cuándo quedó resuelta. null = sigue abierta. */
  hasta: Date | null;
};

export type Tiempos = {
  /** Fallas resueltas dentro del período: sobre ellas se promedian los tiempos. */
  resueltas: number;
  /** MTTR: promedio en minutos desde que la máquina se detiene hasta que la falla queda resuelta. */
  mttr: number | null;
  /** Promedio en minutos desde que llega el aviso hasta que un técnico lo toma. */
  respuesta: number | null;
  /** Promedio en minutos desde que el técnico lo toma hasta que queda resuelto. */
  reparacion: number | null;
};

/**
 * Tiempos de atención de las fallas resueltas entre `inicio` y `fin`. Cada falla cuenta con su
 * duración completa, aunque haya empezado antes del período.
 */
export function tiemposDeAtencion(fallas: FallaIndicador[], inicio: Date, fin: Date): Tiempos {
  const resueltas = fallas.filter((f) => f.hasta && f.hasta >= inicio && f.hasta < fin);
  const tomadas = resueltas.filter((f) => f.tomadaEn);
  return {
    resueltas: resueltas.length,
    mttr: promedio(resueltas.map((f) => minutos(f.desde, f.hasta!))),
    respuesta: promedio(tomadas.map((f) => Math.max(0, minutos(f.creadaEn, f.tomadaEn!)))),
    reparacion: promedio(tomadas.map((f) => Math.max(0, minutos(f.tomadaEn!, f.hasta!)))),
  };
}

/**
 * MTBF en minutos: tiempo que la máquina estuvo sin fallas dividido por las fallas que empezaron
 * en el período. Tiempo sin fallas = tiempo calendario transcurrido del período − tiempo detenida.
 * null si no hubo fallas (no se puede calcular con cero).
 */
export function mtbf(minutosPeriodo: number, minutosDetenida: number, fallasIniciadas: number): number | null {
  return fallasIniciadas === 0 ? null : Math.round(Math.max(0, minutosPeriodo - minutosDetenida) / fallasIniciadas);
}

export type CicloIndicador = {
  estado: "EJECUTADA" | "INCUMPLIDA";
  tipo: "TIEMPO" | "GIROS";
  /** Fecha de Chile (AAAA-MM-DD) en que se cerró. */
  cerradoFecha: string;
  objetivoFecha: string | null;
  girosReales: number | null;
  objetivoGiros: number | null;
};

export type Cumplimiento = {
  /** Ejecutadas antes o justo en el 100 % del intervalo. */
  aTiempo: number;
  /** Ejecutadas pasado el 100 % pero antes del límite. */
  conAtraso: number;
  /** Llegaron al límite sin ejecutarse. */
  incumplidas: number;
  total: number;
  /** Ejecutadas (a tiempo o con atraso) sobre el total, con un decimal. */
  pctCumplimiento: number | null;
  pctATiempo: number | null;
};

export function esATiempo(c: CicloIndicador): boolean {
  if (c.estado !== "EJECUTADA") return false;
  if (c.tipo === "GIROS") return c.girosReales !== null && c.objetivoGiros !== null && c.girosReales <= c.objetivoGiros;
  return c.objetivoFecha !== null && c.cerradoFecha <= c.objetivoFecha;
}

export function cumplimiento(ciclos: CicloIndicador[]): Cumplimiento {
  const aTiempo = ciclos.filter(esATiempo).length;
  const ejecutadas = ciclos.filter((c) => c.estado === "EJECUTADA").length;
  const total = ciclos.length;
  return {
    aTiempo,
    conAtraso: ejecutadas - aTiempo,
    incumplidas: total - ejecutadas,
    total,
    pctCumplimiento: porcentaje(ejecutadas, total),
    pctATiempo: porcentaje(aTiempo, total),
  };
}

/** Sistemas de una máquina que fallaron `umbral` o más veces en el período, de mayor a menor. */
export function recurrentesDelPeriodo<T extends { activoId: number; sectorId: number | null }>(
  filas: T[],
  umbral = 3,
): { activoId: number; sectorId: number; veces: number }[] {
  const cuenta = new Map<string, { activoId: number; sectorId: number; veces: number }>();
  for (const f of filas) {
    if (f.sectorId === null) continue;
    const clave = `${f.activoId}-${f.sectorId}`;
    const g = cuenta.get(clave) ?? { activoId: f.activoId, sectorId: f.sectorId, veces: 0 };
    g.veces++;
    cuenta.set(clave, g);
  }
  return [...cuenta.values()].filter((g) => g.veces >= umbral).sort((a, b) => b.veces - a.veces || a.activoId - b.activoId || a.sectorId - b.sectorId);
}
