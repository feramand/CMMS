// Mantenimiento preventivo: pautas por tiempo y por giros, sus ciclos y las lecturas de contador.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import {
  actividadesCiclo,
  actividadesPauta,
  activos,
  bitacora,
  ciclosPauta,
  especialidades,
  fichasTecnico,
  lecturasContador,
  ordenesTrabajo,
  parametros,
  pautas,
  usuarios,
  type EstadoActividad,
  type TipoPauta,
} from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import { idsPorPerfil, notificar, type Ejecutor } from "./notificar";
import {
  esFechaValida,
  hitosFecha,
  hitosGiros,
  PORCENTAJES_POR_DEFECTO,
  porcentajesValidos,
  type Porcentajes,
} from "./pautas-calculo";
import { siguienteFolio } from "./sat-core";
import { partesEnChile } from "./tiempo";
import { ErrorDeNegocio } from "./usuarios-core";

type Pauta = typeof pautas.$inferSelect;
type Ciclo = typeof ciclosPauta.$inferSelect;

const gestiona = (a: UsuarioSesion) => a.perfil === "ADMINISTRADOR" || a.perfil === "JEFE_PLANIFICADOR";

function exigirGestion(actor: UsuarioSesion): void {
  if (!gestiona(actor)) throw new ErrorDeNegocio("Solo jefe, planificador o administrador gestionan las pautas.");
}

/** Porcentajes generales (Configuración), usados cuando la pauta no define los suyos. */
export async function porcentajesGenerales(ex: Ejecutor): Promise<Porcentajes> {
  const filas = await ex
    .select()
    .from(parametros)
    .where(inArray(parametros.clave, ["pauta_pct_liberacion", "pauta_pct_limite"]));
  const valor = (clave: string, defecto: number) => {
    const n = Number(filas.find((f) => f.clave === clave)?.valor);
    return Number.isInteger(n) ? n : defecto;
  };
  const p = {
    liberacion: valor("pauta_pct_liberacion", PORCENTAJES_POR_DEFECTO.liberacion),
    limite: valor("pauta_pct_limite", PORCENTAJES_POR_DEFECTO.limite),
  };
  return porcentajesValidos(p) ? p : PORCENTAJES_POR_DEFECTO;
}

/** Cambia los porcentajes generales. Valen para los ciclos que se programen o recalculen desde ahora. */
export async function guardarPorcentajes(db: DB, actor: UsuarioSesion, p: Porcentajes): Promise<void> {
  exigirGestion(actor);
  if (!porcentajesValidos(p)) {
    throw new ErrorDeNegocio("Porcentajes no válidos: la liberación va de 1 a 100 y el límite de 100 a 300.");
  }
  for (const [clave, valor, descripcion] of [
    ["pauta_pct_liberacion", p.liberacion, "Porcentaje del intervalo en que se libera una pauta"],
    ["pauta_pct_limite", p.limite, "Porcentaje del intervalo en que una pauta queda incumplida"],
  ] as const) {
    await db
      .insert(parametros)
      .values({ clave, valor: String(valor), descripcion })
      .onConflictDoUpdate({ target: parametros.clave, set: { valor: String(valor) } });
  }
  await db.insert(bitacora).values({ usuarioId: actor.id, accion: "CAMBIAR_PORCENTAJES_PAUTA", entidad: "parametros", detalle: p });
}

function porcentajesDe(pauta: Pauta, generales: Porcentajes): Porcentajes {
  return { liberacion: pauta.pctLiberacion ?? generales.liberacion, limite: pauta.pctLimite ?? generales.limite };
}

/** Hitos del ciclo que parte en `base` (giros o fecha, según el tipo de pauta). */
function hitosDe(pauta: Pauta, base: number | string, p: Porcentajes) {
  if (pauta.tipo === "GIROS") {
    const h = hitosGiros(base as number, pauta.intervalo, p);
    return { baseGiros: base as number, liberacionGiros: h.liberacion, objetivoGiros: h.objetivo, limiteGiros: h.limite };
  }
  const h = hitosFecha(base as string, pauta.intervalo, p);
  return { baseFecha: base as string, liberacionFecha: h.liberacion, objetivoFecha: h.objetivo, limiteFecha: h.limite };
}

