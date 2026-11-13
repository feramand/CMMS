// Indicadores de un período contra una base real (DATABASE_URL_TEST), con cifras calculadas a mano.
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { informe, periodoPedido } from "./indicadores-core";

const url = process.env.DATABASE_URL_TEST;
// Noviembre en Chile: UTC−3 todo el mes.
const t = (texto: string) => new Date(`2026-${texto}:00-03:00`);

describe.skipIf(!url)("indicadores (integración)", () => {
  let pool: Pool;
  let db: DB;
  let a: number, b: number, s1: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema }) as unknown as DB;
    await migrate(db, { migrationsFolder: "./drizzle" });
    await db.execute(sql`TRUNCATE eventos_integracion, codigos_falla_metrics, actividades_ciclo, ciclos_pauta, actividades_pauta, pautas,
      lecturas_contador, notificaciones, solicitudes_repuesto, apoyos, avisos_solicitud, solicitudes, ordenes_trabajo, folios_ot,
      sectores, activos, parametros, bitacora, fichas_tecnico, usuarios, especialidades, plantas RESTART IDENTITY CASCADE`);
    const [planta] = await db.insert(schema.plantas).values({ nombre: "Planta 1" }).returning();
    const [esp] = await db.insert(schema.especialidades).values({ codigo: "MEC", nombre: "Mecánica" }).returning();
    const [marco, ana] = await db
      .insert(schema.usuarios)
      .values([
        { nombre: "Marco Soto", perfil: "TECNICO", identificador: "15000001-7", claveHash: "x" },
        { nombre: "Ana Díaz", perfil: "TECNICO", identificador: "15000002-5", claveHash: "x" },
      ])
      .returning();
    const maquinas = await db
      .insert(schema.activos)
      .values([
        { codigo: "IMP-001", nombre: "Heidelberg XL106", plantaId: planta.id },
        { codigo: "IMP-002", nombre: "Komori GL40", plantaId: planta.id },
      ])
      .returning();
    [a, b] = maquinas.map((m) => m.id);
    const sistemas = await db.insert(schema.sectores).values([{ activoId: a, nombre: "Marcador" }, { activoId: b, nombre: "Salida" }]).returning();
    s1 = sistemas[0].id;
    const [ot] = await db
      .insert(schema.ordenesTrabajo)
      .values({ folio: "260001", activoId: a, tipo: "CORRECTIVA", descripcion: "Cambiar contactor", especialidadId: esp.id, responsableId: ana.id, estado: "FINALIZADA", inicioEn: t("11-12T08:40"), terminoEn: t("11-12T10:00") })
      .returning();
    const comun = { origen: "OPERADOR" as const, maquinaDetenida: true };
    const sat = await db
      .insert(schema.solicitudes)
      .values([
        // F1: detenida 10:00, aviso 10:05, tomada 10:15, resuelta 11:00 → 60 min detenida.
        { ...comun, activoId: a, categoria: "MECANICA", origen: "METRICS", detenidaEn: t("11-10T10:00"), creadaEn: t("11-10T10:05"), tomadaEn: t("11-10T10:15"), cerradaEn: t("11-10T11:00"), estado: "SOLUCIONADA", sectorId: s1, responsableId: marco.id, solucion: "Limpieza de sensor" },
        // F2: 08:00 → 10:00 con orden de trabajo → 120 min.
        { ...comun, activoId: a, categoria: "ELECTRICA", creadaEn: t("11-12T08:00"), tomadaEn: t("11-12T08:30"), cerradaEn: t("11-12T10:00"), estado: "CERRADA", sectorId: s1, responsableId: ana.id, otId: ot.id },
        // F3: abierta desde el 20 a las 09:00 → hasta el fin del período: 10 días y 15 horas = 15.300 min.
        { ...comun, activoId: a, categoria: "INDETERMINADA", creadaEn: t("11-20T09:00"), tomadaEn: t("11-20T09:10"), estado: "EN_ATENCION", sectorId: s1, responsableId: marco.id },
        // F4: empezó el 31 de octubre a las 22:00 y se resolvió el 1 a las 02:00 → 120 min dentro del período, 240 de duración.
        { ...comun, activoId: b, categoria: "MECANICA", creadaEn: t("10-31T22:00"), tomadaEn: t("10-31T22:30"), cerradaEn: t("11-01T02:00"), estado: "SOLUCIONADA", responsableId: marco.id, solucion: "Reapriete" },
        // F5: sin máquina detenida: no cuenta como detención, sí como solicitud resuelta.
        { ...comun, maquinaDetenida: false, activoId: b, categoria: "MECANICA", creadaEn: t("11-05T10:00"), tomadaEn: t("11-05T10:05"), cerradaEn: t("11-05T10:20"), estado: "SOLUCIONADA", sectorId: sistemas[1].id, responsableId: marco.id, solucion: "Ajuste" },
        // F7: servicios generales con la máquina detenida: no es Breakdown Downtime, sí es una solicitud resuelta.
        { ...comun, activoId: b, categoria: "SERVICIOS_GENERALES", creadaEn: t("11-07T10:00"), tomadaEn: t("11-07T10:10"), cerradaEn: t("11-07T12:00"), estado: "SOLUCIONADA", responsableId: marco.id, solucion: "Reposición de aire comprimido" },
        // F6: anulada: no cuenta en nada.
        { ...comun, activoId: b, categoria: "MECANICA", creadaEn: t("11-06T10:00"), cerradaEn: t("11-06T10:01"), estado: "ANULADA" },
      ])
      .returning();
    await db.insert(schema.apoyos).values({ solicitudId: sat[1].id, usuarioId: marco.id, fecha: t("11-12T08:35") });
    const [p1, p2] = await db
      .insert(schema.pautas)
      .values([
        { activoId: a, nombre: "Pauta A/B", tipo: "TIEMPO", intervalo: 15, especialidadId: esp.id },
        { activoId: b, nombre: "Pauta 500.000", tipo: "GIROS", intervalo: 500_000, especialidadId: esp.id },
      ])
      .returning();
    const ciclos = await db
      .insert(schema.ciclosPauta)
      .values([
        { pautaId: p1.id, estado: "EJECUTADA", variante: "A", objetivoFecha: "2026-11-15", cerradoEn: t("11-15T12:00"), ejecutadoPor: marco.id },
        { pautaId: p1.id, estado: "EJECUTADA", variante: "B", objetivoFecha: "2026-11-15", cerradoEn: t("11-17T12:00"), ejecutadoPor: ana.id },
        { pautaId: p1.id, estado: "INCUMPLIDA", variante: "A", objetivoFecha: "2026-11-20", cerradoEn: t("11-25T03:00") },
        { pautaId: p2.id, estado: "EJECUTADA", objetivoGiros: 500_000, girosReales: 480_000, cerradoEn: t("11-20T12:00"), ejecutadoPor: marco.id },
        // Cerrada en diciembre: fuera del período.
        { pautaId: p2.id, estado: "EJECUTADA", objetivoGiros: 1_000_000, girosReales: 990_000, cerradoEn: t("12-02T12:00"), ejecutadoPor: marco.id },
        { pautaId: p2.id, estado: "PROGRAMADA", objetivoGiros: 1_500_000 },
      ])
      .returning();
    await db.insert(schema.actividadesCiclo).values([
      { cicloId: ciclos[0].id, orden: 1, descripcion: "Limpiar", estado: "HECHA", marcadaPor: marco.id, marcadaEn: t("11-15T11:00") },
      { cicloId: ciclos[0].id, orden: 2, descripcion: "Engrasar", estado: "HECHA", marcadaPor: marco.id, marcadaEn: t("11-15T11:30") },
      { cicloId: ciclos[0].id, orden: 3, descripcion: "Revisar", estado: "NO_REALIZADA", motivo: "EN_PRODUCCION", marcadaPor: ana.id, marcadaEn: t("11-15T11:40") },
    ]);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("calcula detención, MTTR, MTBF, preventivo, recurrencia y trabajo por técnico de noviembre", async () => {
    const i = await informe(db, "2026-11-01", "2026-11-30", t("12-05T12:00"));
    // 30 días completos = 43.200 minutos.
    expect(i.minutosPeriodo).toBe(43_200);
    expect(i.maquinas.map((m) => ({ ...m, planta: undefined }))).toEqual([
      {
        activoId: a, activo: "Heidelberg XL106", planta: undefined, fallas: 3, iniciadas: 3, abiertas: 1,
        minutosDetenida: 15_480, // 60 + 120 + 15.300
        pctDetenida: 35.8, // 15.480 / 43.200
        mtbf: 9_240, // (43.200 − 15.480) / 3
        resueltas: 2, mttr: 90, respuesta: 20, reparacion: 68, // (60+120)/2 · (10+30)/2 · (45+90)/2 = 67,5
      },
      {
        activoId: b, activo: "Komori GL40", planta: undefined, fallas: 1, iniciadas: 0, abiertas: 0,
        minutosDetenida: 120, pctDetenida: 0.3, mtbf: null,
        resueltas: 1, mttr: 240, respuesta: 30, reparacion: 210,
      },
    ]);
    expect(i.detencion).toEqual({
      minutos: 15_600, fallas: 4, abiertas: 1, resueltas: 3, mttr: 140, respuesta: 23, reparacion: 115,
      porTipo: [
        { categoria: "MECANICA", nombre: "BD Mecánico", fallas: 2, minutos: 180 }, // 60 + 120
        { categoria: "ELECTRICA", nombre: "BD Eléctrico", fallas: 1, minutos: 120 },
        { categoria: "SAC", nombre: "BD SAC", fallas: 0, minutos: 0 },
        { categoria: "INDETERMINADA", nombre: "BD General", fallas: 1, minutos: 15_300 },
      ],
    });
    expect(i.detalle.map((f) => f.minutos)).toEqual([15_300, 120, 120, 60]);

    expect(i.atencion).toEqual({
      creadas: 5, resueltas: 5, sinOt: 4, conOt: 1, pctSinOt: 80,
      porCategoria: [{ categoria: "MECANICA", cantidad: 2 }, { categoria: "ELECTRICA", cantidad: 1 }, { categoria: "INDETERMINADA", cantidad: 1 }, { categoria: "SERVICIOS_GENERALES", cantidad: 1 }],
    });
    expect(i.recurrentes).toEqual([{ activoId: a, sectorId: s1, veces: 3, activo: "Heidelberg XL106", sistema: "Marcador" }]);

    expect(i.preventivo).toMatchObject({ total: 4, aTiempo: 2, conAtraso: 1, incumplidas: 1, pctCumplimiento: 75, pctATiempo: 50 });
    expect(i.preventivo.porMaquina).toEqual([
      { activoId: a, activo: "Heidelberg XL106", total: 3, aTiempo: 1, conAtraso: 1, incumplidas: 1, pctCumplimiento: 66.7, pctATiempo: 33.3 },
      { activoId: b, activo: "Komori GL40", total: 1, aTiempo: 1, conAtraso: 0, incumplidas: 0, pctCumplimiento: 100, pctATiempo: 100 },
    ]);
    expect(i.preventivo.actividades).toEqual({ hechas: 2, noRealizadas: 1, porMotivo: [{ motivo: "EN_PRODUCCION", cantidad: 1 }] });
    expect(i.preventivo.ciclos.map((c) => [c.pauta, c.vuelta, c.estado, c.aTiempo, c.objetivo, c.real])).toEqual([
      ["Pauta A/B", "A", "EJECUTADA", true, "15-11-2026", "15-11-2026"],
      ["Pauta A/B", "B", "EJECUTADA", false, "15-11-2026", "17-11-2026"],
      ["Pauta A/B", "A", "INCUMPLIDA", false, "20-11-2026", "—"],
      ["Pauta 500.000", null, "EJECUTADA", true, "500.000 giros", "480.000 giros"],
    ]);

    // En orden alfabético, sin posiciones.
    expect(i.porTecnico.map((x) => ({ ...x, usuarioId: undefined }))).toEqual([
      { usuarioId: undefined, nombre: "Ana Díaz", solicitudes: 0, ordenes: 1, apoyos: 0, pautas: 1, actividades: 0 },
      { usuarioId: undefined, nombre: "Marco Soto", solicitudes: 4, ordenes: 0, apoyos: 1, pautas: 2, actividades: 2 },
    ]);
  });

  it("un período en curso cuenta solo el tiempo transcurrido", async () => {
    // El 20 a las 12:00: la falla abierta lleva 3 horas; el período, 19 días y 12 horas = 28.080 min.
    const i = await informe(db, "2026-11-01", "2026-11-30", t("11-20T12:00"));
    expect(i.minutosPeriodo).toBe(28_080);
    const xl = i.maquinas.find((m) => m.activoId === a)!;
    expect(xl).toMatchObject({ minutosDetenida: 360, fallas: 3, iniciadas: 3, mtbf: 9_240, pctDetenida: 1.3 }); // (28.080 − 360) / 3 = 9.240
  });

  it("el período por defecto es el mes en curso y corrige fechas invertidas o inválidas", () => {
    const ahora = t("11-13T10:00");
    expect(periodoPedido({}, ahora)).toEqual({ desde: "2026-11-01", hasta: "2026-11-13", hoy: "2026-11-13" });
    expect(periodoPedido({ desde: "2026-11-10", hasta: "2026-11-02" }, ahora)).toMatchObject({ desde: "2026-11-02", hasta: "2026-11-10" });
    expect(periodoPedido({ desde: "2026-13-40", hasta: "x" }, ahora)).toMatchObject({ desde: "2026-11-01", hasta: "2026-11-13" });
  });
});
