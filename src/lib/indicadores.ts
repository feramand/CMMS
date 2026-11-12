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
