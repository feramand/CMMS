// Lógica de ingreso, independiente de Next.js para poder probarla contra la base de datos.
import bcrypt from "bcryptjs";
import { eq, or, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { bitacora, usuarios, type Perfil } from "@/db/schema";
import { normalizarRut } from "./rut";

export const MAX_INTENTOS = 5;

// Hash de relleno: se compara cuando el usuario no existe, para que la respuesta tarde lo mismo.
const HASH_RELLENO = bcrypt.hashSync("clave-de-relleno", 10);

export type UsuarioSesion = { id: number; nombre: string; perfil: Perfil };

export type ResultadoIngreso =
  | { ok: true; usuario: UsuarioSesion }
  | { ok: false; motivo: "CREDENCIALES" | "BLOQUEADO" };

/** Convierte lo que escribe la persona en los valores con que se busca en la base. */
export function candidatosIdentificador(crudo: string): string[] {
  const texto = crudo.trim().toLowerCase();
  if (!texto) return [];
  const rut = normalizarRut(texto);
  return rut ? [rut, texto] : [texto];
}

export async function autenticar(
  db: DB,
  identificadorCrudo: string,
  clave: string,
): Promise<ResultadoIngreso> {
  const candidatos = candidatosIdentificador(identificadorCrudo);
  const condiciones = candidatos.flatMap((c) => [
    eq(usuarios.identificador, c),
    eq(usuarios.email, c),
  ]);
  const [usuario] = candidatos.length
    ? await db.select().from(usuarios).where(or(...condiciones)).limit(1)
    : [];

  if (!usuario || !usuario.activo) {
    await bcrypt.compare(clave, HASH_RELLENO);
    return { ok: false, motivo: "CREDENCIALES" };
  }
  if (usuario.bloqueado) return { ok: false, motivo: "BLOQUEADO" };

  const coincide = await bcrypt.compare(clave, usuario.claveHash);
  if (!coincide) {
    // Incremento atómico: dos intentos simultáneos no se pisan.
    const [tras] = await db
      .update(usuarios)
      .set({
        intentosFallidos: sql`${usuarios.intentosFallidos} + 1`,
        bloqueado: sql`${usuarios.intentosFallidos} + 1 >= ${MAX_INTENTOS}`,
      })
      .where(eq(usuarios.id, usuario.id))
      .returning({ bloqueado: usuarios.bloqueado });
    if (tras?.bloqueado) {
      await db.insert(bitacora).values({
        usuarioId: usuario.id,
        accion: "BLOQUEO_POR_INTENTOS",
        entidad: "usuario",
        entidadId: String(usuario.id),
      });
      return { ok: false, motivo: "BLOQUEADO" };
    }
    return { ok: false, motivo: "CREDENCIALES" };
  }

  await db
    .update(usuarios)
    .set({ intentosFallidos: 0, ultimoIngreso: new Date() })
    .where(eq(usuarios.id, usuario.id));
  return {
    ok: true,
    usuario: { id: usuario.id, nombre: usuario.nombre, perfil: usuario.perfil },
  };
}
