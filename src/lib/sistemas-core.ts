// Tipos de máquina y árbol de sistemas: la plantilla de cada tipo y el árbol propio de cada máquina.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { activos, bitacora, sectores, sistemasTipo, solicitudes, tiposMaquina } from "@/db/schema";
import { aplanar, conDescendientes, MAX_NIVELES, mismoNombre, type Nodo } from "./arbol";
import type { UsuarioSesion } from "./auth-core";
import { ErrorDeNegocio } from "./usuarios-core";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Conexion = DB | Tx;

function exigirGestion(actor: UsuarioSesion): void {
  if (actor.perfil !== "ADMINISTRADOR" && actor.perfil !== "JEFE_PLANIFICADOR") {
    throw new ErrorDeNegocio("No tienes permiso para gestionar activos.");
  }
}

function nombreValido(nombre: string, que: string): string {
  const limpio = nombre.trim().replace(/\s+/g, " ");
  if (!limpio) throw new ErrorDeNegocio(`Escribe el nombre del ${que}.`);
  if (limpio.length > 80) throw new ErrorDeNegocio("El nombre no puede pasar de 80 caracteres.");
  return limpio;
}

/** Valida un nodo nuevo (o renombrado) dentro de un árbol: nivel máximo y sin hermanos repetidos. */
function validarEnArbol(nodos: Nodo[], padreId: number | null, nombre: string, propioId?: number): void {
  if (padreId !== null) {
    const padre = aplanar(nodos).find((n) => n.id === padreId);
    if (!padre) throw new ErrorDeNegocio("El sistema al que quieres agregar ya no existe.");
    if (padre.nivel >= MAX_NIVELES) {
      throw new ErrorDeNegocio(`El árbol admite hasta ${MAX_NIVELES} niveles: sistema, subsistema y componente.`);
    }
  }
  if (nodos.some((n) => n.padreId === padreId && n.id !== propioId && mismoNombre(n.nombre, nombre))) {
    throw new ErrorDeNegocio(`Ya existe "${nombre}" en ese nivel.`);
  }
}

// ---------- Tipos de máquina ----------

/** Devuelve el tipo con ese nombre; si no existe, lo crea. Sin control de permisos: uso interno. */
export async function tipoPorNombre(db: Conexion, nombre: string): Promise<number> {
  const limpio = nombreValido(nombre, "tipo de máquina");
  const existentes = await db.select().from(tiposMaquina);
  const igual = existentes.find((t) => mismoNombre(t.nombre, limpio));
  if (igual) return igual.id;
  const [nuevo] = await db.insert(tiposMaquina).values({ nombre: limpio }).returning({ id: tiposMaquina.id });
  return nuevo.id;
}

export async function crearTipo(db: DB, actor: UsuarioSesion, nombre: string): Promise<number> {
  exigirGestion(actor);
  const limpio = nombreValido(nombre, "tipo de máquina");
  const existentes = await db.select().from(tiposMaquina);
  if (existentes.some((t) => mismoNombre(t.nombre, limpio))) {
    throw new ErrorDeNegocio("Ya existe un tipo de máquina con ese nombre.");
  }
  const [nuevo] = await db.insert(tiposMaquina).values({ nombre: limpio }).returning({ id: tiposMaquina.id });
  await db.insert(bitacora).values({
    usuarioId: actor.id,
    accion: "CREAR_TIPO_MAQUINA",
    entidad: "tipo_maquina",
    entidadId: String(nuevo.id),
    detalle: { nombre: limpio },
  });
  return nuevo.id;
}

export async function renombrarTipo(db: DB, actor: UsuarioSesion, id: number, nombre: string): Promise<void> {
  exigirGestion(actor);
  const limpio = nombreValido(nombre, "tipo de máquina");
  const existentes = await db.select().from(tiposMaquina);
  if (!existentes.some((t) => t.id === id)) throw new ErrorDeNegocio("El tipo de máquina no existe.");
  if (existentes.some((t) => t.id !== id && mismoNombre(t.nombre, limpio))) {
    throw new ErrorDeNegocio("Ya existe un tipo de máquina con ese nombre.");
  }
  await db.update(tiposMaquina).set({ nombre: limpio }).where(eq(tiposMaquina.id, id));
}

