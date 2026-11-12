// Downtime por falla: tiempo que una máquina estuvo detenida por fallas dentro de un período.
// Funciones puras, sin base de datos.

export type FallaConDetencion = {
  activoId: number;
  /** Cuándo se detuvo la máquina: la hora de Metrics si existe; si no, la del reporte. */
  desde: Date;
  /** Cuándo se resolvió. null = sigue abierta. */
  hasta: Date | null;
};

export type DowntimeMaquina = {
  activoId: number;
  /** Minutos detenida dentro del período, sin contar dos veces las fallas simultáneas. */
  minutos: number;
  /** Fallas con detención que tocan el período. */
  fallas: number;
  /** De ellas, cuántas siguen abiertas (su tiempo se cuenta hasta `ahora`). */
  abiertas: number;
};

/**
 * Downtime por máquina entre `inicio` y `fin`.
 * - Cada falla cuenta solo por la parte que cae dentro del período.
 * - Una falla abierta cuenta hasta `ahora` (o hasta el fin del período, lo que ocurra primero).
 * - Si dos fallas de la misma máquina se superponen (una mecánica y una eléctrica a la vez),
 *   ese rato se cuenta una sola vez: la máquina estuvo detenida una vez, no dos.
 */
export function downtimePorMaquina(fallas: FallaConDetencion[], inicio: Date, fin: Date, ahora: Date): DowntimeMaquina[] {
  const tope = Math.min(fin.getTime(), ahora.getTime());
  const porMaquina = new Map<number, { tramos: [number, number][]; fallas: number; abiertas: number }>();
  for (const f of fallas) {
    const a = Math.max(f.desde.getTime(), inicio.getTime());
    const b = Math.min(f.hasta ? f.hasta.getTime() : tope, tope);
    if (b <= a) continue;
    const m = porMaquina.get(f.activoId) ?? { tramos: [], fallas: 0, abiertas: 0 };
    m.tramos.push([a, b]);
    m.fallas++;
    if (!f.hasta) m.abiertas++;
    porMaquina.set(f.activoId, m);
  }
  return [...porMaquina.entries()].map(([activoId, m]) => {
    const ordenados = m.tramos.sort((x, y) => x[0] - y[0]);
    let total = 0;
    let [desde, hasta] = ordenados[0];
    for (const [a, b] of ordenados.slice(1)) {
      if (a <= hasta) hasta = Math.max(hasta, b);
      else {
        total += hasta - desde;
        [desde, hasta] = [a, b];
      }
    }
    total += hasta - desde;
    return { activoId, minutos: Math.round(total / 60000), fallas: m.fallas, abiertas: m.abiertas };
  });
}

/** Porcentaje del período que la máquina estuvo detenida por fallas, con un decimal. */
export function porcentajeDetenida(minutos: number, inicio: Date, fin: Date, ahora: Date): number {
  const total = (Math.min(fin.getTime(), ahora.getTime()) - inicio.getTime()) / 60000;
  return total <= 0 ? 0 : Math.round((minutos / total) * 1000) / 10;
}
