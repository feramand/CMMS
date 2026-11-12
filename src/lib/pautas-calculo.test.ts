import { describe, expect, it } from "vitest";
import { avance, diasEntre, esFechaValida, hitosFecha, hitosGiros, porcentajesValidos, sumarDias } from "./pautas-calculo";

const P = { liberacion: 80, limite: 120 };

describe("hitos de una pauta", () => {
  it("por giros: libera al 80 %, objetivo al 100 %, incumplida al 120 %", () => {
    expect(hitosGiros(0, 500_000, P)).toEqual({ liberacion: 400_000, objetivo: 500_000, limite: 600_000 });
    // Tras una incumplida (opción A) la base es el objetivo anterior.
    expect(hitosGiros(500_000, 500_000, P)).toEqual({ liberacion: 900_000, objetivo: 1_000_000, limite: 1_100_000 });
    // Tras una ejecución la base es el contador real.
    expect(hitosGiros(523_400, 500_000, P)).toEqual({ liberacion: 923_400, objetivo: 1_023_400, limite: 1_123_400 });
  });

  it("por tiempo: mensual desde el 1 de marzo libera el 25, objetivo 31 de marzo, límite 6 de abril", () => {
    expect(hitosFecha("2026-03-01", 30, P)).toEqual({ liberacion: "2026-03-25", objetivo: "2026-03-31", limite: "2026-04-06" });
  });

  it("por tiempo: una pauta semanal se libera el día 6 y vence el día 8", () => {
    expect(hitosFecha("2026-11-01", 7, P)).toEqual({ liberacion: "2026-11-07", objetivo: "2026-11-08", limite: "2026-11-09" });
  });

  it("admite porcentajes propios de la pauta", () => {
    expect(hitosGiros(0, 1_000_000, { liberacion: 90, limite: 110 })).toEqual({ liberacion: 900_000, objetivo: 1_000_000, limite: 1_100_000 });
    expect(porcentajesValidos({ liberacion: 90, limite: 110 })).toBe(true);
    expect(porcentajesValidos({ liberacion: 0, limite: 120 })).toBe(false);
    expect(porcentajesValidos({ liberacion: 80, limite: 99 })).toBe(false);
  });

  it("suma días cruzando meses, años y bisiestos", () => {
    expect(sumarDias("2026-12-25", 10)).toBe("2027-01-04");
    expect(sumarDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(diasEntre("2026-03-01", "2026-04-06")).toBe(36);
  });

  it("calcula el avance y valida fechas", () => {
    expect(avance(0, 500_000, 430_000)).toBe(86);
    expect(avance(500_000, 1_000_000, 500_000)).toBe(0);
    expect(avance(0, 500_000, 610_000)).toBe(122);
    expect(esFechaValida("2026-02-30")).toBe(false);
    expect(esFechaValida("2026-02-28")).toBe(true);
  });
});