/** Solo se puede eliminar un tipo que ninguna máquina usa. Su plantilla se va con él. */
export async function eliminarTipo(db: DB, actor: UsuarioSesion, id: number): Promise<void> {
  exigirGestion(actor);
  const [uso] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activos)
    .where(eq(activos.tipoMaquinaId, id));
  if (uso.n > 0) {
    throw new ErrorDeNegocio(
      `No se puede eliminar: ${uso.n} ${uso.n === 1 ? "máquina usa" : "máquinas usan"} este tipo. Cámbiales el tipo primero.`,
    );
  }
  const borrados = await db.delete(tiposMaquina).where(eq(tiposMaquina.id, id)).returning({ nombre: tiposMaquina.nombre });
  if (borrados.length === 0) throw new ErrorDeNegocio("El tipo de máquina no existe.");
  await db.insert(bitacora).values({
    usuarioId: actor.id,
    accion: "ELIMINAR_TIPO_MAQUINA",
    entidad: "tipo_maquina",
    entidadId: String(id),
    detalle: { nombre: borrados[0].nombre },
  });
}

// ---------- Plantilla de sistemas de un tipo ----------

export async function agregarSistemaTipo(
  db: DB,
  actor: UsuarioSesion,
  tipoId: number,
  padreId: number | null,
  nombre: string,
): Promise<number> {
  exigirGestion(actor);
  const limpio = nombreValido(nombre, "sistema");
  const [tipo] = await db.select({ id: tiposMaquina.id }).from(tiposMaquina).where(eq(tiposMaquina.id, tipoId));
  if (!tipo) throw new ErrorDeNegocio("El tipo de máquina no existe.");
  const nodos = await db.select().from(sistemasTipo).where(eq(sistemasTipo.tipoId, tipoId));
  validarEnArbol(nodos, padreId, limpio);
  const [nuevo] = await db
    .insert(sistemasTipo)
    .values({ tipoId, padreId, nombre: limpio })
    .returning({ id: sistemasTipo.id });
  return nuevo.id;
}

export async function renombrarSistemaTipo(db: DB, actor: UsuarioSesion, id: number, nombre: string): Promise<void> {
  exigirGestion(actor);
  const limpio = nombreValido(nombre, "sistema");
  const [nodo] = await db.select().from(sistemasTipo).where(eq(sistemasTipo.id, id));
  if (!nodo) throw new ErrorDeNegocio("El sistema ya no existe.");
  const nodos = await db.select().from(sistemasTipo).where(eq(sistemasTipo.tipoId, nodo.tipoId));
  validarEnArbol(nodos, nodo.padreId, limpio, id);
  await db.update(sistemasTipo).set({ nombre: limpio }).where(eq(sistemasTipo.id, id));
}

/** Quita el sistema de la plantilla con todo lo que cuelga de él. No toca las máquinas ya creadas. */
export async function eliminarSistemaTipo(db: DB, actor: UsuarioSesion, id: number): Promise<void> {
  exigirGestion(actor);
  const borrados = await db.delete(sistemasTipo).where(eq(sistemasTipo.id, id)).returning({ id: sistemasTipo.id });
  if (borrados.length === 0) throw new ErrorDeNegocio("El sistema ya no existe.");
}

// ---------- Árbol de sistemas de una máquina ----------

/**
 * Copia a la máquina lo que le falte de la plantilla de su tipo. No borra ni renombra nada:
 * lo que ya existe (aunque esté desactivado) se respeta. Devuelve cuántos sistemas agregó.
 * Sin control de permisos: uso interno.
 */
export async function copiarPlantilla(db: Conexion, activoId: number): Promise<number> {
  const [maquina] = await db
    .select({ tipoId: activos.tipoMaquinaId })
    .from(activos)
    .where(eq(activos.id, activoId));
  if (!maquina) throw new ErrorDeNegocio("El activo no existe.");
  if (maquina.tipoId === null) throw new ErrorDeNegocio("Esta máquina no tiene tipo. Elígelo en la ficha primero.");
  const plantilla = aplanar(await db.select().from(sistemasTipo).where(eq(sistemasTipo.tipoId, maquina.tipoId)));
  const propios: Nodo[] = await db.select().from(sectores).where(eq(sectores.activoId, activoId));
  // Para cada nodo de la plantilla, el ID del nodo equivalente en la máquina.
  const equivalente = new Map<number, number>();
  let agregados = 0;
  for (const p of plantilla) {
    const padre = p.padreId === null ? null : (equivalente.get(p.padreId) ?? null);
    const existente = propios.find((n) => n.padreId === padre && mismoNombre(n.nombre, p.nombre));
    if (existente) {
      equivalente.set(p.id, existente.id);
      continue;
    }
    const [nuevo] = await db
      .insert(sectores)
      .values({ activoId, padreId: padre, nombre: p.nombre })
      .returning({ id: sectores.id });
    propios.push({ id: nuevo.id, padreId: padre, nombre: p.nombre });
    equivalente.set(p.id, nuevo.id);
    agregados++;
  }
  return agregados;
}

