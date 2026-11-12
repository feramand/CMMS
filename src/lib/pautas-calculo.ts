// Cálculo de los hitos de una pauta: funciones puras, sin base de datos.
// Regla común: desde una base y un intervalo, la pauta se libera al pctLiberacion (80 %),
// tiene su objetivo al 100 % y queda incumplida al pctLimite (120 %).

export type Porcentajes = { liberacion: number; limite: number };

export const PORCENTAJES_POR_DEFECTO: Porcentajes = { liberacion: 80, limite: 120 };

export function porcentajesValidos(p: Porcentajes): boolean {
  return (
    Number.isInteger(p.liberacion) && Number.isInteger(p.limite) &&
    p.liberacion >= 1 && p.liberacion <= 100 && p.limite >= 100 && p.limite <= 300
  );
}

/** Hitos en giros. Ej.: base 0, intervalo 500.000 → libera 400.000, objetivo 500.000, límite 600.000. */
export function hitosGiros(base: number, intervalo: number, p: Porcentajes) {
  return {
    liberacion: base + Math.round((intervalo * p.liberacion) / 100),
    objetivo: base + intervalo,
    limite: base + Math.round((intervalo * p.limite) / 100),
  };
}

/** Suma días a una fecha AAAA-MM-DD. */
export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Días completos desde `desde` hasta `hasta` (AAAA-MM-DD). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

/**
 * Hitos en fechas, redondeados al día. Ej.: mensual (30 días) desde el 1 de marzo →
 * libera el 25 de marzo, objetivo 31 de marzo, límite 6 de abril.
 */
export function hitosFecha(base: string, dias: number, p: Porcentajes) {
  return {
    liberacion: sumarDias(base, Math.round((dias * p.liberacion) / 100)),
    objetivo: sumarDias(base, dias),
    limite: sumarDias(base, Math.round((dias * p.limite) / 100)),
  };
}

/** Avance del intervalo en porcentaje entero (puede pasar de 100). */
export function avance(base: number, objetivo: number, actual: number): number {
  if (objetivo <= base) return 0;
  return Math.max(0, Math.round(((actual - base) / (objetivo - base)) * 100));
}

export function esFechaValida(fecha: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !Number.isNaN(Date.parse(`${fecha}T00:00:00Z`)) && sumarDias(fecha, 0) === fecha;
}

export type GrupoVista = { operador: true } | { operador: false; especialidadId: number };
type ActividadDeCiclo = { estado: string; operador: boolean; especialidadId: number | null };

/**
 * Parte de una cartilla liberada que le toca a un grupo (los operadores o una especialidad).
 * Una cartilla sin checklist la ejecuta su especialidad responsable.
 */
export function parteDelGrupo(checklist: ActividadDeCiclo[], grupo: GrupoVista, especialidadResponsable: number) {
  const esMia = (a: ActividadDeCiclo) => (grupo.operador ? a.operador : a.especialidadId === grupo.especialidadId);
  const mias = checklist.filter(esMia);
  const sinChecklist = checklist.length === 0 && !grupo.operador && grupo.especialidadId === especialidadResponsable;
  return {
    miParte: { total: mias.length, hechas: mias.filter((a) => a.estado !== "PENDIENTE").length },
    pendientesDeOtros: checklist.filter((a) => !esMia(a) && a.estado === "PENDIENTE").length,
    participa: mias.length > 0 || sinChecklist,
  };
}
