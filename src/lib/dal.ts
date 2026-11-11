import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { usuarios, type Perfil } from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import { rutaInicio } from "./perfiles";
import { COOKIE_SESION, leerToken } from "./session";

/**
 * Usuario de la sesión, verificado contra la base en cada solicitud:
 * si fue desactivado, bloqueado o cambió de perfil, la sesión deja de valer.
 */
export const usuarioActual = cache(async (): Promise<UsuarioSesion | null> => {
  const token = (await cookies()).get(COOKIE_SESION)?.value;
  const sesion = await leerToken(token);
  if (!sesion) return null;
  const [u] = await db
    .select({
      id: usuarios.id,
      nombre: usuarios.nombre,
      perfil: usuarios.perfil,
      activo: usuarios.activo,
      bloqueado: usuarios.bloqueado,
    })
    .from(usuarios)
    .where(eq(usuarios.id, sesion.id));
  if (!u || !u.activo || u.bloqueado) return null;
  return { id: u.id, nombre: u.nombre, perfil: u.perfil };
});

export async function exigirSesion(): Promise<UsuarioSesion> {
  const usuario = await usuarioActual();
  if (!usuario) redirect("/login");
  return usuario;
}

/** Exige uno de los perfiles indicados; si no, devuelve a la persona a su propio inicio. */
export async function exigirPerfil(...permitidos: Perfil[]): Promise<UsuarioSesion> {
  const usuario = await exigirSesion();
  if (!permitidos.includes(usuario.perfil)) redirect(rutaInicio(usuario.perfil));
  return usuario;
}
