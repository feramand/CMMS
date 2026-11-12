import { describe, expect, it } from "vitest";
import { downtimePorMaquina, porcentajeDetenida } from "./downtime";
import { inicioDelDiaEnChile } from "./tiempo";

const t = (iso: string) => new Date(iso);
const inicio = t("2026-11-01T03:00:00Z"); // 1 de noviembre 00:00 en Chile
const fin = t("2026-12-01T03:00:00Z");
const ahora = t("2026-11-12T15:00:00Z");

describe("downtime por falla", () => {
  it("suma el tiempo detenido de cada máquina dentro del período", () => {
    const r = downtimePorMaquina(
      [
        { activoId: 1, desde: t("2026-11-03T12:00:00Z"), hasta: t("2026-11-03T12:45:00Z") },
        { activoId: 1, desde: t("2026-11-05T10:00:00Z"), hasta: t("2026-11-05T12:30:00Z") },
        { activoId: 2, desde: t("2026-11-04T08:00:00Z"), hasta: t("2026-11-04T08:20:00Z") },
      ],
      inicio, fin, ahora,
    );
    expect(r).toEqual([
      { activoId: 1, minutos: 195, fallas: 2, abiertas: 0 },
      { activoId: 2, minutos: 20, fallas: 1, abiertas: 0 },
    ]);
  });

  it("no cuenta dos veces las fallas simultáneas de una misma máquina", () => {
    const r = downtimePorMaquina(
      [
        { activoId: 1, desde: t("2026-11-03T12:00:00Z"), hasta: t("2026-11-03T13:00:00Z") },
        { activoId: 1, desde: t("2026-11-03T12:30:00Z"), hasta: t("2026-11-03T14:00:00Z") },
        { activoId: 1, desde: t("2026-11-03T12:40:00Z"), hasta: t("2026-11-03T12:50:00Z") },
      ],
      inicio, fin, ahora,
    );
    // De 12:00 a 14:00: 120 minutos, no 60 + 90 + 10.
    expect(r).toEqual([{ activoId: 1, minutos: 120, fallas: 3, abiertas: 0 }]);
  });

  it("recorta las fallas que empiezan antes o terminan después del período", () => {
    const r = downtimePorMaquina(
      [
        { activoId: 1, desde: t("2026-10-31T23:00:00Z"), hasta: t("2026-11-01T04:00:00Z") }, // solo 60 min caen en noviembre
        { activoId: 1, desde: t("2026-10-20T10:00:00Z"), hasta: t("2026-10-20T11:00:00Z") }, // fuera del período
      ],
      inicio, fin, ahora,
    );
    expect(r).toEqual([{ activoId: 1, minutos: 60, fallas: 1, abiertas: 0 }]);
  });

  it("una falla abierta cuenta hasta ahora, o hasta el fin de un período ya pasado", () => {
    const abierta = [{ activoId: 1, desde: t("2026-11-12T14:00:00Z"), hasta: null }];
    expect(downtimePorMaquina(abierta, inicio, fin, ahora)).toEqual([{ activoId: 1, minutos: 60, fallas: 1, abiertas: 1 }]);
    const vieja = [{ activoId: 1, desde: t("2026-10-31T02:00:00Z"), hasta: null }];
    expect(downtimePorMaquina(vieja, t("2026-10-01T03:00:00Z"), inicio, ahora)).toEqual([{ activoId: 1, minutos: 1500, fallas: 1, abiertas: 1 }]);
  });

  it("calcula el porcentaje del período transcurrido", () => {
    // Del 1 al 12 de noviembre a las 12:00 de Chile: 11,5 días = 16.560 minutos.
    expect(porcentajeDetenida(1656, inicio, fin, ahora)).toBe(10);
    expect(porcentajeDetenida(195, inicio, fin, ahora)).toBe(1.2);
  });

  it("convierte una fecha de Chile en su medianoche, con horario de verano e invierno", () => {
    expect(inicioDelDiaEnChile("2026-11-01").toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(inicioDelDiaEnChile("2026-07-01").toISOString()).toBe("2026-07-01T04:00:00.000Z");
  });
});
