// Alta de usuarios y restablecimiento de claves, con sus reglas de permisos.
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import {
  bitacora,
  fichasTecnico,
  usuarios,
  type Modalidad,
  type Perfil,
} from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import {
  puedeGestionarUsuarios,
  puedeRestablecerClave,
  usaPin,
  usaUsuarioMetrics,
} from "./perfiles";
import { normalizarRut } from "./rut";

export class ErrorDeNegocio extends Error {}

/** Devuelve el mensaje de error, o null si la clave cumple la regla del perfil. */
export function validarClave(perfil: Perfil, clave: string): string | null {
  if (usaPin(perfil)) {
    return /^\d{4}$/.test(clave) ? null : "El PIN debe tener exactamente 4 dígitos.";
  }
  return clave.length >= 8 ? null : "La contraseña debe tener al menos 8 caracteres.";
}

/** Normaliza el identificador según el perfil; lanza ErrorDeNegocio si no es válido. */
export function normalizarIdentificador(perfil: Perfil, crudo: string): string {
  if (usaUsuarioMetrics(perfil)) {
    const usuario = crudo.trim().toLowerCase();
    if (!usuario) throw new ErrorDeNegocio("Falta el usuario de Metrics.");
    return usuario;
  }
  const rut = normalizarRut(crudo);
  if (!rut) throw new ErrorDeNegocio("El RUT no es válido.");
  return rut;
}

export type DatosUsuarioNuevo = {
  nombre: string;
  perfil: Perfil;
  identificador: string;
  email?: string | null;
  clave: string;
  puedeAutorizarOc?: boolean;
  // Obligatorios cuando el perfil es TECNICO.
  especialidadId?: number;
  modalidad?: Modalidad;
};

export async function crearUsuario(
  db: DB,
  actor: UsuarioSesion,
  datos: DatosUsuarioNuevo,
): Promise<number> {
  if (!puedeGestionarUsuarios(actor.perfil)) {
    throw new ErrorDeNegocio("Solo el administrador puede crear usuarios.");
  }
  const nombre = datos.nombre.trim();
  if (nombre.length < 3) throw new ErrorDeNegocio("Falta el nombre.");
  const identificador = normalizarIdentificador(datos.perfil, datos.identificador);
  const errorClave = validarClave(datos.perfil, datos.clave);
  if (errorClave) throw new ErrorDeNegocio(errorClave);
  const email = datos.email?.trim().toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ErrorDeNegocio("El correo no es válido.");
  }
  if (datos.perfil === "TECNICO" && (!datos.especialidadId || !datos.modalidad)) {
    throw new ErrorDeNegocio("Un técnico necesita especialidad y modalidad.");
  }

  const claveHash = await bcrypt.hash(datos.clave, 10);
  try {
    return await db.transaction(async (tx) => {
      const [nuevo] = await tx
        .insert(usuarios)
        .values({
          nombre,
          perfil: datos.perfil,
          identificador,
          email,
          claveHash,
          puedeAutorizarOc: datos.puedeAutorizarOc ?? false,
        })
        .returning({ id: usuarios.id });
      if (datos.perfil === "TECNICO") {
        await tx.insert(fichasTecnico).values({
          usuarioId: nuevo.id,
          especialidadId: datos.especialidadId!,
          modalidad: datos.modalidad!,
        });
      }
      await tx.insert(bitacora).values({
        usuarioId: actor.id,
        accion: "CREAR_USUARIO",
        entidad: "usuario",
        entidadId: String(nuevo.id),
        detalle: { perfil: datos.perfil, identificador },
      });
      return nuevo.id;
    });
  } catch (e) {
    // 23505 = violación de unicidad en PostgreSQL.
    const codigo = (e as { code?: string; cause?: { code?: string } }).cause?.code
      ?? (e as { code?: string }).code;
    if (codigo === "23505") {
      throw new ErrorDeNegocio("Ya existe un usuario con ese identificador o correo.");
    }
    throw e;
  }
}

/** Cambia la clave, quita el bloqueo y pone los intentos en cero. */
export async function restablecerClave(
  db: DB,
  actor: UsuarioSesion,
  usuarioId: number,
  nuevaClave: string,
): Promise<void> {
  const [objetivo] = await db
    .select({ perfil: usuarios.perfil })
    .from(usuarios)
    .where(eq(usuarios.id, usuarioId));
  if (!objetivo) throw new ErrorDeNegocio("El usuario no existe.");
  if (!puedeRestablecerClave(actor.perfil, objetivo.perfil)) {
    throw new ErrorDeNegocio("No tienes permiso para restablecer esta clave.");
  }
  const errorClave = validarClave(objetivo.perfil, nuevaClave);
  if (errorClave) throw new ErrorDeNegocio(errorClave);

  const claveHash = await bcrypt.hash(nuevaClave, 10);
  await db.transaction(async (tx) => {
    await tx
      .update(usuarios)
      .set({ claveHash, bloqueado: false, intentosFallidos: 0 })
      .where(eq(usuarios.id, usuarioId));
    await tx.insert(bitacora).values({
      usuarioId: actor.id,
      accion: "RESTABLECER_CLAVE",
      entidad: "usuario",
      entidadId: String(usuarioId),
    });
  });
}

export async function cambiarActivo(
  db: DB,
  actor: UsuarioSesion,
  usuarioId: number,
  activo: boolean,
): Promise<void> {
  if (!puedeGestionarUsuarios(actor.perfil)) {
    throw new ErrorDeNegocio("Solo el administrador puede activar o desactivar usuarios.");
  }
  if (actor.id === usuarioId && !activo) {
    throw new ErrorDeNegocio("No puedes desactivar tu propio usuario.");
  }
  await db.transaction(async (tx) => {
    await tx.update(usuarios).set({ activo }).where(eq(usuarios.id, usuarioId));
    await tx.insert(bitacora).values({
      usuarioId: actor.id,
      accion: activo ? "ACTIVAR_USUARIO" : "DESACTIVAR_USUARIO",
      entidad: "usuario",
      entidadId: String(usuarioId),
    });
  });
}

/** Interruptor "Estoy de turno" para técnicos de turnos rotativos. */
export async function marcarTurno(
  db: DB,
  actor: UsuarioSesion,
  enTurno: boolean,
): Promise<void> {
  const [ficha] = await db
    .select({ modalidad: fichasTecnico.modalidad })
    .from(fichasTecnico)
    .where(eq(fichasTecnico.usuarioId, actor.id));
  if (!ficha || ficha.modalidad !== "TURNOS") {
    throw new ErrorDeNegocio("El control de turno es solo para técnicos de turnos rotativos.");
  }
  await db.transaction(async (tx) => {
    await tx
      .update(fichasTecnico)
      .set({ enTurno, turnoDesde: enTurno ? new Date() : null })
      .where(eq(fichasTecnico.usuarioId, actor.id));
    await tx.insert(bitacora).values({
      usuarioId: actor.id,
      accion: enTurno ? "INICIO_TURNO" : "FIN_TURNO",
      entidad: "usuario",
      entidadId: String(actor.id),
    });
  });
}