/** Técnicos activos de una especialidad: reciben los avisos de sus pautas. */
async function tecnicosDe(ex: Ejecutor, especialidadId: number): Promise<number[]> {
  const filas = await ex
    .select({ id: usuarios.id })
    .from(usuarios)
    .innerJoin(fichasTecnico, eq(fichasTecnico.usuarioId, usuarios.id))
    .where(and(eq(usuarios.perfil, "TECNICO"), eq(usuarios.activo, true), eq(fichasTecnico.especialidadId, especialidadId)));
  return filas.map((f) => f.id);
}

/** Pasa un ciclo a Liberada: copia el checklist vigente y avisa a los técnicos de la especialidad. */
async function liberar(ex: Ejecutor, pauta: Pauta, maquina: string, cicloId: number, ahora: Date, por: number | null) {
  await ex
    .update(ciclosPauta)
    .set({ estado: "LIBERADA", liberadoEn: ahora, liberadoPor: por })
    .where(eq(ciclosPauta.id, cicloId));
  const lista = await ex
    .select()
    .from(actividadesPauta)
    .where(and(eq(actividadesPauta.pautaId, pauta.id), eq(actividadesPauta.activa, true)))
    .orderBy(asc(actividadesPauta.orden), asc(actividadesPauta.id));
  if (lista.length) {
    await ex.insert(actividadesCiclo).values(lista.map((a) => ({ cicloId, orden: a.orden, descripcion: a.descripcion })));
  }
  await notificar(
    ex,
    [...(await tecnicosDe(ex, pauta.especialidadId)), ...(await idsPorPerfil(ex, "JEFE_PLANIFICADOR"))],
    `Pauta liberada: ${maquina} · ${pauta.nombre}`,
    `/pauta/${cicloId}`,
  );
}

/**
 * Revisa una pauta contra el contador o la fecha actual:
 * - Programada que llegó al porcentaje de liberación → Liberada.
 * - Liberada que pasó el 100 % → aviso de próxima a vencer (una sola vez).
 * - Cualquiera que llegó al límite → Incumplida, y el ciclo siguiente parte desde el
 *   objetivo anterior y queda liberado de inmediato (opción A).
 * Devuelve cuántos cambios de estado hizo.
 */
async function evaluarPauta(ex: Ejecutor, pautaId: number, generales: Porcentajes, ahora: Date): Promise<number> {
  // Bloquea la pauta: el reloj y una lectura de giros no la evalúan a la vez.
  const [fila] = await ex
    .select({ pauta: pautas, maquina: activos.nombre, giros: activos.girosAcumulados, estado: activos.estadoOperativo })
    .from(pautas)
    .innerJoin(activos, eq(activos.id, pautas.activoId))
    .where(eq(pautas.id, pautaId))
    .for("update", { of: pautas });
  if (!fila || !fila.pauta.activa || fila.estado === "DESINSTALADO") return 0;
  const { pauta, maquina } = fila;
  const p = porcentajesDe(pauta, generales);
  const hoy = partesEnChile(ahora).fecha;
  let cambios = 0;
  // Tope de vueltas: una pauta muy atrasada registra sus ciclos perdidos en varias pasadas.
  for (let vuelta = 0; vuelta < 60; vuelta++) {
    const [ciclo] = await ex
      .select()
      .from(ciclosPauta)
      .where(and(eq(ciclosPauta.pautaId, pautaId), inArray(ciclosPauta.estado, ["PROGRAMADA", "LIBERADA"])));
    if (!ciclo) return cambios;
    let enLiberacion: boolean, enObjetivo: boolean, vencida: boolean;
    if (pauta.tipo === "GIROS") {
      if (fila.giros === null) return cambios;
      enLiberacion = fila.giros >= ciclo.liberacionGiros!;
      enObjetivo = fila.giros >= ciclo.objetivoGiros!;
      vencida = fila.giros >= ciclo.limiteGiros!;
    } else {
      enLiberacion = hoy >= ciclo.liberacionFecha!;
      enObjetivo = hoy >= ciclo.objetivoFecha!;
      // El día límite todavía se puede ejecutar; se incumple al día siguiente.
      vencida = hoy > ciclo.limiteFecha!;
    }
    if (vencida) {
      await ex.update(ciclosPauta).set({ estado: "INCUMPLIDA", cerradoEn: ahora }).where(eq(ciclosPauta.id, ciclo.id));
      const base = pauta.tipo === "GIROS" ? ciclo.objetivoGiros! : ciclo.objetivoFecha!;
      const [siguiente] = await ex
        .insert(ciclosPauta)
        .values({ pautaId, ...hitosDe(pauta, base, p) })
        .returning({ id: ciclosPauta.id });
      await notificar(
        ex,
        await idsPorPerfil(ex, "JEFE_PLANIFICADOR", "ADMINISTRADOR"),
        `Pauta incumplida: ${maquina} · ${pauta.nombre}`,
        `/admin/preventivo/${pautaId}`,
      );
      await liberar(ex, pauta, maquina, siguiente.id, ahora, null);
      cambios += 2;
      continue;
    }
    if (ciclo.estado === "PROGRAMADA" && enLiberacion) {
      await liberar(ex, pauta, maquina, ciclo.id, ahora, null);
      cambios++;
      continue;
    }
    if (ciclo.estado === "LIBERADA" && enObjetivo && !ciclo.avisoObjetivoEn) {
      await ex.update(ciclosPauta).set({ avisoObjetivoEn: ahora }).where(eq(ciclosPauta.id, ciclo.id));
      await notificar(
        ex,
        [
          ...(await idsPorPerfil(ex, "JEFE_PLANIFICADOR")),
          ...(ciclo.responsableId ? [ciclo.responsableId] : await tecnicosDe(ex, pauta.especialidadId)),
        ],
        `Pauta próxima a vencer: ${maquina} · ${pauta.nombre}`,
        `/pauta/${ciclo.id}`,
      );
    }
    return cambios;
  }
  return cambios;
}

