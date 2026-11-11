import "server-only";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import type { Perfil } from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";

export const COOKIE_SESION = "cmms_sesion";
const HORAS_SESION = 12;

function clave(): Uint8Array {
  const secreto = process.env.SESSION_SECRET;
  if (!secreto || secreto.length < 32) {
    throw new Error("SESSION_SECRET debe tener al menos 32 caracteres.");
  }
  return new TextEncoder().encode(secreto);
}

export async function leerToken(token: string | undefined): Promise<UsuarioSesion | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, clave(), { algorithms: ["HS256"] });
    return {
      id: Number(payload.sub),
      nombre: String(payload.nombre),
      perfil: payload.perfil as Perfil,
    };
  } catch {
    return null;
  }
}

export async function crearSesion(usuario: UsuarioSesion): Promise<void> {
  const expira = new Date(Date.now() + HORAS_SESION * 60 * 60 * 1000);
  const token = await new SignJWT({ nombre: usuario.nombre, perfil: usuario.perfil })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(usuario.id))
    .setIssuedAt()
    .setExpirationTime(expira)
    .sign(clave());
  (await cookies()).set(COOKIE_SESION, token, {
    httpOnly: true,
    // En producción el sistema se sirve siempre por HTTPS.
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SIN_HTTPS !== "1",
    sameSite: "lax",
    expires: expira,
    path: "/",
  });
}

export async function cerrarSesion(): Promise<void> {
  (await cookies()).delete(COOKIE_SESION);
}
