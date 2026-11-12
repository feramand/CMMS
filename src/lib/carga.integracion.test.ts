import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { autenticar, type UsuarioSesion } from "./auth-core";
import { COLUMNAS_ACTIVOS, COLUMNAS_USUARIOS, ErrorDeCarga, importarActivos, importarUsuarios, normalizar } from "./carga-core";
import { leerPlanilla, plantilla } from "./excel";
import { ErrorDeNegocio } from "./usuarios-core";

describe("planillas Excel", () => {
  it("la plantilla se puede leer de vuelta con las claves del sistema", async () => {
    const archivo = await plantilla("Activos", COLUMNAS_ACTIVOS);
    const filas = await leerPlanilla(archivo.buffer.slice(archivo.byteOffset, archivo.byteOffset + archivo.byteLength) as ArrayBuffer, COLUMNAS_ACTIVOS);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      codigo: "IMP-001",
      nombre: "Heidelberg XL106",
      planta: "Planta 1",
      anioFabricacion: "2015",
      sectores: "Marcador, Cuerpo impresor 1, Salida",
    });
  });
  it("compara textos sin tildes, mayúsculas ni signos", () => {
    expect(normalizar("Número de Serie")).toBe("numerodeserie");
    expect(normalizar(" Técnico ")).toBe("tecnico");
    expect(normalizar("Jefe / Planificador")).toBe("jefeplanificador");
  });
  it("rechaza un archivo que no es Excel y una planilla sin las columnas obligatorias", async () => {
    await expect(leerPlanilla(new TextEncoder().encode("hola").buffer as ArrayBuffer, COLUMNAS_ACTIVOS)).rejects.toThrow("no es una planilla");
    const otra = await plantilla("Usuarios", COLUMNAS_USUARIOS);
    await expect(
      leerPlanilla(otra.buffer.slice(otra.byteOffset, otra.byteOffset + otra.byteLength) as ArrayBuffer, COLUMNAS_ACTIVOS),
    ).rejects.toThrow("Faltan columnas");
  });
});

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("carga inicial (integración)", () => {
  let pool: Pool;
  let db: DB;
  let admin: UsuarioSesion, jefe: UsuarioSesion;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema }) as unknown as DB;
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE sectores, activos, bitacora, fichas_tecnico, usuarios, especialidades, plantas RESTART IDENTITY CASCADE`);
    await db.insert(schema.plantas).values([{ nombre: "Planta 1" }, { nombre: "Planta 2" }]);
    await db.insert(schema.especialidades).values([
      { codigo: "MEC", nombre: "Mecánica" },
      { codigo: "ELE", nombre: "Electricidad" },
    ]);
    const u = await db
      .insert(schema.usuarios)
      .values([
        { nombre: "Admin", perfil: "ADMINISTRADOR", identificador: "11111111-1", claveHash: "x" },
        { nombre: "Jefe", perfil: "JEFE_PLANIFICADOR", identificador: "12345678-5", claveHash: "x" },
      ])
      .returning();
    admin = { id: u[0].id, nombre: "Admin", perfil: "ADMINISTRADOR" };
    jefe = { id: u[1].id, nombre: "Jefe", perfil: "JEFE_PLANIFICADOR" };
  });

  it("carga activos con sus sectores, reconociendo la planta aunque esté escrita distinto", async () => {
    const n = await importarActivos(db, jefe, [
      { codigo: "imp-001", nombre: "Heidelberg XL106", planta: "PLANTA 1", anioFabricacion: "2015", condicionLlegada: "nueva", sectores: "Marcador, Salida, Marcador" },
      { codigo: "TRQ-001", nombre: "Troqueladora Bobst", planta: "planta 2" },
    ]);
    expect(n).toBe(2);
    const activos = await db.select().from(schema.activos);
    expect(activos.map((a) => a.codigo).sort()).toEqual(["IMP-001", "TRQ-001"]);
    expect(activos.find((a) => a.codigo === "IMP-001")).toMatchObject({ anioFabricacion: 2015, condicionLlegada: "NUEVA" });
    expect((await db.select().from(schema.sectores)).map((s) => s.nombre).sort()).toEqual(["Marcador", "Salida"]);
  });

  it("si una fila falla no carga ninguna, y dice qué fila y por qué", async () => {
    const carga = importarActivos(db, admin, [
      { codigo: "A-1", nombre: "Buena", planta: "Planta 1" },
      { codigo: "A-2", nombre: "", planta: "Planta 1" },
      { codigo: "A-3", nombre: "Planta mala", planta: "Planta 9" },
      { codigo: "A-1", nombre: "Repetida", planta: "Planta 1" },
      { codigo: "A-5", nombre: "Año malo", planta: "Planta 1", anioLlegada: "dos mil" },
      { codigo: "A-6", nombre: "Condición mala", planta: "Planta 1", condicionLlegada: "Seminueva" },
    ]);
    await expect(carga).rejects.toThrow(ErrorDeCarga);
    const errores = await carga.catch((e: ErrorDeCarga) => e.errores);
    expect(errores).toEqual([
      'Fila 3: falta "Nombre de la máquina".',
      'Fila 4: no existe la planta "Planta 9".',
      "Fila 5: Ya existe un activo con ese ID o con ese código de Metrics.",
      "Fila 6: Año de llegada: escribe un año de 4 dígitos.",
      'Fila 7: la condición de llegada debe ser "Nueva" o "Usada".',
    ]);
    expect(await db.select().from(schema.activos)).toHaveLength(0);
    expect(await db.select().from(schema.sectores)).toHaveLength(0);
  });

  it("carga usuarios de todos los perfiles y pueden entrar con su clave inicial", async () => {
    const n = await importarUsuarios(db, admin, [
      { nombre: "Mecánico Uno", perfil: "Técnico", identificador: "15.000.001-7", clave: "1234", especialidad: "mecanica", modalidad: "Turnos" },
      { nombre: "Eléctrico Uno", perfil: "tecnico", identificador: "15000002-5", clave: "0123", especialidad: "ELE", modalidad: "Horario fijo" },
      { nombre: "Operador Uno", perfil: "Operador", identificador: "JPerez", clave: "4321" },
      { nombre: "Compras", perfil: "Abastecimiento", identificador: "15.000.003-3", clave: "clave-larga-1", email: "Compras@Empresa.cl" },
    ]);
    expect(n).toBe(4);
    expect((await autenticar(db, "150000017", "1234")).ok).toBe(true);
    expect((await autenticar(db, "15.000.002-5", "0123")).ok).toBe(true); // el PIN conserva su cero inicial
    expect((await autenticar(db, "jperez", "4321")).ok).toBe(true);
    expect((await autenticar(db, "compras@empresa.cl", "clave-larga-1")).ok).toBe(true);
    const fichas = await db.select().from(schema.fichasTecnico);
    expect(fichas.map((f) => f.modalidad).sort()).toEqual(["HORARIO_FIJO", "TURNOS"]);
  });

  it("valida perfil, especialidad, modalidad, RUT y PIN, y no carga nada si algo falla", async () => {
    const errores = await importarUsuarios(db, admin, [
      { nombre: "Bueno", perfil: "Operador", identificador: "op1", clave: "1111" },
      { nombre: "Perfil malo", perfil: "Gerente", identificador: "x", clave: "1111" },
      { nombre: "Sin especialidad", perfil: "Técnico", identificador: "15.000.001-7", clave: "1234", modalidad: "Turnos" },
      { nombre: "Modalidad mala", perfil: "Técnico", identificador: "15.000.001-7", clave: "1234", especialidad: "Mecánica", modalidad: "Part time" },
      { nombre: "RUT malo", perfil: "Bodeguero", identificador: "15.000.001-9", clave: "1234" },
      { nombre: "PIN malo", perfil: "Operador", identificador: "op2", clave: "12345" },
      { nombre: "Repetido", perfil: "Operador", identificador: "OP1", clave: "2222" },
    ]).catch((e: ErrorDeCarga) => e.errores);
    expect(errores).toEqual([
      'Fila 3: no existe el perfil "Gerente".',
      'Fila 4: no existe la especialidad "".',
      'Fila 5: la modalidad debe ser "Turnos" u "Horario fijo".',
      "Fila 6: El RUT no es válido.",
      "Fila 7: El PIN debe tener exactamente 4 dígitos.",
      "Fila 8: Ya existe un usuario con ese identificador o correo.",
    ]);
    expect(await db.select().from(schema.usuarios)).toHaveLength(2);
  });

  it("respeta los permisos y rechaza una planilla vacía", async () => {
    await expect(importarUsuarios(db, jefe, [{ nombre: "X", perfil: "Operador", identificador: "x", clave: "1111" }])).rejects.toThrow("Solo el administrador");
    const tecnico: UsuarioSesion = { id: admin.id, nombre: "T", perfil: "TECNICO" };
    await expect(importarActivos(db, tecnico, [{ codigo: "A", nombre: "B", planta: "Planta 1" }])).rejects.toThrow(ErrorDeNegocio);
    await expect(importarActivos(db, admin, [])).rejects.toThrow("no tiene filas");
  });
});
