"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { perfilEnum, type Modalidad, type Perfil } from "@/db/schema";
import { exigirPerfil } from "@/lib/dal";
import {
  cambiarActivo,
  crearUsuario,
  ErrorDeNegocio,
  restablecerClave,
} from "@/lib/usuarios-core";

export type EstadoFormulario = { error?: string; ok?: string } | undefined;

function mensaje(e: unknown): EstadoFormulario {
  if (e instanceof ErrorDeNegocio) return { error: e.message };
  throw e;
}

export async function accionCrearUsuario(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const actor = await exigirPerfil("ADMINISTRADOR");
  const perfil = String(formData.get("perfil")) as Perfil;
  if (!perfilEnum.enumValues.includes(perfil)) return { error: "Elige un perfil." };
  const modalidad = String(formData.get("modalidad") ?? "");
  try {
    await crearUsuario(db, actor, {
      nombre: String(formData.get("nombre") ?? ""),
      perfil,
      identificador: String(formData.get("identificador") ?? ""),
      email: String(formData.get("email") ?? ""),
      clave: String(formData.get("clave") ?? ""),
      puedeAutorizarOc: formData.get("puedeAutorizarOc") === "on",
      especialidadId: Number(formData.get("especialidadId")) || undefined,
      modalidad:
        modalidad === "HORARIO_FIJO" || modalidad === "TURNOS"
          ? (modalidad as Modalidad)
          : undefined,
    });
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/admin/usuarios");
  return { ok: "Usuario creado." };
}

export async function accionRestablecerClave(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const actor = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  try {
    await restablecerClave(
      db,
      actor,
      Number(formData.get("usuarioId")),
      String(formData.get("clave") ?? ""),
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/admin/usuarios");
  return { ok: "Clave restablecida." };
}

export async function accionCambiarActivo(formData: FormData): Promise<void> {
  const actor = await exigirPerfil("ADMINISTRADOR");
  await cambiarActivo(
    db,
    actor,
    Number(formData.get("usuarioId")),
    formData.get("activo") === "1",
  );
  revalidatePath("/admin/usuarios");
}
