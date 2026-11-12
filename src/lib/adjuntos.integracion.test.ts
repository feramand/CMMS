import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { guardarFotos, MAX_BYTES, rutaAdjunto, tipoDeImagen } from "./adjuntos-core";
import type { UsuarioSesion } from "./auth-core";
import { ErrorDeNegocio } from "./usuarios-core";

const jpg = (n = 20) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(n).fill(7)]);
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const webp = () => new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);

describe("tipo de imagen por contenido", () => {
  it("reconoce JPG, PNG y WebP", () => {
    expect(tipoDeImagen(jpg())).toEqual({ tipo: "image/jpeg", extension: "jpg" });
    expect(tipoDeImagen(png())).toEqual({ tipo: "image/png", extension: "png" });
    expect(tipoDeImagen(webp())).toEqual({ tipo: "image/webp", extension: "webp" });
  });
  it("rechaza lo que no es imagen, aunque se llame .jpg", () => {
    expect(tipoDeImagen(new Uint8Array(Buffer.from("<script>alert(1)</script>")))).toBeNull();
    expect(tipoDeImagen(new Uint8Array(Buffer.from("%PDF-1.7")))).toBeNull();
    expect(tipoDeImagen(new Uint8Array([]))).toBeNull();
    expect(tipoDeImagen(new Uint8Array(Buffer.from("RIFF....WAVE")))).toBeNull();
  });
  it("solo acepta nombres de archivo generados por el sistema", () => {
    expect(rutaAdjunto("123e4567-e89b-12d3-a456-426614174000.jpg", "/datos")).toBe(
      "/datos/123e4567-e89b-12d3-a456-426614174000.jpg",
    );
    for (const malo of ["../../etc/passwd", "foto.jpg", "123e4567-e89b-12d3-a456-426614174000.exe", "a/b.png"]) {
      expect(() => rutaAdjunto(malo, "/datos")).toThrow(ErrorDeNegocio);
    }
  });
});

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("guardar fotos (integración)", () => {
  let pool: Pool;
  let db: DB;
  let carpeta: string;
  let actor: UsuarioSesion;
  let solicitudId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema }) as unknown as DB;
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    carpeta = await mkdtemp(path.join(os.tmpdir(), "adjuntos-"));
    await db.execute(sql`TRUNCATE adjuntos, solicitudes, activos, usuarios, plantas RESTART IDENTITY CASCADE`);
    const [u] = await db.insert(schema.usuarios).values({ nombre: "T", perfil: "TECNICO", identificador: "t", claveHash: "x" }).returning();
    actor = { id: u.id, nombre: "T", perfil: "TECNICO" };
    const [p] = await db.insert(schema.plantas).values({ nombre: "P1" }).returning();
    const [a] = await db.insert(schema.activos).values({ codigo: "A", nombre: "Máquina", plantaId: p.id }).returning();
    const [s] = await db.insert(schema.solicitudes).values({ activoId: a.id, categoria: "MECANICA", origen: "TECNICO" }).returning();
    solicitudId = s.id;
    return async () => {
      await rm(carpeta, { recursive: true, force: true });
    };
  });

  it("guarda el archivo con nombre aleatorio y lo registra con su tipo y tamaño reales", async () => {
    const n = await guardarFotos(db, actor, { solicitudId }, [{ nombre: "../../mala ruta.JPG", bytes: jpg(100) }, { nombre: "b.png", bytes: png() }], carpeta);
    expect(n).toBe(2);
    const filas = await db.select().from(schema.adjuntos);
    expect(filas.map((f) => f.tipo).sort()).toEqual(["image/jpeg", "image/png"]);
    const fila = filas.find((f) => f.tipo === "image/jpeg")!;
    expect(fila).toMatchObject({ solicitudId, otId: null, repuestoId: null, bytes: 104, subidoPor: actor.id });
    expect(fila.archivo).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect((await readdir(carpeta)).sort()).toEqual(filas.map((f) => f.archivo).sort());
    expect(new Uint8Array(await readFile(path.join(carpeta, fila.archivo)))).toEqual(jpg(100));
  });

  it("si una foto no es válida, no guarda ninguna", async () => {
    const texto = new Uint8Array(Buffer.from("no soy una foto"));
    await expect(
      guardarFotos(db, actor, { solicitudId }, [{ nombre: "a.jpg", bytes: jpg() }, { nombre: "virus.jpg", bytes: texto }], carpeta),
    ).rejects.toThrow("no es una foto");
    expect(await readdir(carpeta)).toEqual([]);
    expect(await db.select().from(schema.adjuntos)).toHaveLength(0);
  });

  it("limita a 3 fotos y a 10 MB cada una; ignora los campos vacíos", async () => {
    const cuatro = Array.from({ length: 4 }, (_, i) => ({ nombre: `${i}.jpg`, bytes: jpg() }));
    await expect(guardarFotos(db, actor, { solicitudId }, cuatro, carpeta)).rejects.toThrow("hasta 3 fotos");
    const grande = new Uint8Array(MAX_BYTES + 1);
    grande.set([0xff, 0xd8, 0xff]);
    await expect(guardarFotos(db, actor, { solicitudId }, [{ nombre: "g.jpg", bytes: grande }], carpeta)).rejects.toThrow("10 MB");
    expect(await guardarFotos(db, actor, { solicitudId }, [{ nombre: "", bytes: new Uint8Array() }], carpeta)).toBe(0);
    expect(await readdir(carpeta)).toEqual([]);
  });

  it("si el registro en la base falla, borra los archivos escritos", async () => {
    await expect(guardarFotos(db, actor, { solicitudId: 999999 }, [{ nombre: "a.jpg", bytes: jpg() }], carpeta)).rejects.toThrow();
    expect(await readdir(carpeta)).toEqual([]);
  });
});
