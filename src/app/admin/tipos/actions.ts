"use server";

import { db } from "@/db";
import { ejecutar, entero, texto } from "@/lib/accion";
import { exigirSesion } from "@/lib/dal";
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
} from "@/lib/sistemas-core";

export async function accionCrearTipo(formData: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/admin/tipos", async () => {
    const id = await crearTipo(db, actor, texto(formData.get("nombre")));
    return `/admin/tipos/${id}`;
  });
}

export async function accionRenombrarTipo(formData: FormData) {
  const actor = await exigirSesion();
  const id = entero(formData.get("id"));
  await ejecutar(`/admin/tipos/${id}`, () => renombrarTipo(db, actor, id, texto(formData.get("nombre"))));
}

export async function accionEliminarTipo(formData: FormData) {
  const actor = await exigirSesion();
  const id = entero(formData.get("id"));
  await ejecutar(`/admin/tipos/${id}`, async () => {
    await eliminarTipo(db, actor, id);
    return "/admin/tipos";
  });
}

// Las tres acciones del árbol sirven para la plantilla de un tipo ("tipo") y para el árbol
// propio de una máquina ("activo"); el formulario indica cuál y a quién pertenece.
function ambito(formData: FormData) {
  const deActivo = texto(formData.get("ambito")) === "activo";
  const duenoId = entero(formData.get("duenoId"));
  return { deActivo, duenoId, origen: deActivo ? `/admin/activos/${duenoId}` : `/admin/tipos/${duenoId}` };
}

export async function accionAgregarSistema(formData: FormData) {
  const actor = await exigirSesion();
  const { deActivo, duenoId, origen } = ambito(formData);
  const padre = texto(formData.get("padreId"));
  const padreId = padre ? entero(padre) : null;
  const nombre = texto(formData.get("nombre"));
  await ejecutar(origen, async () => {
    if (deActivo) await agregarSector(db, actor, duenoId, padreId, nombre);
    else await agregarSistemaTipo(db, actor, duenoId, padreId, nombre);
  });
}

export async function accionRenombrarSistema(formData: FormData) {
  const actor = await exigirSesion();
  const { deActivo, origen } = ambito(formData);
  const id = entero(formData.get("id"));
  const nombre = texto(formData.get("nombre"));
  await ejecutar(origen, () =>
    deActivo ? renombrarSector(db, actor, id, nombre) : renombrarSistemaTipo(db, actor, id, nombre),
  );
}

export async function accionEliminarSistema(formData: FormData) {
  const actor = await exigirSesion();
  const { deActivo, origen } = ambito(formData);
  const id = entero(formData.get("id"));
  await ejecutar(origen, async () => {
    if (deActivo) await eliminarSector(db, actor, id);
    else await eliminarSistemaTipo(db, actor, id);
  });
}

export async function accionAplicarPlantilla(formData: FormData) {
  const actor = await exigirSesion();
  const activoId = entero(formData.get("activoId"));
  await ejecutar(`/admin/activos/${activoId}`, async () => {
    await aplicarPlantilla(db, actor, activoId);
  });
}