/** Evalúa todas las pautas activas, o solo las de una máquina. La usan el reloj y cada lectura de giros. */
export async function evaluarPautas(db: DB, opciones: { activoId?: number; ahora?: Date } = {}): Promise<number> {
  const ahora = opciones.ahora ?? new Date();
  const lista = await db
    .select({ id: pautas.id })
    .from(pautas)
    .where(and(eq(pautas.activa, true), opciones.activoId ? eq(pautas.activoId, opciones.activoId) : undefined));
  if (lista.length === 0) return 0;
  const generales = await porcentajesGenerales(db);
  let cambios = 0;
  for (const { id } of lista) {
    cambios += await db.transaction((tx) => evaluarPauta(tx, id, generales, ahora));
  }
  return cambios;
}

// ---------- Lecturas de contador ----------

/**
 * Guarda una lectura de giros acumulados y reevalúa las pautas por giros de la máquina.
 * El contador solo avanza: una lectura menor que la última se rechaza.
 */
export async function registrarLectura(
  db: DB,
  datos: { activoId: number; giros: number; origen: "METRICS" | "MANUAL"; registradaPor?: number | null; leidaEn?: Date },
  ahora = new Date(),
): Promise<void> {
  if (!Number.isSafeInteger(datos.giros) || datos.giros < 0) {
    throw new ErrorDeNegocio("Los giros deben ser un número entero, sin puntos ni decimales.");
  }
  await db.transaction(async (tx) => {
    const [maquina] = await tx
      .select({ giros: activos.girosAcumulados })
      .from(activos)
      .where(eq(activos.id, datos.activoId))
      .for("update");
    if (!maquina) throw new ErrorDeNegocio("El activo no existe.");
    if (maquina.giros !== null && datos.giros < maquina.giros) {
      throw new ErrorDeNegocio(
        `La lectura (${datos.giros.toLocaleString("es-CL")}) es menor que la última registrada (${maquina.giros.toLocaleString("es-CL")}).`,
      );
    }
    await tx.insert(lecturasContador).values({
      activoId: datos.activoId,
      giros: datos.giros,
      origen: datos.origen,
      registradaPor: datos.registradaPor ?? null,
      leidaEn: datos.leidaEn ?? ahora,
    });
    await tx.update(activos).set({ girosAcumulados: datos.giros }).where(eq(activos.id, datos.activoId));
  });
  await evaluarPautas(db, { activoId: datos.activoId, ahora });
}

export async function registrarLecturaManual(db: DB, actor: UsuarioSesion, activoId: number, giros: number): Promise<void> {
  exigirGestion(actor);
  await registrarLectura(db, { activoId, giros, origen: "MANUAL", registradaPor: actor.id });
}

// ---------- Pautas ----------

