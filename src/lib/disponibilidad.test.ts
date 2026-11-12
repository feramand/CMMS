import { describe, expect, it } from "vitest";
import { diasDe, estaDisponible, type FichaDisponibilidad } from "./disponibilidad";
import { partesEnChile } from "./tiempo";

// Noviembre de 2026 en Santiago: UTC−3. El 12 es jueves.
const t = (texto: string) => new Date(`${texto}:00-03:00`);

const fijo = (dias: string | null, entrada: string | null, salida: string | null): FichaDisponibilidad => ({
  modalidad: "HORARIO_FIJO", enTurno: false, turnoDesde: null, diasLaborales: dias, horaEntrada: entrada, horaSalida: salida,
});
const turnos = (enTurno: boolean, desde: Date | null): FichaDisponibilidad => ({
  modalidad: "TURNOS", enTurno, turnoDesde: desde, diasLaborales: null, horaEntrada: null, horaSalida: null,
});

describe("hora local de Chile", () => {
  it("entrega fecha, día de la semana y minutos", () => {
    expect(partesEnChile(t("2026-11-12T08:30"))).toEqual({ fecha: "2026-11-12", diaSemana: 4, minutos: 510 });
    expect(partesEnChile(t("2026-11-15T23:59"))).toEqual({ fecha: "2026-11-15", diaSemana: 7, minutos: 1439 });
    // 02:00 UTC del viernes 13 todavía es jueves 12 a las 23:00 en Santiago.
    expect(partesEnChile(new Date("2026-11-13T02:00:00Z"))).toEqual({ fecha: "2026-11-12", diaSemana: 4, minutos: 1380 });
    expect(partesEnChile(t("2026-11-16T00:00"))).toEqual({ fecha: "2026-11-16", diaSemana: 1, minutos: 0 });
  });
});

describe("técnico de horario fijo", () => {
  const lunesAViernes = fijo("1,2,3,4,5", "08:00", "18:00");
  it("está disponible dentro de su horario y no fuera de él", () => {
    expect(estaDisponible(lunesAViernes, t("2026-11-12T08:00"))).toBe(true);
    expect(estaDisponible(lunesAViernes, t("2026-11-12T12:30"))).toBe(true);
    expect(estaDisponible(lunesAViernes, t("2026-11-12T17:59"))).toBe(true);
    expect(estaDisponible(lunesAViernes, t("2026-11-12T07:59"))).toBe(false);
    expect(estaDisponible(lunesAViernes, t("2026-11-12T18:00"))).toBe(false);
  });
  it("no está disponible el fin de semana ni en feriado", () => {
    expect(estaDisponible(lunesAViernes, t("2026-11-14T10:00"))).toBe(false); // sábado
    expect(estaDisponible(lunesAViernes, t("2026-11-15T10:00"))).toBe(false); // domingo
    expect(estaDisponible(lunesAViernes, t("2026-11-12T10:00"), new Set(["2026-11-12"]))).toBe(false);
    expect(estaDisponible(lunesAViernes, t("2026-11-13T10:00"), new Set(["2026-11-12"]))).toBe(true);
  });
  it("sin horario definido se considera siempre disponible", () => {
    expect(estaDisponible(fijo(null, null, null), t("2026-11-15T03:00"))).toBe(true);
    expect(estaDisponible(fijo("1,2", null, null), t("2026-11-15T03:00"))).toBe(true);
  });
  it("un horario nocturno pertenece al día en que empieza", () => {
    const noche = fijo("1,2,3,4,5", "22:00", "07:00");
    expect(estaDisponible(noche, t("2026-11-13T23:00"))).toBe(true); // viernes 23:00
    expect(estaDisponible(noche, t("2026-11-14T06:59"))).toBe(true); // sábado de madrugada: jornada del viernes
    expect(estaDisponible(noche, t("2026-11-14T07:00"))).toBe(false);
    expect(estaDisponible(noche, t("2026-11-14T23:00"))).toBe(false); // sábado no trabaja
    expect(estaDisponible(noche, t("2026-11-16T03:00"))).toBe(false); // lunes de madrugada: el domingo no trabajó
    expect(estaDisponible(noche, t("2026-11-12T12:00"))).toBe(false);
    // Feriado el viernes 13: no entra esa noche ni cuenta la madrugada del sábado.
    const feriado = new Set(["2026-11-13"]);
    expect(estaDisponible(noche, t("2026-11-13T23:00"), feriado)).toBe(false);
    expect(estaDisponible(noche, t("2026-11-14T03:00"), feriado)).toBe(false);
    // La madrugada del propio viernes 13 pertenece a la jornada del jueves 12, que sí se trabajó.
    expect(estaDisponible(noche, t("2026-11-13T03:00"), feriado)).toBe(true);
  });
  it("interpreta la lista de días", () => {
    expect(diasDe("1,2,3,4,5")).toEqual([1, 2, 3, 4, 5]);
    expect(diasDe("6, 7")).toEqual([6, 7]);
    expect(diasDe("0,8,x,3")).toEqual([3]);
    expect(diasDe(null)).toEqual([]);
  });
});

describe("técnico de turnos rotativos", () => {
  it("depende del interruptor de turno, sin importar el día o la hora", () => {
    expect(estaDisponible(turnos(true, t("2026-11-15T02:00")), t("2026-11-15T03:00"))).toBe(true);
    expect(estaDisponible(turnos(false, null), t("2026-11-12T10:00"))).toBe(false);
  });
  it("el turno se apaga solo a las 12 horas", () => {
    const inicio = t("2026-11-12T07:00");
    expect(estaDisponible(turnos(true, inicio), t("2026-11-12T18:59"))).toBe(true);
    expect(estaDisponible(turnos(true, inicio), t("2026-11-12T19:00"))).toBe(false);
    expect(estaDisponible(turnos(true, inicio), t("2026-11-12T19:00"), new Set(), 14)).toBe(true);
  });
});
