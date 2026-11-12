"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  COLUMNAS_ACTIVOS,
  COLUMNAS_USUARIOS,
  ErrorDeCarga,
  importarActivos,
  importarUsuarios,
} from "@/lib/carga-core";
import { COLUMNAS_CARTILLA, importarCartilla } from "@/lib/cartilla-core";
import { exigirPerfil } from "@/lib/dal";
import { leerPlanilla } from "@/lib/excel";
import { ErrorDeNegocio } from "@/lib/usuarios-core";

export type EstadoCarga = { ok?: string; error?: string; errores?: string[] } | undefined;

const MAX_BYTES = 5 * 1024 * 1024;

async function archivo(formData: FormData): Promise<ArrayBuffer> {
  const f = formData.get("planilla");
  if (!(f instanceof File) || f.size === 0) throw new ErrorDeNegocio("Elige el archivo de la planilla.");
  if (f.size > MAX_BYTES) throw new ErrorDeNegocio("La planilla pesa más de 5 MB.");
  return f.arrayBuffer();
}

function respuesta(e: unknown): EstadoCarga {
  if (e instanceof ErrorDeCarga) return { error: e.message, errores: e.errores };
  if (e instanceof ErrorDeNegocio) return { error: e.message };
  throw e;
}

export async function accionCargarActivos(_estado: EstadoCarga, formData: FormData): Promise<EstadoCarga> {
  const actor = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  try {
    const filas = await leerPlanilla(await archivo(formData), COLUMNAS_ACTIVOS);
    const n = await importarActivos(db, actor, filas);
    revalidatePath("/", "layout");
    return { ok: n === 1 ? "Se cargó 1 activo." : `Se cargaron ${n} activos.` };
  } catch (e) {
    return respuesta(e);
  }
}

export async function accionCargarUsuarios(_estado: EstadoCarga, formData: FormData): Promise<EstadoCarga> {
  const actor = await exigirPerfil("ADMINISTRADOR");
  try {
    const filas = await leerPlanilla(await archivo(formData), COLUMNAS_USUARIOS);
    const n = await importarUsuarios(db, actor, filas);
    revalidatePath("/", "layout");
    return { ok: n === 1 ? "Se cargó 1 usuario." : `Se cargaron ${n} usuarios.` };
  } catch (e) {
    return respuesta(e);
  }
}

export async function accionCargarCartilla(_estado: EstadoCarga, formData: FormData): Promise<EstadoCarga> {
  const actor = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  try {
    const filas = await leerPlanilla(await archivo(formData), COLUMNAS_CARTILLA);
    const r = await importarCartilla(db, actor, Number(formData.get("activoId")), filas);
    revalidatePath("/", "layout");
    return {
      ok: `Se cargaron ${r.cartillas.length} cartillas con ${r.tareas} tareas: ${r.cartillas
        .map((c) => `${c.nombre} (${c.tareas} tareas, cada ${c.intervalo})`)
        .join("; ")}.`,
    };
  } catch (e) {
    return respuesta(e);
  }
}
