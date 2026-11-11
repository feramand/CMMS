"use server";

import { redirect } from "next/navigation";
import { db } from "@/db";
import { autenticar } from "@/lib/auth-core";
import { rutaInicio } from "@/lib/perfiles";
import { cerrarSesion, crearSesion } from "@/lib/session";

export type EstadoIngreso = { error?: string } | undefined;

export async function ingresar(
  _estado: EstadoIngreso,
  formData: FormData,
): Promise<EstadoIngreso> {
  const identificador = String(formData.get("identificador") ?? "");
  const clave = String(formData.get("clave") ?? "");
  if (!identificador.trim() || !clave) {
    return { error: "Escribe tu identificador y tu clave." };
  }
  const resultado = await autenticar(db, identificador, clave);
  if (!resultado.ok) {
    return {
      error:
        resultado.motivo === "BLOQUEADO"
          ? "Usuario bloqueado por intentos fallidos. Pide al jefe de mantenimiento o al administrador que lo restablezca."
          : "Identificador o clave incorrectos.",
    };
  }
  await crearSesion(resultado.usuario);
  redirect(rutaInicio(resultado.usuario.perfil));
}

export async function salir(): Promise<void> {
  await cerrarSesion();
  redirect("/login");
}
