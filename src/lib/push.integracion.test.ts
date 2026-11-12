import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import { despacharPush, guardarSuscripcion, MINUTOS_VIGENCIA, type MensajePush, type Suscripcion } from "./push-core";
import { ErrorDeNegocio } from "./usuarios-core";

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("notificaciones push (integración)", () => {
  let pool: Pool;
  let db: DB;
  let ana: UsuarioSesion, luis: UsuarioSesion;
  const ahora = new Date("2026-11-12T10:00:00-03:00");
  const sub = (n: string): Suscripcion => ({ endpoint: `https://push.example/${n}`, p256dh: "clave", auth: "auth" });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema }) as unknown as DB;
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE suscripciones_push, notificaciones, usuarios RESTART IDENTITY CASCADE`);
    const filas = await db
      .insert(schema.usuarios)
      .values([
        { nombre: "Ana", perfil: "TECNICO", identificador: "a", claveHash: "x" },
        { nombre: "Luis", perfil: "TECNICO", identificador: "l", claveHash: "x" },
      ])
      .returning();
    ana = { id: filas[0].id, nombre: "Ana", perfil: "TECNICO" };
    luis = { id: filas[1].id, nombre: "Luis", perfil: "TECNICO" };
  });

  const aviso = (u: UsuarioSesion, mensaje: string, minutosAtras = 0) =>
    db.insert(schema.notificaciones).values({
      usuarioId: u.id,
      mensaje,
      enlace: "/sat/1",
      creadaEn: new Date(ahora.getTime() - minutosAtras * 60000),
    });

  function enviador(respuestas: Record<string, "ok" | "caducada" | "error"> = {}) {
    const enviados: { endpoint: string; mensaje: MensajePush }[] = [];
    return {
      enviados,
      enviar: async (s: Suscripcion, mensaje: MensajePush) => {
        enviados.push({ endpoint: s.endpoint, mensaje });
        return respuestas[s.endpoint] ?? "ok";
      },
    };
  }

  it("envía cada aviso a todos los dispositivos de su destinatario y a nadie más", async () => {
    await guardarSuscripcion(db, ana, sub("ana-celular"));
    await guardarSuscripcion(db, ana, sub("ana-tablet"));
    await guardarSuscripcion(db, luis, sub("luis-celular"));
    await aviso(ana, "Nueva solicitud: Heidelberg XL106 · Mecánica");
    const e = enviador();
    const r = await despacharPush(db, e.enviar, ahora);
    expect(r).toEqual({ avisos: 1, enviados: 2, caducadas: 0, errores: 0 });
    expect(e.enviados.map((x) => x.endpoint).sort()).toEqual(["https://push.example/ana-celular", "https://push.example/ana-tablet"]);
    expect(e.enviados[0].mensaje).toEqual({
      titulo: "Print Garage",
      cuerpo: "Nueva solicitud: Heidelberg XL106 · Mecánica",
      url: "/sat/1",
    });
  });

  it("no envía dos veces el mismo aviso, ni siquiera si se despacha en paralelo", async () => {
    await guardarSuscripcion(db, ana, sub("ana"));
    await aviso(ana, "Uno");
    await aviso(ana, "Dos");
    const e = enviador();
    const r = await Promise.all([despacharPush(db, e.enviar, ahora), despacharPush(db, e.enviar, ahora)]);
    expect(r[0].avisos + r[1].avisos).toBe(2);
    expect(e.enviados).toHaveLength(2);
    expect((await despacharPush(db, e.enviar, ahora)).avisos).toBe(0);
    expect(e.enviados).toHaveLength(2);
  });

  it(`no envía avisos de más de ${MINUTOS_VIGENCIA} minutos, pero los deja despachados`, async () => {
    await guardarSuscripcion(db, ana, sub("ana"));
    await aviso(ana, "Reciente", MINUTOS_VIGENCIA);
    await aviso(ana, "Antiguo", MINUTOS_VIGENCIA + 1);
    const e = enviador();
    expect((await despacharPush(db, e.enviar, ahora)).avisos).toBe(1);
    expect(e.enviados.map((x) => x.mensaje.cuerpo)).toEqual(["Reciente"]);
    const pendientes = (await db.select().from(schema.notificaciones)).filter((n) => n.pushEnviadaEn === null);
    expect(pendientes).toHaveLength(0);
  });

  it("borra las suscripciones caducadas y cuenta los errores sin detenerse", async () => {
    await guardarSuscripcion(db, ana, sub("vieja"));
    await guardarSuscripcion(db, ana, sub("buena"));
    await guardarSuscripcion(db, ana, sub("falla"));
    await aviso(ana, "Hola");
    const e = enviador({ "https://push.example/vieja": "caducada", "https://push.example/falla": "error" });
    expect(await despacharPush(db, e.enviar, ahora)).toEqual({ avisos: 1, enviados: 1, caducadas: 1, errores: 1 });
    const quedan = (await db.select().from(schema.suscripcionesPush)).map((s) => s.endpoint).sort();
    expect(quedan).toEqual(["https://push.example/buena", "https://push.example/falla"]);
  });

  it("un envío que lanza una excepción cuenta como error y no interrumpe a los demás", async () => {
    await guardarSuscripcion(db, ana, sub("rota"));
    await guardarSuscripcion(db, ana, sub("buena"));
    await aviso(ana, "Hola");
    const r = await despacharPush(
      db,
      async (s) => {
        if (s.endpoint.endsWith("rota")) throw new Error("sin red");
        return "ok";
      },
      ahora,
    );
    expect(r).toEqual({ avisos: 1, enviados: 1, caducadas: 0, errores: 1 });
  });

  it("sin push configurado no envía nada y no acumula avisos pendientes", async () => {
    await guardarSuscripcion(db, ana, sub("ana"));
    await aviso(ana, "Hola");
    expect(await despacharPush(db, null, ahora)).toEqual({ avisos: 1, enviados: 0, caducadas: 0, errores: 0 });
    const e = enviador();
    expect((await despacharPush(db, e.enviar, ahora)).avisos).toBe(0);
    expect(e.enviados).toHaveLength(0);
  });

  it("un dispositivo pasa a quien inicia sesión en él, y exige una suscripción https válida", async () => {
    await guardarSuscripcion(db, ana, sub("compartido"));
    await guardarSuscripcion(db, luis, sub("compartido"));
    const filas = await db.select().from(schema.suscripcionesPush).where(eq(schema.suscripcionesPush.endpoint, "https://push.example/compartido"));
    expect(filas).toHaveLength(1);
    expect(filas[0].usuarioId).toBe(luis.id);
    await expect(guardarSuscripcion(db, ana, { ...sub("x"), endpoint: "http://inseguro.example/x" })).rejects.toThrow(ErrorDeNegocio);
    await expect(guardarSuscripcion(db, ana, { ...sub("x"), endpoint: "no es una url" })).rejects.toThrow(ErrorDeNegocio);
    await expect(guardarSuscripcion(db, ana, { ...sub("x"), auth: "" })).rejects.toThrow(ErrorDeNegocio);
  });
});
