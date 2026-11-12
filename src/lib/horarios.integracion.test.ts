import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { actualizarActivo, crearActivo } from "./activos-core";
import type { UsuarioSesion } from "./auth-core";
import { agregarFeriado, guardarHorario, quitarFeriado } from "./horarios-core";
import { tecnicosDisponibles } from "./notificar";
import { ErrorDeNegocio } from "./usuarios-core";

const url = process.env.DATABASE_URL_TEST;
// Jueves 12 de noviembre de 2026, hora de Santiago (UTC−3).
const t = (hora: string, dia = "12") => new Date(`2026-11-${dia}T${hora}:00-03:00`);

describe.skipIf(!url)("horarios, feriados y edición de activos (integración)", () => {
  let pool: Pool;
  let db: DB;
  let jefe: UsuarioSesion, tecnicoSesion: UsuarioSesion;
  let fijo: number, rotativo: number, plantaId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema }) as unknown as DB;
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE feriados, parametros, sectores, activos, bitacora, fichas_tecnico, usuarios, especialidades, plantas RESTART IDENTITY CASCADE`);
    const [p] = await db.insert(schema.plantas).values({ nombre: "Planta 1" }).returning();
    plantaId = p.id;
    const [esp] = await db.insert(schema.especialidades).values({ codigo: "MEC", nombre: "Mecánica" }).returning();
    const u = await db
      .insert(schema.usuarios)
      .values([
        { nombre: "Jefe", perfil: "JEFE_PLANIFICADOR", identificador: "j", claveHash: "x" },
        { nombre: "Fijo", perfil: "TECNICO", identificador: "f", claveHash: "x" },
        { nombre: "Rotativo", perfil: "TECNICO", identificador: "r", claveHash: "x" },
      ])
      .returning();
    jefe = { id: u[0].id, nombre: "Jefe", perfil: "JEFE_PLANIFICADOR" };
    tecnicoSesion = { id: u[1].id, nombre: "Fijo", perfil: "TECNICO" };
    fijo = u[1].id;
    rotativo = u[2].id;
    await db.insert(schema.fichasTecnico).values([
      { usuarioId: fijo, especialidadId: esp.id, modalidad: "HORARIO_FIJO" },
      { usuarioId: rotativo, especialidadId: esp.id, modalidad: "TURNOS", enTurno: true, turnoDesde: t("07:00") },
    ]);
  });

  const disponibles = async (cuando: Date) => (await tecnicosDisponibles(db, ["MEC"], cuando)).sort();

  it("sin horario definido, el técnico de horario fijo recibe avisos siempre", async () => {
    expect(await disponibles(t("03:00", "15"))).toEqual([fijo].sort());
  });

  it("con horario, solo recibe avisos dentro de él; el rotativo, mientras dure su turno", async () => {
    await guardarHorario(db, jefe, fijo, { dias: [5, 1, 2, 3, 4, 1], entrada: "08:00", salida: "18:00" });
    const [ficha] = await db.select().from(schema.fichasTecnico).where(eq(schema.fichasTecnico.usuarioId, fijo));
    expect(ficha).toMatchObject({ diasLaborales: "1,2,3,4,5", horaEntrada: "08:00:00", horaSalida: "18:00:00" });
    expect(await disponibles(t("10:00"))).toEqual([fijo, rotativo].sort());
    expect(await disponibles(t("18:30"))).toEqual([rotativo]); // fijo ya salió; rotativo lleva 11 h 30 min
    expect(await disponibles(t("19:00"))).toEqual([]); // el turno se apagó solo a las 12 horas
    expect(await disponibles(t("10:00", "14"))).toEqual([]); // sábado
  });

  it("un feriado saca de disponibilidad al técnico de horario fijo, hasta que se quita", async () => {
    await guardarHorario(db, jefe, fijo, { dias: [1, 2, 3, 4, 5], entrada: "08:00", salida: "18:00" });
    await agregarFeriado(db, jefe, "2026-11-12", "Feriado de prueba");
    expect(await disponibles(t("10:00"))).toEqual([rotativo]);
    await quitarFeriado(db, jefe, "2026-11-12");
    expect(await disponibles(t("10:00"))).toEqual([fijo, rotativo].sort());
  });

  it("las horas de apagado del turno se leen de los parámetros", async () => {
    await db.insert(schema.parametros).values({ clave: "turno_horas_apagado", valor: "14", descripcion: "x" });
    expect(await disponibles(t("19:00"))).toContain(rotativo);
    expect(await disponibles(t("21:00"))).not.toContain(rotativo);
  });

  it("valida horario, feriados y permisos", async () => {
    const ok = { dias: [1], entrada: "08:00", salida: "18:00" };
    await expect(guardarHorario(db, tecnicoSesion, fijo, ok)).rejects.toThrow("permiso");
    await expect(guardarHorario(db, jefe, fijo, { ...ok, dias: [] })).rejects.toThrow("al menos un día");
    await expect(guardarHorario(db, jefe, fijo, { ...ok, dias: [0, 8] })).rejects.toThrow("al menos un día");
    await expect(guardarHorario(db, jefe, fijo, { ...ok, entrada: "25:00" })).rejects.toThrow("horas");
    await expect(guardarHorario(db, jefe, fijo, { ...ok, salida: "08:00" })).rejects.toThrow("iguales");
    await expect(guardarHorario(db, jefe, rotativo, ok)).rejects.toThrow("horario fijo");
    await expect(agregarFeriado(db, jefe, "2026-02-30", "No existe")).rejects.toThrow("no es válida");
    await expect(agregarFeriado(db, jefe, "12-11-2026", "Formato")).rejects.toThrow("no es válida");
    await expect(agregarFeriado(db, jefe, "2026-12-25", "  ")).rejects.toThrow("nombre");
    await expect(agregarFeriado(db, tecnicoSesion, "2026-12-25", "Navidad")).rejects.toThrow(ErrorDeNegocio);
    await agregarFeriado(db, jefe, "2026-12-25", "Navidad");
    await agregarFeriado(db, jefe, "2026-12-25", "Natividad"); // misma fecha: actualiza el nombre
    expect(await db.select().from(schema.feriados)).toEqual([{ fecha: "2026-12-25", nombre: "Natividad" }]);
  });

  it("edita la ficha y el estado operativo de un activo sin cambiar su ID", async () => {
    const id = await crearActivo(db, jefe, { codigo: "imp-001", nombre: "Heidelberg", plantaId, anioFabricacion: "2015", sectores: "Marcador" });
    await actualizarActivo(db, jefe, id, {
      nombre: " Heidelberg XL106 ", plantaId, fabricante: "Heidelberg", anioFabricacion: "", anioLlegada: "2016",
      condicionLlegada: "USADA", estadoOperativo: "FUERA_DE_SERVICIO",
    });
    const [a] = await db.select().from(schema.activos).where(eq(schema.activos.id, id));
    expect(a).toMatchObject({
      codigo: "IMP-001", nombre: "Heidelberg XL106", fabricante: "Heidelberg", anioFabricacion: null, anioLlegada: 2016,
      condicionLlegada: "USADA", estadoOperativo: "FUERA_DE_SERVICIO",
    });
    expect(await db.select().from(schema.sectores)).toHaveLength(1);
    const base = { nombre: "X", plantaId, estadoOperativo: "ACTIVO" };
    await expect(actualizarActivo(db, jefe, id, { ...base, nombre: " " })).rejects.toThrow("nombre");
    await expect(actualizarActivo(db, jefe, id, { ...base, estadoOperativo: "ROTA" })).rejects.toThrow("estado del equipo");
    await expect(actualizarActivo(db, jefe, id, { ...base, anioLlegada: "16" })).rejects.toThrow("4 dígitos");
    await expect(actualizarActivo(db, jefe, id, { ...base, plantaId: 999 })).rejects.toThrow("planta");
    await expect(actualizarActivo(db, jefe, 999, base)).rejects.toThrow("no existe");
    await expect(actualizarActivo(db, tecnicoSesion, id, base)).rejects.toThrow("permiso");
    // Dos activos no pueden compartir código de Metrics.
    const otro = await crearActivo(db, jefe, { codigo: "imp-002", nombre: "Otra", plantaId, codigoMetrics: "M-7" });
    await expect(actualizarActivo(db, jefe, id, { ...base, codigoMetrics: "M-7" })).rejects.toThrow("código de Metrics");
    expect(otro).not.toBe(id);
  });
});
