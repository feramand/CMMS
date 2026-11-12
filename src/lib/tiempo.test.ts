import { describe, expect, it } from "vitest";
import { anioEnChile, duracion, formatoFolio, minutosEntre } from "./tiempo";

describe("folio de OT", () => {
  it("usa dos dígitos de año y correlativo de 4 dígitos", () => {
    expect(formatoFolio(2026, 1)).toBe("260001");
    expect(formatoFolio(2026, 14)).toBe("260014");
    expect(formatoFolio(2026, 9999)).toBe("269999");
    expect(formatoFolio(2030, 7)).toBe("300007");
  });
  it("crece a 5 dígitos si se superan las 9.999 órdenes del año", () => {
    expect(formatoFolio(2026, 10000)).toBe("2610000");
  });
  it("toma el año según la hora de Chile, no UTC", () => {
    // 1 de enero 02:00 UTC es todavía 31 de diciembre 23:00 en Santiago (UTC−3).
    expect(anioEnChile(new Date("2027-01-01T02:00:00Z"))).toBe(2026);
    expect(anioEnChile(new Date("2027-01-01T03:00:00Z"))).toBe(2027);
  });
});

describe("tiempos", () => {
  it("calcula minutos entre dos instantes", () => {
    const a = new Date("2026-11-11T10:47:00-03:00");
    expect(minutosEntre(a, new Date("2026-11-11T10:51:00-03:00"))).toBe(4);
    expect(minutosEntre(a, new Date("2026-11-11T12:07:00-03:00"))).toBe(80);
    expect(minutosEntre(a, null)).toBeNull();
  });
  it("escribe la duración en horas y minutos", () => {
    expect(duracion(18)).toBe("18 min");
    expect(duracion(60)).toBe("1 h");
    expect(duracion(80)).toBe("1 h 20 min");
    expect(duracion(130)).toBe("2 h 10 min");
    expect(duracion(null)).toBe("—");
  });
});
