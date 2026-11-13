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

describe("indicadores del período", () => {
  const t = (texto: string) => new Date(`2026-11-${texto}:00-03:00`);
  const inicio = t("01T00:00");
  const fin = new Date("2026-12-01T00:00:00-03:00");
  const falla = (desde: string, creada: string, tomada: string | null, hasta: string | null) => ({
    activoId: 1, desde: t(desde), creadaEn: t(creada), tomadaEn: tomada ? t(tomada) : null, hasta: hasta ? t(hasta) : null,
  });

  it("MTTR, respuesta y reparación se promedian sobre las fallas resueltas en el período", async () => {
    const { tiemposDeAtencion } = await import("./indicadores");
    const fallas = [
      // Detenida 10:00, aviso 10:05, tomada 10:15, resuelta 11:00 → MTTR 60, respuesta 10, reparación 45.
      falla("10T10:00", "10T10:05", "10T10:15", "10T11:00"),
      // Detenida y avisada 08:00, tomada 08:30, resuelta 10:00 → MTTR 120, respuesta 30, reparación 90.
      falla("12T08:00", "12T08:00", "12T08:30", "12T10:00"),
      // Abierta: no entra en los promedios.
      falla("20T09:00", "20T09:00", "20T09:10", null),
    ];
    expect(tiemposDeAtencion(fallas, inicio, fin)).toEqual({ resueltas: 2, mttr: 90, respuesta: 20, reparacion: 68 });
    // Resuelta fuera del período: no cuenta.
    expect(tiemposDeAtencion(fallas, t("11T00:00"), t("12T00:00"))).toEqual({ resueltas: 0, mttr: null, respuesta: null, reparacion: null });
  });

  it("una falla que empezó antes del período cuenta con su duración completa si se resolvió dentro", async () => {
    const { tiemposDeAtencion } = await import("./indicadores");
    const larga = { activoId: 1, desde: new Date("2026-10-31T22:00:00-03:00"), creadaEn: new Date("2026-10-31T22:00:00-03:00"), tomadaEn: null, hasta: t("01T02:00") };
    expect(tiemposDeAtencion([larga], inicio, fin)).toEqual({ resueltas: 1, mttr: 240, respuesta: null, reparacion: null });
  });

  it("MTBF: tiempo sin fallas dividido por las fallas del período", async () => {
    const { mtbf, porcentaje, promedio } = await import("./indicadores");
    // 30 días = 43.200 min; 300 min detenida; 3 fallas → (43.200 − 300) / 3 = 14.300 min.
    expect(mtbf(43_200, 300, 3)).toBe(14_300);
    expect(mtbf(43_200, 0, 0)).toBeNull();
    expect(porcentaje(2, 3)).toBe(66.7);
    expect(porcentaje(0, 0)).toBeNull();
    expect(promedio([])).toBeNull();
  });

  it("cumplimiento preventivo: a tiempo, con atraso e incumplidas", async () => {
    const { cumplimiento } = await import("./indicadores");
    const base = { girosReales: null, objetivoGiros: null, objetivoFecha: null };
    const ciclos = [
      { ...base, estado: "EJECUTADA" as const, tipo: "TIEMPO" as const, cerradoFecha: "2026-11-15", objetivoFecha: "2026-11-15" },
      { ...base, estado: "EJECUTADA" as const, tipo: "TIEMPO" as const, cerradoFecha: "2026-11-17", objetivoFecha: "2026-11-15" },
      { ...base, estado: "EJECUTADA" as const, tipo: "GIROS" as const, cerradoFecha: "2026-11-20", girosReales: 480_000, objetivoGiros: 500_000 },
      { ...base, estado: "EJECUTADA" as const, tipo: "GIROS" as const, cerradoFecha: "2026-11-20", girosReales: 560_000, objetivoGiros: 500_000 },
      { ...base, estado: "INCUMPLIDA" as const, tipo: "TIEMPO" as const, cerradoFecha: "2026-11-25", objetivoFecha: "2026-11-20" },
    ];
    expect(cumplimiento(ciclos)).toEqual({ aTiempo: 2, conAtraso: 2, incumplidas: 1, total: 5, pctCumplimiento: 80, pctATiempo: 40 });
    expect(cumplimiento([])).toMatchObject({ total: 0, pctCumplimiento: null, pctATiempo: null });
  });

  it("recurrentes del período: mismo sistema de la misma máquina, 3 o más veces", async () => {
    const { recurrentesDelPeriodo } = await import("./indicadores");
    const filas = [
      ...[1, 2, 3, 4].map(() => ({ activoId: 1, sectorId: 10 })),
      ...[1, 2, 3].map(() => ({ activoId: 2, sectorId: 10 })),
      { activoId: 1, sectorId: 11 }, { activoId: 1, sectorId: 11 },
      { activoId: 1, sectorId: null }, { activoId: 1, sectorId: null }, { activoId: 1, sectorId: null },
    ];
    expect(recurrentesDelPeriodo(filas)).toEqual([
      { activoId: 1, sectorId: 10, veces: 4 },
      { activoId: 2, sectorId: 10, veces: 3 },
    ]);
  });
});