export type DatosPauta = {
  activoId: number;
  nombre: string;
  tipo: string;
  intervalo: number;
  especialidadId: number;
  /** Actividades del checklist, una por línea. */
  actividades?: string;
  /** Punto de partida del primer ciclo. Si falta: el contador actual o la fecha de hoy. */
  baseGiros?: number | null;
  baseFecha?: string | null;
  pctLiberacion?: number | null;
  pctLimite?: number | null;
};

function validarComunes(datos: Pick<DatosPauta, "nombre" | "intervalo" | "pctLiberacion" | "pctLimite">, tipo: TipoPauta) {
  const nombre = datos.nombre.trim();
  if (!nombre) throw new ErrorDeNegocio("Falta el nombre de la pauta.");
  if (!Number.isSafeInteger(datos.intervalo) || datos.intervalo < 1) {
    throw new ErrorDeNegocio(
      tipo === "GIROS" ? "El intervalo en giros debe ser un número entero mayor que cero." : "El intervalo en días debe ser un número entero mayor que cero.",
    );
  }
  const propios = datos.pctLiberacion != null || datos.pctLimite != null;
  if (propios) {
    if (datos.pctLiberacion == null || datos.pctLimite == null) {
      throw new ErrorDeNegocio("Indica los dos porcentajes de la pauta o deja ambos vacíos.");
    }
    if (!porcentajesValidos({ liberacion: datos.pctLiberacion, limite: datos.pctLimite })) {
      throw new ErrorDeNegocio("Porcentajes no válidos: la liberación va de 1 a 100 y el límite de 100 a 300.");
    }
  }
  return { nombre, pctLiberacion: datos.pctLiberacion ?? null, pctLimite: datos.pctLimite ?? null };
}

