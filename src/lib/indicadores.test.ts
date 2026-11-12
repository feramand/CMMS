import { describe, expect, it } from "vitest";
import { fallasRecurrentes } from "./indicadores";

const ahora = new Date("2026-11-30T12:00:00-03:00");
const hace = (dias: number) => new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);

describe("fallas recurrentes", () => {
  it("marca un sector con 3 o más fallas en 30 días", () => {
    const filas = [
      { sector: "Marcador", creadaEn: hace(1) },
      { sector: "Marcador", creadaEn: hace(10) },
      { sector: "Marcador", creadaEn: hace(29) },
      { sector: "Salida", creadaEn: hace(2) },
      { sector: "Salida", creadaEn: hace(3) },
    ];
    expect(fallasRecurrentes(filas, ahora)).toEqual([{ sector: "Marcador", veces: 3 }]);
  });
  it("no cuenta las fallas de hace más de 30 días ni las que no tienen sector", () => {
    const filas = [
      { sector: "Marcador", creadaEn: hace(1) },
      { sector: "Marcador", creadaEn: hace(2) },
      { sector: "Marcador", creadaEn: hace(31) },
      { sector: null, creadaEn: hace(1) },
      { sector: null, creadaEn: hace(1) },
      { sector: null, creadaEn: hace(1) },
    ];
    expect(fallasRecurrentes(filas, ahora)).toEqual([]);
  });
  it("incluye el límite exacto de 30 días y ordena de mayor a menor", () => {
    const filas = [
      ...[0, 5, 30].map((d) => ({ sector: "Salida", creadaEn: hace(d) })),
      ...[1, 2, 3, 4].map((d) => ({ sector: "Marcador", creadaEn: hace(d) })),
    ];
    expect(fallasRecurrentes(filas, ahora)).toEqual([
      { sector: "Marcador", veces: 4 },
      { sector: "Salida", veces: 3 },
    ]);
  });
  it("respeta un umbral y un período configurados", () => {
    const filas = [0, 1].map((d) => ({ sector: "Salida", creadaEn: hace(d) }));
    expect(fallasRecurrentes(filas, ahora, 7, 2)).toEqual([{ sector: "Salida", veces: 2 }]);
  });
});
