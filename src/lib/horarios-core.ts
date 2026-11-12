// Horario semanal de los técnicos de horario fijo y calendario de feriados.
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { bitacora, feriados, fichasTecnico, parametros } from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import { HORAS_APAGADO_TURNO } from "./disponibilidad";
import type { Ejecutor } from "./notificar";
import { ErrorDeNegocio } from "./usuarios-core";

function exigirGestion(actor: UsuarioSesion): void {
  if (actor.perfil !== "ADMINISTRADOR" && actor.perfil !== "JEFE_PLANIFICADOR") {
    throw new ErrorDeNegocio("No tienes permiso para cambiar horarios o feriados.");
  }
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function guardarHorario(
  db: DB,
  actor: UsuarioSesion,
  usuarioId: number,
  datos: { dias: number[]; entrada: string; salida: string },
): Promise<void> {
  exigirGestion(actor);
  const dias = [...new Set(datos.dias)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort();
  if (dias.length === 0) throw new ErrorDeNegocio("Marca al menos un día laboral.");
  if (!HORA.test(datos.entrada) || !HORA.test(datos.salida)) {
    throw new ErrorDeNegocio("Escribe las horas de entrada y de salida.");
  }
  if (datos.entrada === datos.salida) throw new ErrorDeNegocio("La entrada y la salida no pueden ser iguales.");
  const [ficha] = await db
    .select({ modalidad: fichasTecnico.modalidad })
    .from(fichasTecnico)
    .where(eq(fichasTecnico.usuarioId, usuarioId));
  if (!ficha) throw new ErrorDeNegocio("El técnico no existe.");
  if (ficha.modalidad !== "HORARIO_FIJO") {
    throw new ErrorDeNegocio("El horario semanal es solo para técnicos de horario fijo.");
  }
  await db
    .update(fichasTecnico)
    .set({ diasLaborales: dias.join(","), horaEntrada: datos.entrada, horaSalida: datos.salida })
    .where(eq(fichasTecnico.usuarioId, usuarioId));
  await db.insert(bitacora).values({
    usuarioId: actor.id,
    accion: "GUARDAR_HORARIO",
    entidad: "usuario",
    entidadId: String(usuarioId),
    detalle: { dias, entrada: datos.entrada, salida: datos.salida },
  });
}

export async function agregarFeriado(db: DB, actor: UsuarioSesion, fecha: string, nombre: string): Promise<void> {
  exigirGestion(actor);
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !Number.isNaN(Date.parse(`${fecha}T12:00:00Z`));
  // Rechaza fechas como 2026-02-30, que Date.parse corrige en silencio.
  if (!valida || new Date(`${fecha}T12:00:00Z`).toISOString().slice(0, 10) !== fecha) {
    throw new ErrorDeNegocio("La fecha del feriado no es válida.");
  }
  if (!nombre.trim()) throw new ErrorDeNegocio("Escribe el nombre del feriado.");
  await db
    .insert(feriados)
    .values({ fecha, nombre: nombre.trim() })
    .onConflictDoUpdate({ target: feriados.fecha, set: { nombre: nombre.trim() } });
}

export async function quitarFeriado(db: DB, actor: UsuarioSesion, fecha: string): Promise<void> {
  exigirGestion(actor);
  await db.delete(feriados).where(eq(feriados.fecha, fecha));
}

/** Datos comunes para evaluar la disponibilidad: feriados y horas de apagado automático del turno. */
export async function contextoDisponibilidad(ex: Ejecutor): Promise<{ feriados: Set<string>; horasApagado: number }> {
  const [lista, [p]] = await Promise.all([
    ex.select({ fecha: feriados.fecha }).from(feriados),
    ex.select({ valor: parametros.valor }).from(parametros).where(eq(parametros.clave, "turno_horas_apagado")),
  ]);
  const horas = Number(p?.valor);
  return {
    feriados: new Set(lista.map((f) => f.fecha)),
    horasApagado: Number.isFinite(horas) && horas > 0 ? horas : HORAS_APAGADO_TURNO,
  };
}