export async function aplicarPlantilla(db: DB, actor: UsuarioSesion, activoId: number): Promise<number> {
  exigirGestion(actor);
  return db.transaction((tx) => copiarPlantilla(tx, activoId));
}

export async function agregarSector(
  db: DB,
  actor: UsuarioSesion,
  activoId: number,
  padreId: number | null,
  nombre: string,
): Promise<void> {
  exigirGestion(actor);
  const limpio = nombreValido(nombre, "sistema");
  const [maquina] = await db.select({ id: activos.id }).from(activos).where(eq(activos.id, activoId));
  if (!maquina) throw new ErrorDeNegocio("El activo no existe.");
  const todos = await db.select().from(sectores).where(eq(sectores.activoId, activoId));
  // Si ese sistema existió y fue desactivado, se reactiva en vez de duplicarlo.
  const desactivado = todos.find((n) => !n.activo && n.padreId === padreId && mismoNombre(n.nombre, limpio));
  if (desactivado) {
    await db.update(sectores).set({ activo: true, nombre: limpio }).where(eq(sectores.id, desactivado.id));
    return;
  }
  validarEnArbol(todos.filter((n) => n.activo), padreId, limpio);
  await db.insert(sectores).values({ activoId, padreId, nombre: limpio });
}

export async function renombrarSector(db: DB, actor: UsuarioSesion, id: number, nombre: string): Promise<void> {
  exigirGestion(actor);
  const limpio = nombreValido(nombre, "sistema");
  const [nodo] = await db.select().from(sectores).where(eq(sectores.id, id));
  if (!nodo) throw new ErrorDeNegocio("El sistema ya no existe.");
  const nodos = await db.select().from(sectores).where(and(eq(sectores.activoId, nodo.activoId), eq(sectores.activo, true)));
  validarEnArbol(nodos, nodo.padreId, limpio, id);
  await db.update(sectores).set({ nombre: limpio }).where(eq(sectores.id, id));
}

/**
 * Quita un sistema de la máquina junto con todo lo que cuelga de él. Si alguno tiene
 * solicitudes en el historial, no se borra: se desactiva, para no perder ese historial.
 */
export async function eliminarSector(db: DB, actor: UsuarioSesion, id: number): Promise<"BORRADO" | "DESACTIVADO"> {
  exigirGestion(actor);
  return db.transaction(async (tx) => {
    const [nodo] = await tx.select().from(sectores).where(eq(sectores.id, id));
    if (!nodo) throw new ErrorDeNegocio("El sistema ya no existe.");
    const todos = await tx.select().from(sectores).where(eq(sectores.activoId, nodo.activoId));
    const rama = conDescendientes(todos, id);
    const [uso] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(solicitudes)
      .where(inArray(solicitudes.sectorId, rama));
    if (uso.n > 0) {
      await tx.update(sectores).set({ activo: false }).where(inArray(sectores.id, rama));
      return "DESACTIVADO";
    }
    await tx.delete(sectores).where(eq(sectores.id, id));
    return "BORRADO";
  });
}

/**
 * Deja en el árbol de la máquina la ruta indicada (sistema › subsistema › componente), creando
 * lo que falte. No reactiva lo desactivado ni toca lo existente. Sin control de permisos: uso interno.
 */
export async function asegurarRuta(db: Conexion, activoId: number, nombres: string[]): Promise<void> {
  const propios = await db.select().from(sectores).where(eq(sectores.activoId, activoId));
  let padre: number | null = null;
  for (const crudo of nombres.slice(0, MAX_NIVELES)) {
    const nombre = crudo.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!nombre) return;
    const existente = propios.find((n) => n.padreId === padre && mismoNombre(n.nombre, nombre));
    if (existente) {
      padre = existente.id;
      continue;
    }
    const creados: (typeof propios)[number][] = await db.insert(sectores).values({ activoId, padreId: padre, nombre }).returning();
    propios.push(creados[0]);
    padre = creados[0].id;
  }
}
