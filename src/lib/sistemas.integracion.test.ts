// Tipos de máquina y árbol de sistemas contra una base real (DATABASE_URL_TEST).
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { actualizarActivo, crearActivo } from "./activos-core";
import { aplanar } from "./arbol";
import type { UsuarioSesion } from "./auth-core";
import { importarActivos } from "./carga-core";
import {
  agregarSector,
  agregarSistemaTipo,
  aplicarPlantilla,
  crearTipo,
  eliminarSector,
  eliminarSistemaTipo,
  eliminarTipo,
  renombrarSector,
  renombrarSistemaTipo,
  renombrarTipo,
} from "./sistemas-core";

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("tipos de máquina y árbol de sistemas (integración)", () => {
  let pool: Pool;
  let db: DB;
  let jefe: UsuarioSesion, tecnico: UsuarioSesion;
  let planta: number;

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
      sql`TRUNCATE solicitudes, sectores, activos, sistemas_tipo, tipos_maquina, bitacora, fichas_tecnico, usuarios, especialidades, plantas RESTART IDENTITY CASCADE`,
    );
    planta = (await db.insert(schema.plantas).values({ nombre: "Planta 1" }).returning())[0].id;
    const u = await db
      .insert(schema.usuarios)
      .values([
        { nombre: "Jefe", perfil: "JEFE_PLANIFICADOR", identificador: "12345678-5", claveHash: "x" },
        { nombre: "Técnico", perfil: "TECNICO", identificador: "15000001-7", claveHash: "x" },
      ])
      .returning();
    jefe = { id: u[0].id, nombre: "Jefe", perfil: "JEFE_PLANIFICADOR" };
    tecnico = { id: u[1].id, nombre: "Técnico", perfil: "TECNICO" };
  });

  /** Tipo "Prensa Offset Plana" con Marcador › Cabezal de succión › Ventosas, y Salida. */
  async function tipoConPlantilla() {
    const tipo = await crearTipo(db, jefe, "Prensa Offset Plana");
    const marcador = await agregarSistemaTipo(db, jefe, tipo, null, "Marcador");
    const cabezal = await agregarSistemaTipo(db, jefe, tipo, marcador, "Cabezal de succión");
    const ventosas = await agregarSistemaTipo(db, jefe, tipo, cabezal, "Ventosas");
    await agregarSistemaTipo(db, jefe, tipo, null, "Salida");
    return { tipo, marcador, cabezal, ventosas };
  }
  const rutas = async (activoId: number, soloActivos = true) =>
    aplanar(
      (await db.select().from(schema.sectores).where(eq(schema.sectores.activoId, activoId))).filter(
        (n) => n.activo || !soloActivos,
      ),
    ).map((n) => n.ruta);
  const RUTAS_PLANTILLA = ["Marcador", "Marcador › Cabezal de succión", "Marcador › Cabezal de succión › Ventosas", "Salida"];

  it("crea tipos sin repetir nombres y solo deja gestionar a jefe o administrador", async () => {
    const id = await crearTipo(db, jefe, "  Guillotina   Frontal ");
    expect((await db.select().from(schema.tiposMaquina))[0].nombre).toBe("Guillotina Frontal");
    await expect(crearTipo(db, jefe, "guillotina frontal")).rejects.toThrow("Ya existe");
    await expect(crearTipo(db, jefe, "  ")).rejects.toThrow("Escribe el nombre");
    await expect(crearTipo(db, tecnico, "Perforadora")).rejects.toThrow("No tienes permiso");
    await renombrarTipo(db, jefe, id, "Guillotina Trilateral");
    expect((await db.select().from(schema.tiposMaquina))[0].nombre).toBe("Guillotina Trilateral");
  });

  it("arma la plantilla con hasta 3 niveles y sin hermanos repetidos", async () => {
    const { tipo, marcador, cabezal, ventosas } = await tipoConPlantilla();
    await expect(agregarSistemaTipo(db, jefe, tipo, ventosas, "Goma")).rejects.toThrow("hasta 3 niveles");
    await expect(agregarSistemaTipo(db, jefe, tipo, marcador, "cabezal de succion")).rejects.toThrow("Ya existe");
    // El mismo nombre sí puede repetirse en otra rama.
    await agregarSistemaTipo(db, jefe, tipo, null, "Cabezal de succión");
    await expect(renombrarSistemaTipo(db, jefe, cabezal, "Marcador")).resolves.toBeUndefined();
    await expect(agregarSistemaTipo(db, jefe, 9999, null, "X")).rejects.toThrow("no existe");
    // Quitar un sistema se lleva lo que contiene.
    await eliminarSistemaTipo(db, jefe, marcador);
    expect((await db.select().from(schema.sistemasTipo)).map((n) => n.nombre).sort()).toEqual(["Cabezal de succión", "Salida"]);
  });

  it("una máquina nueva recibe la plantilla de su tipo, más sus sistemas propios", async () => {
    const { tipo } = await tipoConPlantilla();
    const id = await crearActivo(db, jefe, {
      codigo: "imp-001",
      nombre: "Heidelberg XL106",
      plantaId: planta,
      tipoMaquinaId: tipo,
      sectores: "Salida\nTorre de barniz",
    });
    expect(await rutas(id)).toEqual([...RUTAS_PLANTILLA, "Torre de barniz"]);
  });

  it("editar el árbol de una máquina no cambia la plantilla ni las otras máquinas", async () => {
    const { tipo } = await tipoConPlantilla();
    const a = await crearActivo(db, jefe, { codigo: "A", nombre: "A", plantaId: planta, tipoMaquinaId: tipo });
    const b = await crearActivo(db, jefe, { codigo: "B", nombre: "B", plantaId: planta, tipoMaquinaId: tipo });
    const nodos = await db.select().from(schema.sectores).where(eq(schema.sectores.activoId, a));
    const marcador = nodos.find((n) => n.nombre === "Marcador")!;
    const salida = nodos.find((n) => n.nombre === "Salida")!;
    expect(await eliminarSector(db, jefe, marcador.id)).toBe("BORRADO");
    await agregarSector(db, jefe, a, salida.id, "Pila de salida");
    await renombrarSector(db, jefe, salida.id, "Salida extendida");
    await expect(agregarSector(db, jefe, a, null, "salida extendida")).rejects.toThrow("Ya existe");
    await expect(agregarSector(db, tecnico, a, null, "Otro")).rejects.toThrow("No tienes permiso");
    expect(await rutas(a)).toEqual(["Salida extendida", "Salida extendida › Pila de salida"]);
    expect(await rutas(b)).toEqual(RUTAS_PLANTILLA);
    expect(await db.select().from(schema.sistemasTipo)).toHaveLength(4);
  });

  it("aplicar la plantilla agrega solo lo que falta y no borra lo propio", async () => {
    const { tipo, marcador } = await tipoConPlantilla();
    const id = await crearActivo(db, jefe, { codigo: "A", nombre: "A", plantaId: planta, tipoMaquinaId: tipo });
    await agregarSector(db, jefe, id, null, "Torre de barniz");
    expect(await aplicarPlantilla(db, jefe, id)).toBe(0);
    await agregarSistemaTipo(db, jefe, tipo, marcador, "Mesa de alimentación");
    await agregarSistemaTipo(db, jefe, tipo, null, "Cuerpo impresor 1");
    expect(await aplicarPlantilla(db, jefe, id)).toBe(2);
    expect(await rutas(id)).toEqual([
      "Cuerpo impresor 1",
      "Marcador",
      "Marcador › Cabezal de succión",
      "Marcador › Cabezal de succión › Ventosas",
      "Marcador › Mesa de alimentación",
      "Salida",
      "Torre de barniz",
    ]);
    const sinTipo = await crearActivo(db, jefe, { codigo: "B", nombre: "B", plantaId: planta });
    await expect(aplicarPlantilla(db, jefe, sinTipo)).rejects.toThrow("no tiene tipo");
  });

  it("al elegir tipo, una máquina sin árbol recibe la plantilla; una con árbol no se toca", async () => {
    const { tipo } = await tipoConPlantilla();
    const vacia = await crearActivo(db, jefe, { codigo: "A", nombre: "A", plantaId: planta });
    const conArbol = await crearActivo(db, jefe, { codigo: "B", nombre: "B", plantaId: planta, sectores: "Motor" });
    for (const [id, nombre] of [[vacia, "A"], [conArbol, "B"]] as const) {
      await actualizarActivo(db, jefe, id, { nombre, plantaId: planta, tipoMaquinaId: tipo, estadoOperativo: "OPERATIVA" });
    }
    expect(await rutas(vacia)).toEqual(RUTAS_PLANTILLA);
    expect(await rutas(conArbol)).toEqual(["Motor"]);
    await expect(
      actualizarActivo(db, jefe, vacia, { nombre: "A", plantaId: planta, tipoMaquinaId: 9999, estadoOperativo: "OPERATIVA" }),
    ).rejects.toThrow("ya no existe");
  });

  it("un sistema con historial no se borra: se desactiva con lo que contiene, y se puede reactivar", async () => {
    const { tipo } = await tipoConPlantilla();
    const id = await crearActivo(db, jefe, { codigo: "A", nombre: "A", plantaId: planta, tipoMaquinaId: tipo });
    const nodos = await db.select().from(schema.sectores).where(eq(schema.sectores.activoId, id));
    const marcador = nodos.find((n) => n.nombre === "Marcador")!;
    const ventosas = nodos.find((n) => n.nombre === "Ventosas")!;
    await db.insert(schema.solicitudes).values({
      activoId: id,
      categoria: "MECANICA",
      origen: "OPERADOR",
      creadaPor: jefe.id,
      estado: "SOLUCIONADA",
      sectorId: ventosas.id,
      solucion: "Cambio de ventosas",
    });
    expect(await eliminarSector(db, jefe, marcador.id)).toBe("DESACTIVADO");
    expect(await rutas(id)).toEqual(["Salida"]);
    expect(await rutas(id, false)).toEqual(RUTAS_PLANTILLA);
    // Aplicar la plantilla respeta lo que se quitó a propósito.
    expect(await aplicarPlantilla(db, jefe, id)).toBe(0);
    await agregarSector(db, jefe, id, null, "marcador");
    expect(await rutas(id)).toEqual(["marcador", "Salida"]);
  });

  it("solo se elimina un tipo que ninguna máquina usa", async () => {
    const { tipo } = await tipoConPlantilla();
    const id = await crearActivo(db, jefe, { codigo: "A", nombre: "A", plantaId: planta, tipoMaquinaId: tipo });
    await expect(eliminarTipo(db, jefe, tipo)).rejects.toThrow("1 máquina usa este tipo");
    await actualizarActivo(db, jefe, id, { nombre: "A", plantaId: planta, tipoMaquinaId: null, estadoOperativo: "OPERATIVA" });
    await eliminarTipo(db, jefe, tipo);
    expect(await db.select().from(schema.tiposMaquina)).toHaveLength(0);
    expect(await db.select().from(schema.sistemasTipo)).toHaveLength(0);
    // El árbol propio de la máquina se conserva.
    expect(await rutas(id)).toEqual(RUTAS_PLANTILLA);
  });

  it("la carga desde Excel reconoce el tipo por nombre y crea el que no existe", async () => {
    const { tipo } = await tipoConPlantilla();
    await importarActivos(db, jefe, [
      { codigo: "A", nombre: "A", planta: "Planta 1", tipo: "prensa offset plana" },
      { codigo: "B", nombre: "B", planta: "Planta 1", tipo: "Barnizadora UV" },
      { codigo: "C", nombre: "C", planta: "Planta 1", tipo: "barnizadora uv" },
    ]);
    const tipos = await db.select().from(schema.tiposMaquina);
    expect(tipos.map((t) => t.nombre).sort()).toEqual(["Barnizadora UV", "Prensa Offset Plana"]);
    const maquinas = await db.select().from(schema.activos).orderBy(schema.activos.codigo);
    expect(maquinas[0].tipoMaquinaId).toBe(tipo);
    expect(maquinas[1].tipoMaquinaId).toBe(maquinas[2].tipoMaquinaId);
    expect(await rutas(maquinas[0].id)).toEqual(RUTAS_PLANTILLA);
  });
});
