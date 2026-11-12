const ZONA = "America/Santiago";

/** Año calendario en la zona horaria de la planta. */
export function anioEnChile(fecha: Date): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric" }).format(fecha));
}

/** Folio de OT: dos dígitos del año + correlativo de al menos 4 dígitos. Ej.: 260001. */
export function formatoFolio(anio: number, correlativo: number): string {
  return `${String(anio % 100).padStart(2, "0")}${String(correlativo).padStart(4, "0")}`;
}

/** Minutos enteros entre dos instantes, o null si falta alguno. */
export function minutosEntre(desde: Date | null, hasta: Date | null): number | null {
  if (!desde || !hasta) return null;
  return Math.round((hasta.getTime() - desde.getTime()) / 60000);
}

export function duracion(minutos: number | null): string {
  if (minutos === null) return "—";
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function fechaHora(fecha: Date | null): string {
  if (!fecha) return "—";
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(fecha);
}

/** Fecha (AAAA-MM-DD), día de la semana (1 = lunes … 7 = domingo) y minutos desde medianoche, en hora de Chile. */
export function partesEnChile(fecha: Date): { fecha: string; diaSemana: number; minutos: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha);
  const v = (tipo: string) => partes.find((p) => p.type === tipo)!.value;
  const dias = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return {
    fecha: `${v("year")}-${v("month")}-${v("day")}`,
    diaSemana: dias.indexOf(v("weekday")) + 1,
    minutos: Number(v("hour")) * 60 + Number(v("minute")),
  };
}

/** Instante en que empieza un día (AAAA-MM-DD) en la hora de Chile, con o sin horario de verano. */
export function inicioDelDiaEnChile(fecha: string): Date {
  const [a, m, d] = fecha.split("-").map(Number);
  // Chile está entre 3 y 5 horas detrás de UTC: se prueba cada posibilidad.
  for (const horas of [3, 4, 5]) {
    const candidato = new Date(Date.UTC(a, m - 1, d, horas));
    const p = partesEnChile(candidato);
    if (p.fecha === fecha && p.minutos === 0) return candidato;
  }
  return new Date(Date.UTC(a, m - 1, d, 4));
}
