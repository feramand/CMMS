// Disponibilidad laboral de un técnico: decide si recibe avisos de nuevas solicitudes.
import type { Modalidad } from "@/db/schema";
import { partesEnChile } from "./tiempo";

export type FichaDisponibilidad = {
  modalidad: Modalidad;
  enTurno: boolean;
  turnoDesde: Date | null;
  /** Días laborales, 1 = lunes … 7 = domingo, separados por coma. Null = sin horario definido. */
  diasLaborales: string | null;
  horaEntrada: string | null;
  horaSalida: string | null;
};

export const HORAS_APAGADO_TURNO = 12;

function aMinutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

export function diasDe(texto: string | null): number[] {
  return (texto ?? "")
    .split(",")
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
}

/**
 * - Turnos rotativos: disponible mientras tenga "Estoy de turno" activado, por un máximo de
 *   `horasApagado` horas (por si olvida desactivarlo).
 * - Horario fijo: disponible dentro de su horario semanal, salvo feriados. Sin horario definido,
 *   se considera siempre disponible. Un horario que cruza la medianoche pertenece al día en que empieza.
 */
export function estaDisponible(
  f: FichaDisponibilidad,
  ahora: Date,
  feriados: ReadonlySet<string> = new Set(),
  horasApagado: number = HORAS_APAGADO_TURNO,
): boolean {
  if (f.modalidad === "TURNOS") {
    if (!f.enTurno) return false;
    if (!f.turnoDesde) return true;
    return ahora.getTime() - f.turnoDesde.getTime() < horasApagado * 60 * 60 * 1000;
  }
  const dias = diasDe(f.diasLaborales);
  if (dias.length === 0 || !f.horaEntrada || !f.horaSalida) return true;
  const entrada = aMinutos(f.horaEntrada);
  const salida = aMinutos(f.horaSalida);
  const hoy = partesEnChile(ahora);
  const trabajaHoy = dias.includes(hoy.diaSemana) && !feriados.has(hoy.fecha);
  if (salida > entrada) return trabajaHoy && hoy.minutos >= entrada && hoy.minutos < salida;
  // Cruza la medianoche: la parte de la madrugada pertenece a la jornada que empezó ayer.
  const ayer = partesEnChile(new Date(ahora.getTime() - 24 * 60 * 60 * 1000));
  const trabajoAyer = dias.includes(ayer.diaSemana) && !feriados.has(ayer.fecha);
  return (trabajaHoy && hoy.minutos >= entrada) || (trabajoAyer && hoy.minutos < salida);
}
