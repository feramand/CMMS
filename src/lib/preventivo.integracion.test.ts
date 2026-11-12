// Pautas preventivas e integración con Metrics contra una base real (DATABASE_URL_TEST).
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import { claveValida, guardarCodigo, recibirDeMetrics } from "./metrics-core";
import { solicitarRepuesto } from "./ot-core";
import {
  actualizarPauta,
  agregarActividad,
  crearOtDesdePauta,
  crearPauta,
  evaluarPautas,
  finalizarCiclo,
  liberarAnticipada,
  marcarActividad,
  registrarLectura,
  registrarLecturaManual,
} from "./pautas-core";

const url = process.env.DATABASE_URL_TEST;
const dia = (fecha: string) => new Date(`${fecha}T15:00:00Z`); // mediodía en Chile

describe.skipIf(!url)("preventivo y Metrics (integración)", () => {
  let pool: Pool;
  let db: DB;
  let jefe: UsuarioSesion, mec: UsuarioSesion, ele: UsuarioSesion, operador: UsuarioSesion;
  let maquina: number, espMec: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema }) as unknown as DB;
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE eventos_integracion, codigos_falla_metrics, actividades_ciclo, ciclos_pauta, actividades_pauta, pautas,
      lecturas_contador, notificaciones, solicitudes_repuesto, apoyos, avisos_solicitud, solicitudes, ordenes_trabajo, folios_ot,
      sectores, activos, parametros, bitacora, fichas_tecnico, usuarios, especialidades, plantas RESTART IDENTITY CASCADE`);
    const [planta] = await db.insert(schema.plantas).values({ nombre: "Planta 1" }).returning();
    const esp = await db
      .insert(schema.especialidades)
      .values([{ codigo: "MEC", nombre: "Mecánica" }, { codigo: "ELE", nombre: "Electricidad" }])
      .returning();
    espMec = esp[0].id;
    const u = await db
      .insert(schema.usuarios)
      .values([
        { nombre: "Jefe", perfil: "JEFE_PLANIFICADOR", identificador: "12345678-5", claveHash: "x" },
        { nombre: "M. Soto", perfil: "TECNICO", identificador: "15000001-7", claveHash: "x" },
        { nombre: "R. Díaz", perfil: "TECNICO", identificador: "15000002-5", claveHash: "x" },
        { nombre: "J. Pérez", perfil: "OPERADOR", identificador: "jperez", claveHash: "x" },
      ])
      .returning();
    jefe = { id: u[0].id, nombre: "Jefe", perfil: "JEFE_PLANIFICADOR" };
    mec = { id: u[1].id, nombre: "M. Soto", perfil: "TECNICO" };
    ele = { id: u[2].id, nombre: "R. Díaz", perfil: "TECNICO" };
    operador = { id: u[3].id, nombre: "J. Pérez", perfil: "OPERADOR" };
    await db.insert(schema.fichasTecnico).values([
      { usuarioId: mec.id, especialidadId: esp[0].id, modalidad: "TURNOS" },
      { usuarioId: ele.id, especialidadId: esp[1].id, modalidad: "TURNOS" },
    ]);
    const [a] = await db
      .insert(schema.activos)
      .values({ codigo: "IMP-001", nombre: "Heidelberg XL106", plantaId: planta.id, codigoMetrics: "XL106", girosAcumulados: 0 })
      .returning();
    maquina = a.id;
  });

  const ciclos = (pautaId: number) =>
    db.select().from(schema.ciclosPauta).where(eq(schema.ciclosPauta.pautaId, pautaId)).orderBy(schema.ciclosPauta.id);
  const abierto = async (pautaId: number) => (await ciclos(pautaId)).find((c) => c.estado === "PROGRAMADA" || c.estado === "LIBERADA")!;
  const avisos = async (usuarioId: number) =>
    (await db.select().from(schema.notificaciones).where(eq(schema.notificaciones.usuarioId, usuarioId))).map((n) => n.mensaje);
  const leer = (giros: number) => registrarLectura(db, { activoId: maquina, giros, origen: "METRICS" });
  const pautaGiros = () =>
    crearPauta(db, jefe, {
      activoId: maquina, nombre: "Lubricación general", tipo: "GIROS", intervalo: 500_000, especialidadId: espMec,
      actividades: "Engrasar rodamientos\nRevisar nivel de aceite\n\nLimpiar filtros",
    });
  async function completar(cicloId: number, actor = mec) {
    for (const a of await db.select().from(schema.actividadesCiclo).where(eq(schema.actividadesCiclo.cicloId, cicloId))) {
      await marcarActividad(db, actor, a.id, "HECHA");
    }
  }

  it("por giros: programada bajo el 80 %, liberada al 80 % con su checklist y aviso al técnico de la especialidad", async () => {
    const id = await pautaGiros();
    expect(await abierto(id)).toMatchObject({ estado: "PROGRAMADA", baseGiros: 0, liberacionGiros: 400_000, objetivoGiros: 500_000, limiteGiros: 600_000 });
    await leer(399_999);
    expect((await abierto(id)).estado).toBe("PROGRAMADA");
    expect(await avisos(mec.id)).toEqual([]);
    await leer(400_000);
    const c = await abierto(id);
    expect(c).toMatchObject({ estado: "LIBERADA", liberadoPor: null });
    expect((await db.select().from(schema.actividadesCiclo).where(eq(schema.actividadesCiclo.cicloId, c.id))).map((a) => a.descripcion))
      .toEqual(["Engrasar rodamientos", "Revisar nivel de aceite", "Limpiar filtros"]);
    expect(await avisos(mec.id)).toEqual(["Pauta liberada: Heidelberg XL106 · Lubricación general"]);
    expect(await avisos(ele.id)).toEqual([]);
    // Pasado el 100 % avisa una sola vez que está próxima a vencer.
    await leer(510_000);
    await leer(520_000);
    expect((await avisos(jefe.id)).filter((m) => m.startsWith("Pauta próxima a vencer"))).toHaveLength(1);
  });

  it("al ejecutar, la base del ciclo siguiente es el contador real", async () => {
    const id = await pautaGiros();
    await leer(430_000);
    const c = await abierto(id);
    await expect(finalizarCiclo(db, mec, c.id)).rejects.toThrow("Faltan 3 actividades");
    await expect(marcarActividad(db, ele, (await db.select().from(schema.actividadesCiclo))[0].id, "HECHA")).rejects.toThrow("otra especialidad");
    await completar(c.id);
    await expect(finalizarCiclo(db, mec, c.id, { giros: 429_000 })).rejects.toThrow("menores que la última lectura");
    await finalizarCiclo(db, mec, c.id, { giros: 523_400, observaciones: " Sin novedades " }, dia("2026-11-12"));
    const [hecho, siguiente] = await ciclos(id);
    expect(hecho).toMatchObject({ estado: "EJECUTADA", girosReales: 523_400, ejecutadoPor: mec.id, responsableId: mec.id, observaciones: "Sin novedades" });
    expect(siguiente).toMatchObject({ estado: "PROGRAMADA", baseGiros: 523_400, liberacionGiros: 923_400, objetivoGiros: 1_023_400, limiteGiros: 1_123_400 });
    const [m] = await db.select().from(schema.activos).where(eq(schema.activos.id, maquina));
    expect(m).toMatchObject({ girosAcumulados: 523_400, ultimaPreventiva: "2026-11-12", ultimoMp: "Lubricación general" });
    expect((await db.select().from(schema.lecturasContador)).at(-1)).toMatchObject({ giros: 523_400, origen: "MANUAL", registradaPor: mec.id });
    await expect(finalizarCiclo(db, mec, c.id)).rejects.toThrow("ya está cerrada");
  });

  it("incumplida al 120 % (opción A): la nueva base es el objetivo anterior y se libera de inmediato", async () => {
    const id = await pautaGiros();
    await leer(600_000);
    const [perdido, siguiente] = await ciclos(id);
    expect(perdido.estado).toBe("INCUMPLIDA");
    expect(siguiente).toMatchObject({ estado: "LIBERADA", baseGiros: 500_000, objetivoGiros: 1_000_000, limiteGiros: 1_100_000 });
    expect(await avisos(jefe.id)).toContain("Pauta incumplida: Heidelberg XL106 · Lubricación general");
    // Un salto grande del contador registra cada ciclo perdido.
    await leer(1_700_000);
    expect((await ciclos(id)).map((c) => [c.estado, c.baseGiros])).toEqual([
      ["INCUMPLIDA", 0], ["INCUMPLIDA", 500_000], ["INCUMPLIDA", 1_000_000], ["LIBERADA", 1_500_000],
    ]);
  });

  it("por tiempo: mensual desde el 1 de marzo libera el 25, se puede ejecutar hasta el 6 de abril y se incumple el 7", async () => {
    const id = await crearPauta(db, jefe, {
      activoId: maquina, nombre: "Revisión mensual", tipo: "TIEMPO", intervalo: 30, especialidadId: espMec, baseFecha: "2026-03-01", actividades: "Revisar",
    }, dia("2026-03-01"));
    expect(await abierto(id)).toMatchObject({ estado: "PROGRAMADA", liberacionFecha: "2026-03-25", objetivoFecha: "2026-03-31", limiteFecha: "2026-04-06" });
    expect(await evaluarPautas(db, { ahora: dia("2026-03-24") })).toBe(0);
    expect(await evaluarPautas(db, { ahora: dia("2026-03-25") })).toBe(1);
    expect((await abierto(id)).estado).toBe("LIBERADA");
    await evaluarPautas(db, { ahora: dia("2026-04-06") });
    expect((await ciclos(id)).map((c) => c.estado)).toEqual(["LIBERADA"]);
    await evaluarPautas(db, { ahora: dia("2026-04-07") });
    const [perdido, siguiente] = await ciclos(id);
    expect(perdido.estado).toBe("INCUMPLIDA");
    expect(siguiente).toMatchObject({ estado: "LIBERADA", baseFecha: "2026-03-31", objetivoFecha: "2026-04-30", limiteFecha: "2026-05-06" });
    // Ejecutada el 10 de abril: el ciclo siguiente parte ese día.
    await completar(siguiente.id);
    await finalizarCiclo(db, mec, siguiente.id, {}, dia("2026-04-10"));
    expect(await abierto(id)).toMatchObject({ estado: "PROGRAMADA", baseFecha: "2026-04-10", liberacionFecha: "2026-05-04", objetivoFecha: "2026-05-10" });
  });

  it("solo jefe o planificador liberan antes de tiempo, y queda registrado quién", async () => {
    const id = await pautaGiros();
    const c = await abierto(id);
    await expect(liberarAnticipada(db, mec, c.id)).rejects.toThrow("Solo jefe o planificador");
    await expect(completar(c.id)).resolves.toBeUndefined();
    await expect(finalizarCiclo(db, mec, c.id)).rejects.toThrow("todavía no está liberada");
    await liberarAnticipada(db, jefe, c.id);
    expect(await abierto(id)).toMatchObject({ estado: "LIBERADA", liberadoPor: jefe.id });
    await expect(liberarAnticipada(db, jefe, c.id)).rejects.toThrow("ya está liberada");
  });

  it("una actividad no realizada exige explicación; el checklist nuevo vale desde la próxima liberación", async () => {
    const id = await pautaGiros();
    await leer(450_000);
    const c = await abierto(id);
    const [a1, a2, a3] = await db.select().from(schema.actividadesCiclo).where(eq(schema.actividadesCiclo.cicloId, c.id)).orderBy(schema.actividadesCiclo.orden);
    await agregarActividad(db, jefe, id, "Revisar correas");
    await marcarActividad(db, mec, a1.id, "HECHA", undefined, dia("2026-11-12"));
    expect(await abierto(id)).toMatchObject({ responsableId: mec.id });
    await expect(marcarActividad(db, mec, a2.id, "NO_REALIZADA")).rejects.toThrow("Explica por qué");
    await marcarActividad(db, mec, a2.id, "NO_REALIZADA", "Sin aceite en bodega");
    await marcarActividad(db, mec, a3.id, "HECHA");
    await finalizarCiclo(db, mec, c.id);
    await leer(900_000);
    const nuevo = await abierto(id);
    expect(await db.select().from(schema.actividadesCiclo).where(eq(schema.actividadesCiclo.cicloId, nuevo.id))).toHaveLength(4);
  });

  it("porcentajes propios de la pauta y cambio de intervalo recalculan el ciclo abierto", async () => {
    const id = await pautaGiros();
    await actualizarPauta(db, jefe, id, { nombre: "Lubricación general", intervalo: 1_000_000, especialidadId: espMec, pctLiberacion: 90, pctLimite: 110, activa: true });
    expect(await abierto(id)).toMatchObject({ liberacionGiros: 900_000, objetivoGiros: 1_000_000, limiteGiros: 1_100_000 });
    await expect(
      actualizarPauta(db, jefe, id, { nombre: "X", intervalo: 1000, especialidadId: espMec, pctLiberacion: 90, pctLimite: null, activa: true }),
    ).rejects.toThrow("los dos porcentajes");
    // Una pauta inactiva no se libera.
    await actualizarPauta(db, jefe, id, { nombre: "Lubricación general", intervalo: 1_000_000, especialidadId: espMec, activa: false });
    await leer(950_000);
    expect((await abierto(id)).estado).toBe("PROGRAMADA");
  });

  it("el contador solo avanza, y la lectura manual es de jefe o administrador", async () => {
    await registrarLecturaManual(db, jefe, maquina, 1000);
    await expect(registrarLecturaManual(db, jefe, maquina, 999)).rejects.toThrow("menor que la última registrada");
    await expect(registrarLecturaManual(db, jefe, maquina, 10.5)).rejects.toThrow("número entero");
    await expect(registrarLecturaManual(db, mec, maquina, 2000)).rejects.toThrow("Solo jefe");
    await expect(crearPauta(db, mec, { activoId: maquina, nombre: "X", tipo: "GIROS", intervalo: 10, especialidadId: espMec })).rejects.toThrow("Solo jefe");
    await expect(crearPauta(db, jefe, { activoId: maquina, nombre: "X", tipo: "GIROS", intervalo: 0, especialidadId: espMec })).rejects.toThrow("mayor que cero");
  });

  it("desde la pauta se pide un repuesto y se deja una OT, ambos ligados al ciclo y a la máquina", async () => {
    const id = await pautaGiros();
    await leer(400_000);
    const c = await abierto(id);
    const repuesto = await solicitarRepuesto(db, mec, { cicloId: c.id, cantidad: 2, descripcion: "Filtro de aceite" });
    const [r] = await db.select().from(schema.solicitudesRepuesto).where(eq(schema.solicitudesRepuesto.id, repuesto));
    expect(r).toMatchObject({ activoId: maquina, cicloId: c.id, solicitudId: null, otId: null });
    const ot = await crearOtDesdePauta(db, mec, c.id, { descripcion: "Cambiar rodamiento con juego", prioridad: "ALTA" });
    const [o] = await db.select().from(schema.ordenesTrabajo).where(eq(schema.ordenesTrabajo.id, ot));
    expect(o).toMatchObject({ activoId: maquina, cicloId: c.id, estado: "CREADA", prioridad: "ALTA", especialidadId: espMec });
    await expect(crearOtDesdePauta(db, ele, c.id, { descripcion: "x" })).rejects.toThrow("otra especialidad");
  });

  describe("Metrics", () => {
    beforeEach(async () => {
      await guardarCodigo(db, jefe, { codigo: "M01", descripcion: "Falla mecánica", categoria: "Mecánica" });
      await guardarCodigo(db, jefe, { codigo: "E01", descripcion: "Falla eléctrica", categoria: "ELECTRICA" });
    });
    const eventos = () => db.select().from(schema.eventosIntegracion).orderBy(schema.eventosIntegracion.id);

    it("una lectura de giros actualiza el contador y libera la pauta", async () => {
      const id = await pautaGiros();
      const r = await recibirDeMetrics(db, "GIROS", { codigoMaquina: "XL106", giros: 410_000, fechaHora: "2026-11-12T08:00:00-03:00" });
      expect(r.resultado).toBe("PROCESADO");
      expect((await abierto(id)).estado).toBe("LIBERADA");
      expect((await db.select().from(schema.lecturasContador))[0]).toMatchObject({ giros: 410_000, origen: "METRICS" });
      expect((await recibirDeMetrics(db, "GIROS", { codigoMaquina: "XL106", giros: 100 })).resultado).toBe("ERROR");
      expect((await recibirDeMetrics(db, "GIROS", { codigoMaquina: "NOEXISTE", giros: 5 })).resultado).toBe("ERROR");
      expect((await recibirDeMetrics(db, "GIROS", { codigoMaquina: "XL106", giros: "abc" })).resultado).toBe("ERROR");
      expect((await recibirDeMetrics(db, "GIROS", "hola")).resultado).toBe("ERROR");
      expect((await eventos()).map((e) => e.resultado)).toEqual(["PROCESADO", "ERROR", "ERROR", "ERROR", "ERROR"]);
    });

    it("solo los códigos de la tabla crean solicitud; el mismo apuntamiento nunca crea dos", async () => {
      const base = { codigoMaquina: "XL106", usuarioOperador: "JPerez", fechaHora: "2026-11-12T09:15:00-03:00" };
      // "Parada No Informada" no está en la tabla: se ignora.
      expect((await recibirDeMetrics(db, "DETENCION", { ...base, idApuntamiento: "A-1", codigoFalla: "PNI" })).resultado).toBe("IGNORADO");
      expect(await db.select().from(schema.solicitudes)).toHaveLength(0);
      // El operador la clasifica: el mismo apuntamiento llega con un código de mantenimiento.
      expect((await recibirDeMetrics(db, "DETENCION", { ...base, idApuntamiento: "A-1", codigoFalla: "M01" })).resultado).toBe("PROCESADO");
      const [s] = await db.select().from(schema.solicitudes);
      expect(s).toMatchObject({ origen: "METRICS", categoria: "MECANICA", idDetencionMetrics: "A-1", creadaPor: operador.id, estado: "PENDIENTE" });
      expect(s.detenidaEn?.toISOString()).toBe("2026-11-12T12:15:00.000Z");
      expect(await avisos(mec.id)).toHaveLength(0); // sin turno activo no recibe aviso; el jefe sí
      expect(await avisos(jefe.id)).toContain("Nueva solicitud: Heidelberg XL106 · Mecánica");
      // Reenvío y reclasificación del mismo apuntamiento: no crean nada ni anulan la solicitud.
      expect((await recibirDeMetrics(db, "DETENCION", { ...base, idApuntamiento: "A-1", codigoFalla: "M01" })).resultado).toBe("IGNORADO");
      expect((await recibirDeMetrics(db, "DETENCION", { ...base, idApuntamiento: "A-1", codigoFalla: "E01" })).resultado).toBe("IGNORADO");
      expect(await db.select().from(schema.solicitudes)).toHaveLength(1);
      // Otra detención de la misma máquina y categoría se suma a la solicitud abierta, una sola vez.
      const otra = { ...base, idApuntamiento: "A-2", codigoFalla: "M01" };
      expect((await recibirDeMetrics(db, "DETENCION", otra)).detalle).toContain("se sumó a la solicitud");
      expect((await recibirDeMetrics(db, "DETENCION", otra)).resultado).toBe("IGNORADO");
      expect(await db.select().from(schema.solicitudes)).toHaveLength(1);
      expect(await db.select().from(schema.avisosSolicitud)).toHaveLength(1);
      // Distinta categoría: solicitud nueva.
      await recibirDeMetrics(db, "DETENCION", { ...base, idApuntamiento: "A-3", codigoFalla: "E01" });
      expect(await db.select().from(schema.solicitudes).where(and(eq(schema.solicitudes.categoria, "ELECTRICA")))).toHaveLength(1);
      expect((await recibirDeMetrics(db, "DETENCION", { codigoMaquina: "XL106", codigoFalla: "M01" })).resultado).toBe("ERROR");
    });

    it("valida la clave del conector y las categorías de los códigos", async () => {
      expect(claveValida("secreta-123", "secreta-123")).toBe(true);
      expect(claveValida("secreta-124", "secreta-123")).toBe(false);
      expect(claveValida("corta", "secreta-123")).toBe(false);
      expect(claveValida(null, "secreta-123")).toBe(false);
      expect(claveValida("x", undefined)).toBe(false);
      await expect(guardarCodigo(db, jefe, { codigo: "X1", categoria: "Servicios generales" })).rejects.toThrow("no es una categoría válida");
      await expect(guardarCodigo(db, mec, { codigo: "X1", categoria: "SAC" })).rejects.toThrow("Solo jefe");
    });
  });
});