const lineas = (texto?: string) => (texto ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

export async function crearPauta(db: DB, actor: UsuarioSesion, datos: DatosPauta, ahora = new Date()): Promise<number> {
  exigirGestion(actor);
  if (datos.tipo !== "TIEMPO" && datos.tipo !== "GIROS") throw new ErrorDeNegocio("Elige si la pauta es por tiempo o por giros.");
  const tipo: TipoPauta = datos.tipo;
  const comunes = validarComunes(datos, tipo);
  const id = await db.transaction(async (tx) => {
    const [maquina] = await tx
      .select({ id: activos.id, giros: activos.girosAcumulados, estado: activos.estadoOperativo })
      .from(activos)
      .where(eq(activos.id, datos.activoId));
    if (!maquina) throw new ErrorDeNegocio("Elige una máquina.");
    if (maquina.estado === "DESINSTALADO") throw new ErrorDeNegocio("Esta máquina está desinstalada: no admite pautas nuevas.");
    const [esp] = await tx.select({ id: especialidades.id }).from(especialidades).where(eq(especialidades.id, datos.especialidadId));
    if (!esp) throw new ErrorDeNegocio("Elige la especialidad.");
    let base: number | string;
    if (tipo === "GIROS") {
      const giros = datos.baseGiros ?? maquina.giros;
      if (giros == null) {
        throw new ErrorDeNegocio("La máquina no tiene giros registrados: indica los giros de la última mantención o registra una lectura.");
      }
      if (!Number.isSafeInteger(giros) || giros < 0) throw new ErrorDeNegocio("Los giros de partida deben ser un número entero.");
      base = giros;
    } else {
      base = datos.baseFecha || partesEnChile(ahora).fecha;
      if (!esFechaValida(base)) throw new ErrorDeNegocio("La fecha de partida no es válida.");
    }
    const [nueva] = await tx
      .insert(pautas)
      .values({ activoId: maquina.id, tipo, intervalo: datos.intervalo, especialidadId: esp.id, creadaPor: actor.id, ...comunes })
      .returning();
    const actividades = lineas(datos.actividades);
    if (actividades.length) {
      await tx.insert(actividadesPauta).values(actividades.map((descripcion, i) => ({ pautaId: nueva.id, orden: i + 1, descripcion })));
    }
    await tx.insert(ciclosPauta).values({ pautaId: nueva.id, ...hitosDe(nueva, base, porcentajesDe(nueva, await porcentajesGenerales(tx))) });
    await tx.insert(bitacora).values({
      usuarioId: actor.id,
      accion: "CREAR_PAUTA",
      entidad: "pauta",
      entidadId: String(nueva.id),
      detalle: { nombre: nueva.nombre, tipo, intervalo: datos.intervalo, base },
    });
    return nueva.id;
  });
  await evaluarPautas(db, { activoId: datos.activoId, ahora });
  return id;
}

/**
 * Cambia nombre, intervalo, especialidad, porcentajes o si está activa. Si cambian el intervalo
 * o los porcentajes, el ciclo que aún no se libera se recalcula desde su misma base.
 */
export async function actualizarPauta(
  db: DB,
  actor: UsuarioSesion,
  id: number,
  datos: Pick<DatosPauta, "nombre" | "intervalo" | "especialidadId" | "pctLiberacion" | "pctLimite"> & { activa: boolean },
  ahora = new Date(),
): Promise<void> {
  exigirGestion(actor);
  const activoId = await db.transaction(async (tx) => {
    const [actual] = await tx.select().from(pautas).where(eq(pautas.id, id)).for("update");
    if (!actual) throw new ErrorDeNegocio("La pauta no existe.");
    const comunes = validarComunes(datos, actual.tipo);
    const [esp] = await tx.select({ id: especialidades.id }).from(especialidades).where(eq(especialidades.id, datos.especialidadId));
    if (!esp) throw new ErrorDeNegocio("Elige la especialidad.");
    const [nueva] = await tx
      .update(pautas)
      .set({ ...comunes, intervalo: datos.intervalo, especialidadId: esp.id, activa: datos.activa })
      .where(eq(pautas.id, id))
      .returning();
    const [abierto] = await tx
      .select()
      .from(ciclosPauta)
      .where(and(eq(ciclosPauta.pautaId, id), inArray(ciclosPauta.estado, ["PROGRAMADA", "LIBERADA"])));
    if (abierto) {
      const base = nueva.tipo === "GIROS" ? abierto.baseGiros! : abierto.baseFecha!;
      await tx
        .update(ciclosPauta)
        .set(hitosDe(nueva, base, porcentajesDe(nueva, await porcentajesGenerales(tx))))
        .where(eq(ciclosPauta.id, abierto.id));
    }
    await tx.insert(bitacora).values({
      usuarioId: actor.id,
      accion: "EDITAR_PAUTA",
      entidad: "pauta",
      entidadId: String(id),
      detalle: { ...comunes, intervalo: datos.intervalo, activa: datos.activa },
    });
    return actual.activoId;
  });
  await evaluarPautas(db, { activoId, ahora });
}

/** Agrega una actividad al checklist. Vale desde la próxima liberación. */
export async function agregarActividad(db: DB, actor: UsuarioSesion, pautaId: number, descripcion: string): Promise<void> {
  exigirGestion(actor);
  const texto = descripcion.trim();
  if (!texto) throw new ErrorDeNegocio("Describe la actividad.");
  const existentes = await db.select({ orden: actividadesPauta.orden }).from(actividadesPauta).where(eq(actividadesPauta.pautaId, pautaId));
  const [pauta] = await db.select({ id: pautas.id }).from(pautas).where(eq(pautas.id, pautaId));
  if (!pauta) throw new ErrorDeNegocio("La pauta no existe.");
  await db.insert(actividadesPauta).values({ pautaId, descripcion: texto, orden: Math.max(0, ...existentes.map((e) => e.orden)) + 1 });
}

/** Quita una actividad del checklist. Los ciclos ya liberados conservan su copia. */
export async function quitarActividad(db: DB, actor: UsuarioSesion, actividadId: number): Promise<void> {
  exigirGestion(actor);
  await db.update(actividadesPauta).set({ activa: false }).where(eq(actividadesPauta.id, actividadId));
}

// ---------- Ciclos: liberar, ejecutar ----------

/** Jefe o planificador liberan una pauta antes de su porcentaje. Queda registrado quién y cuándo. */
export async function liberarAnticipada(db: DB, actor: UsuarioSesion, cicloId: number, ahora = new Date()): Promise<void> {
  if (actor.perfil !== "JEFE_PLANIFICADOR" && actor.perfil !== "ADMINISTRADOR") {
    throw new ErrorDeNegocio("Solo jefe o planificador pueden liberar una pauta antes de tiempo.");
  }
  await db.transaction(async (tx) => {
    const [fila] = await tx
      .select({ ciclo: ciclosPauta, pauta: pautas, maquina: activos.nombre })
      .from(ciclosPauta)
      .innerJoin(pautas, eq(pautas.id, ciclosPauta.pautaId))
      .innerJoin(activos, eq(activos.id, pautas.activoId))
      .where(eq(ciclosPauta.id, cicloId))
      .for("update", { of: ciclosPauta });
    if (!fila) throw new ErrorDeNegocio("El ciclo no existe.");
    if (fila.ciclo.estado !== "PROGRAMADA") throw new ErrorDeNegocio("Esta pauta ya está liberada o cerrada.");
    await liberar(tx, fila.pauta, fila.maquina, cicloId, ahora, actor.id);
    await tx.insert(bitacora).values({
      usuarioId: actor.id,
      accion: "LIBERAR_PAUTA_ANTICIPADA",
      entidad: "ciclo_pauta",
      entidadId: String(cicloId),
      detalle: { pauta: fila.pauta.nombre },
    });
  });
}

/** Ciclo liberado que este usuario puede ejecutar: técnico de la especialidad, jefe o administrador. */
async function cicloEjecutable(tx: Ejecutor, actor: UsuarioSesion, cicloId: number) {
  const [fila] = await tx
    .select({ ciclo: ciclosPauta, pauta: pautas, maquina: activos.nombre, giros: activos.girosAcumulados })
    .from(ciclosPauta)
    .innerJoin(pautas, eq(pautas.id, ciclosPauta.pautaId))
    .innerJoin(activos, eq(activos.id, pautas.activoId))
    .where(eq(ciclosPauta.id, cicloId))
    .for("update", { of: ciclosPauta });
  if (!fila) throw new ErrorDeNegocio("La pauta no existe.");
  if (fila.ciclo.estado !== "LIBERADA") {
    throw new ErrorDeNegocio(fila.ciclo.estado === "PROGRAMADA" ? "Esta pauta todavía no está liberada." : "Esta pauta ya está cerrada.");
  }
  if (actor.perfil === "TECNICO") {
    const [ficha] = await tx.select({ esp: fichasTecnico.especialidadId }).from(fichasTecnico).where(eq(fichasTecnico.usuarioId, actor.id));
    if (ficha?.esp !== fila.pauta.especialidadId) throw new ErrorDeNegocio("Esta pauta es de otra especialidad.");
  } else if (!gestiona(actor)) {
    throw new ErrorDeNegocio("Tu perfil no ejecuta pautas.");
  }
  return fila;
}

/** Marca una actividad del checklist. La primera marca deja a la persona como responsable. */
export async function marcarActividad(
  db: DB,
  actor: UsuarioSesion,
  actividadId: number,
  estado: EstadoActividad,
  nota?: string,
  ahora = new Date(),
): Promise<void> {
  const texto = nota?.trim() || null;
  if (estado === "NO_REALIZADA" && !texto) throw new ErrorDeNegocio("Explica por qué no se realizó la actividad.");
  await db.transaction(async (tx) => {
    const [actividad] = await tx.select().from(actividadesCiclo).where(eq(actividadesCiclo.id, actividadId));
    if (!actividad) throw new ErrorDeNegocio("La actividad no existe.");
    const { ciclo } = await cicloEjecutable(tx, actor, actividad.cicloId);
    await tx.update(actividadesCiclo).set({ estado, nota: estado === "PENDIENTE" ? null : texto }).where(eq(actividadesCiclo.id, actividadId));
    if (!ciclo.iniciadoEn) {
      await tx.update(ciclosPauta).set({ iniciadoEn: ahora, responsableId: actor.id }).where(eq(ciclosPauta.id, ciclo.id));
    }
  });
}

/**
 * Finaliza la pauta: exige el checklist completo, guarda quién, cuándo y con cuántos giros,
 * actualiza «Última preventiva» y «Último MP» de la máquina y programa el ciclo siguiente
 * con base en el valor real (los giros o la fecha de hoy).
 */
export async function finalizarCiclo(
  db: DB,
  actor: UsuarioSesion,
  cicloId: number,
  datos: { giros?: number | null; observaciones?: string } = {},
  ahora = new Date(),
): Promise<void> {
  const activoId = await db.transaction(async (tx) => {
    const { ciclo, pauta, giros: contador } = await cicloEjecutable(tx, actor, cicloId);
    const checklist = await tx.select().from(actividadesCiclo).where(eq(actividadesCiclo.cicloId, cicloId));
    const pendientes = checklist.filter((a) => a.estado === "PENDIENTE").length;
    if (pendientes > 0) {
      throw new ErrorDeNegocio(`Faltan ${pendientes} ${pendientes === 1 ? "actividad" : "actividades"} por marcar.`);
    }
    const hoy = partesEnChile(ahora).fecha;
    let girosReales: number | null = contador;
    if (pauta.tipo === "GIROS") {
      const leidos = datos.giros ?? contador;
      if (leidos == null) throw new ErrorDeNegocio("Indica los giros actuales de la máquina.");
      if (!Number.isSafeInteger(leidos) || leidos < 0) throw new ErrorDeNegocio("Los giros deben ser un número entero, sin puntos ni decimales.");
      if (contador !== null && leidos < contador) {
        throw new ErrorDeNegocio(`Los giros (${leidos.toLocaleString("es-CL")}) son menores que la última lectura (${contador.toLocaleString("es-CL")}).`);
      }
      if (leidos !== contador) {
        await tx.insert(lecturasContador).values({ activoId: pauta.activoId, giros: leidos, origen: "MANUAL", registradaPor: actor.id, leidaEn: ahora });
      }
      girosReales = leidos;
    }
    await tx
      .update(ciclosPauta)
      .set({
        estado: "EJECUTADA",
        cerradoEn: ahora,
        ejecutadoPor: actor.id,
        responsableId: ciclo.responsableId ?? actor.id,
        iniciadoEn: ciclo.iniciadoEn ?? ahora,
        girosReales,
        observaciones: datos.observaciones?.trim() || null,
      })
      .where(eq(ciclosPauta.id, cicloId));
    await tx
      .update(activos)
      .set({ ultimaPreventiva: hoy, ultimoMp: pauta.nombre, ...(pauta.tipo === "GIROS" ? { girosAcumulados: girosReales } : {}) })
      .where(eq(activos.id, pauta.activoId));
    const base = pauta.tipo === "GIROS" ? girosReales! : hoy;
    await tx.insert(ciclosPauta).values({ pautaId: pauta.id, ...hitosDe(pauta, base, porcentajesDe(pauta, await porcentajesGenerales(tx))) });
    await notificar(
      tx,
      (await idsPorPerfil(tx, "JEFE_PLANIFICADOR")).filter((id) => id !== actor.id),
      `Pauta ejecutada: ${pauta.nombre} · ${actor.nombre}`,
      `/pauta/${cicloId}`,
    );
    return pauta.activoId;
  });
  // Una lectura nueva puede mover las otras pautas por giros de la máquina.
  await evaluarPautas(db, { activoId, ahora });
}

/** Desde una pauta en ejecución, el técnico deja una OT para una reparación que no se hace ahora. */
export async function crearOtDesdePauta(
  db: DB,
  actor: UsuarioSesion,
  cicloId: number,
  datos: { descripcion: string; prioridad?: string },
  ahora = new Date(),
): Promise<number> {
  const descripcion = datos.descripcion.trim();
  if (!descripcion) throw new ErrorDeNegocio("Describe el trabajo que hay que hacer.");
  const prioridad = datos.prioridad === "ALTA" || datos.prioridad === "BAJA" ? datos.prioridad : "MEDIA";
  return db.transaction(async (tx) => {
    const { pauta, maquina } = await cicloEjecutable(tx, actor, cicloId);
    const folio = await siguienteFolio(tx, ahora);
    const [ot] = await tx
      .insert(ordenesTrabajo)
      .values({
        folio,
        activoId: pauta.activoId,
        tipo: "CORRECTIVA",
        descripcion,
        especialidadId: pauta.especialidadId,
        prioridad,
        creadaPor: actor.id,
        cicloId,
      })
      .returning({ id: ordenesTrabajo.id });
    await notificar(
      tx,
      (await idsPorPerfil(tx, "JEFE_PLANIFICADOR", "ADMINISTRADOR")).filter((id) => id !== actor.id),
      `OT ${folio} desde pauta: ${maquina} · ${pauta.nombre}`,
      `/ot/${ot.id}`,
    );
    return ot.id;
  });
}

export type { Ciclo, Pauta };
