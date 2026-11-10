// Pruebas contra una base de datos real (DATABASE_URL_TEST). Se omiten si no está definida.
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { autenticar, MAX_INTENTOS, type UsuarioSesion } from "./auth-core";
import {
  cambiarActivo,
  crearUsuario,
  ErrorDeNegocio,
  marcarTurno,
  restablecerClave,
} from "./usuarios-core";

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("acceso y usuarios (integración)", () => {
  let pool: Pool;
  let db: DB;
  let admin: UsuarioSesion;
  let jefe: UsuarioSesion;
  let mecanicaId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema }) as unknown as DB;
    await migrate(db, { migrationsFolder: "./drizzle" });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE bitacora, fichas_tecnico, usuarios, especialidades RESTART IDENTITY CASCADE`,
    );
    const [esp] = await db
      .insert(schema.especialidades)
      .values({ codigo: "MEC", nombre: "Mecánica" })
      .returning();
    mecanicaId = esp.id;
    // El primer administrador se inserta directo, como hace el script de datos iniciales.
    const [a] = await db
      .insert(schema.usuarios)
      .values({
        nombre: "Admin",
        perfil: "ADMINISTRADOR",
        identificador: "11111111-1",
        claveHash: "x",
      })
      .returning();
    admin = { id: a.id, nombre: a.nombre, perfil: a.perfil };
    await restablecerClave(db, admin, admin.id, "clave-admin-1");
    const jefeId = await crearUsuario(db, admin, {
      nombre: "Jefe Mantenimiento",
      perfil: "JEFE_PLANIFICADOR",
      identificador: "12.345.678-5",
      email: "Jefe@Empresa.cl",
      clave: "clave-jefe-1",
    });
    jefe = { id: jefeId, nombre: "Jefe Mantenimiento", perfil: "JEFE_PLANIFICADOR" };
  });

  async function crearTecnico(modalidad: schema.Modalidad = "TURNOS") {
    const id = await crearUsuario(db, admin, {
      nombre: "Técnico Uno",
      perfil: "TECNICO",
      identificador: "30686957-4",
      clave: "1234",
      especialidadId: mecanicaId,
      modalidad,
    });
    return { id, nombre: "Técnico Uno", perfil: "TECNICO" } as UsuarioSesion;
  }

  it("un administrativo entra con RUT en cualquier formato o con su correo", async () => {
    for (const ident of ["12.345.678-5", "123456785", "12345678-5", "jefe@empresa.cl", "JEFE@EMPRESA.CL"]) {
      const r = await autenticar(db, ident, "clave-jefe-1");
      expect(r.ok, ident).toBe(true);
    }
  });

  it("un operador entra con su usuario de Metrics y PIN", async () => {
    await crearUsuario(db, admin, {
      nombre: "Operador Uno",
      perfil: "OPERADOR",
      identificador: "JPerez",
      clave: "4321",
    });
    const r = await autenticar(db, "jperez", "4321");
    expect(r).toMatchObject({ ok: true, usuario: { perfil: "OPERADOR" } });
    expect((await autenticar(db, "jperez", "0000")).ok).toBe(false);
  });

  it("rechaza usuario inexistente y clave incorrecta con el mismo motivo", async () => {
    expect(await autenticar(db, "nadie", "1234")).toEqual({ ok: false, motivo: "CREDENCIALES" });
    expect(await autenticar(db, "12345678-5", "otra")).toEqual({ ok: false, motivo: "CREDENCIALES" });
    expect(await autenticar(db, "", "")).toEqual({ ok: false, motivo: "CREDENCIALES" });
  });

  it(`bloquea al quinto intento fallido y ni la clave correcta entra después`, async () => {
    const tecnico = await crearTecnico();
    for (let i = 1; i < MAX_INTENTOS; i++) {
      expect(await autenticar(db, "30686957-4", "0000")).toEqual({ ok: false, motivo: "CREDENCIALES" });
    }
    expect(await autenticar(db, "30686957-4", "0000")).toEqual({ ok: false, motivo: "BLOQUEADO" });
    expect(await autenticar(db, "30686957-4", "1234")).toEqual({ ok: false, motivo: "BLOQUEADO" });
    const [fila] = await db.select().from(schema.usuarios).where(eq(schema.usuarios.id, tecnico.id));
    expect(fila.intentosFallidos).toBe(MAX_INTENTOS);
    expect(fila.bloqueado).toBe(true);
  });

  it("un ingreso correcto pone los intentos fallidos en cero", async () => {
    const tecnico = await crearTecnico();
    for (let i = 0; i < MAX_INTENTOS - 1; i++) await autenticar(db, "30686957-4", "0000");
    expect((await autenticar(db, "30686957-4", "1234")).ok).toBe(true);
    const [fila] = await db.select().from(schema.usuarios).where(eq(schema.usuarios.id, tecnico.id));
    expect(fila.intentosFallidos).toBe(0);
    expect(fila.ultimoIngreso).not.toBeNull();
  });

  it("el jefe desbloquea a un técnico restableciendo su PIN", async () => {
    const tecnico = await crearTecnico();
    for (let i = 0; i < MAX_INTENTOS; i++) await autenticar(db, "30686957-4", "0000");
    await restablecerClave(db, jefe, tecnico.id, "9876");
    expect((await autenticar(db, "30686957-4", "9876")).ok).toBe(true);
    expect((await autenticar(db, "30686957-4", "1234")).ok).toBe(false);
  });

  it("el jefe no puede restablecer la clave de un administrador ni crear usuarios", async () => {
    await expect(restablecerClave(db, jefe, admin.id, "otra-clave-1")).rejects.toThrow(ErrorDeNegocio);
    await expect(
      crearUsuario(db, jefe, { nombre: "Otro", perfil: "OPERADOR", identificador: "otro", clave: "1111" }),
    ).rejects.toThrow(ErrorDeNegocio);
    expect((await autenticar(db, "11111111-1", "clave-admin-1")).ok).toBe(true);
  });

  it("valida PIN de 4 dígitos, contraseña de 8 caracteres y RUT", async () => {
    const base = { nombre: "Persona", especialidadId: mecanicaId, modalidad: "TURNOS" as const };
    await expect(
      crearUsuario(db, admin, { ...base, perfil: "TECNICO", identificador: "30686957-4", clave: "12345" }),
    ).rejects.toThrow("4 dígitos");
    await expect(
      crearUsuario(db, admin, { ...base, perfil: "TECNICO", identificador: "30686957-4", clave: "12a4" }),
    ).rejects.toThrow("4 dígitos");
    await expect(
      crearUsuario(db, admin, { ...base, perfil: "ABASTECIMIENTO", identificador: "30686957-4", clave: "corta" }),
    ).rejects.toThrow("8 caracteres");
    await expect(
      crearUsuario(db, admin, { ...base, perfil: "TECNICO", identificador: "30686957-9", clave: "1234" }),
    ).rejects.toThrow("RUT");
  });

  it("no permite dos usuarios con el mismo identificador", async () => {
    await crearTecnico();
    await expect(
      crearUsuario(db, admin, {
        nombre: "Duplicado",
        perfil: "BODEGUERO",
        identificador: "30.686.957-4",
        clave: "5555",
      }),
    ).rejects.toThrow("Ya existe");
  });

  it("un usuario desactivado no entra", async () => {
    const tecnico = await crearTecnico();
    await cambiarActivo(db, admin, tecnico.id, false);
    expect(await autenticar(db, "30686957-4", "1234")).toEqual({ ok: false, motivo: "CREDENCIALES" });
    await expect(cambiarActivo(db, admin, admin.id, false)).rejects.toThrow(ErrorDeNegocio);
  });

  it("el turno solo lo marca un técnico de turnos rotativos", async () => {
    const tecnico = await crearTecnico("TURNOS");
    await marcarTurno(db, tecnico, true);
    let [ficha] = await db.select().from(schema.fichasTecnico);
    expect(ficha.enTurno).toBe(true);
    expect(ficha.turnoDesde).not.toBeNull();
    await marcarTurno(db, tecnico, false);
    [ficha] = await db.select().from(schema.fichasTecnico);
    expect(ficha.enTurno).toBe(false);
    expect(ficha.turnoDesde).toBeNull();
    await expect(marcarTurno(db, jefe, true)).rejects.toThrow(ErrorDeNegocio);
  });

  it("deja registro en la bitácora", async () => {
    await crearTecnico();
    const acciones = (await db.select().from(schema.bitacora)).map((b) => b.accion);
    expect(acciones).toContain("CREAR_USUARIO");
    expect(acciones).toContain("RESTABLECER_CLAVE");
  });
});
