// Mantenimiento preventivo: pautas por tiempo y por giros, sus ciclos y las lecturas de contador.
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
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

// ---------- Grupos: quién hace cada actividad de la cartilla ----------

/** Operadores, o técnicos de una especialidad. Sin ninguno: la especialidad responsable de la cartilla. */
export type GrupoActividad = { operador: boolean; especialidadId: number | null };

const sinTildes = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIAS_ESPECIALIDAD: Record<string, string> = {
  mecanico: "MEC", mecanica: "MEC", mecanicos: "MEC",
  electrico: "ELE", electrica: "ELE", electricos: "ELE", electricidad: "ELE",
  serviciosgenerales: "SSGG", apoyocritico: "SAC",
};

/** Reconoce un grupo escrito a mano: "Operador", el nombre o el código de una especialidad. */
export function grupoPorNombre(
  nombre: string,
  lista: { id: number; codigo: string; nombre: string }[],
): GrupoActividad | null {
  const n = sinTildes(nombre);
  if (!n) return null;
  if (n === "operador" || n === "operadores" || n === "operacion") return { operador: true, especialidadId: null };
  const esp = lista.find((e) => sinTildes(e.nombre) === n || sinTildes(e.codigo) === n || e.codigo === ALIAS_ESPECIALIDAD[n]);
  return esp ? { operador: false, especialidadId: esp.id } : null;
}

/**
 * Una línea del checklist puede empezar con su grupo: "Operador: limpiar sensores" o
 * "Eléctrica: revisar tablero". Sin grupo reconocido, la hace la especialidad responsable.
 */
export function separarGrupo(linea: string, lista: { id: number; codigo: string; nombre: string }[]) {
  const corte = linea.indexOf(":");
  const grupo = corte > 0 ? grupoPorNombre(linea.slice(0, corte), lista) : null;
  const descripcion = (grupo ? linea.slice(corte + 1) : linea).trim();
  return { descripcion, ...(grupo ?? { operador: false, especialidadId: null }) };
}

type GrupoActor = { todos: true } | ({ todos: false } & GrupoActividad);

/** A qué grupo pertenece quien ejecuta: jefe y administrador pueden marcar cualquier actividad. */
async function grupoDe(ex: Ejecutor, actor: UsuarioSesion): Promise<GrupoActor> {
  if (gestiona(actor)) return { todos: true };
  if (actor.perfil === "OPERADOR") return { todos: false, operador: true, especialidadId: null };
  if (actor.perfil === "TECNICO") {
    const [ficha] = await ex.select({ esp: fichasTecnico.especialidadId }).from(fichasTecnico).where(eq(fichasTecnico.usuarioId, actor.id));
    return { todos: false, operador: false, especialidadId: ficha?.esp ?? null };
  }
  throw new ErrorDeNegocio("Tu perfil no ejecuta pautas.");
}

// Una actividad puede ser de los operadores, de una especialidad, o de cualquiera de los dos.
const esDelGrupo = (g: GrupoActor, a: GrupoActividad) =>
  g.todos || (a.operador && g.operador) || (!g.operador && g.especialidadId !== null && g.especialidadId === a.especialidadId);

export const MOTIVOS_NO_REALIZADA = {
  EN_PRODUCCION: "En producción",
  SIN_TECNICO: "Sin técnico",
  OTRO_TRABAJO: "Asignado a otro trabajo",
  OTRO: "Otro",
} as const;
export type MotivoNoRealizada = keyof typeof MOTIVOS_NO_REALIZADA;

/** Una tarea de la cartilla con su ficha completa. */
export type TareaDatos = GrupoActividad & {
  descripcion: string;
  codigo?: string | null;
  zona?: string | null;
  subsistema?: string | null;
  componente?: string | null;
  tipoTarea?: string | null;
  detencion?: string | null;
  insumos?: string | null;
  minutos?: number | null;
};

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
/** Cartillas activas de la misma máquina, del mismo tipo y de menor intervalo: la «rama inferior». */
async function inferioresDe(ex: Ejecutor, pauta: Pauta): Promise<Pauta[]> {
  if (!pauta.incluyeInferiores) return [];
  return ex
    .select()
    .from(pautas)
    .where(and(eq(pautas.activoId, pauta.activoId), eq(pautas.tipo, pauta.tipo), eq(pautas.activa, true), lt(pautas.intervalo, pauta.intervalo)))
    .orderBy(desc(pautas.intervalo), asc(pautas.id));
}

/**
 * Pasa un ciclo a Liberada: arma su checklist y avisa a los técnicos. Una cartilla mayor incluye
 * las tareas de las cartillas menores de la máquina (2.000.000 incluye 500.000 y 100.000); mientras
 * esté liberada, las menores quedan dentro de ella y no se ejecutan por separado.
 */
async function liberar(ex: Ejecutor, pauta: Pauta, maquina: string, cicloId: number, ahora: Date, por: number | null) {
  await ex
    .update(ciclosPauta)
    .set({ estado: "LIBERADA", liberadoEn: ahora, liberadoPor: por })
    .where(eq(ciclosPauta.id, cicloId));
  const inferiores = await inferioresDe(ex, pauta);
  const todas = [pauta, ...inferiores];
  const actividades = await ex
    .select()
    .from(actividadesPauta)
    .where(and(inArray(actividadesPauta.pautaId, todas.map((p) => p.id)), eq(actividadesPauta.activa, true)))
    .orderBy(asc(actividadesPauta.orden), asc(actividadesPauta.id));
  // Primero las tareas propias, después las de cada cartilla menor. Una tarea con el mismo
  // código en dos cartillas (como las «AB») entra una sola vez.
  const vistos = new Set<string>();
  const lista = todas.flatMap((dueña) =>
    actividades
      .filter((a) => a.pautaId === dueña.id)
      .filter((a) => {
        if (!a.codigo) return true;
        if (vistos.has(a.codigo)) return false;
        vistos.add(a.codigo);
        return true;
      })
      .map((a) => ({ ...a, dueña })),
  );
  if (lista.length) {
    await ex.insert(actividadesCiclo).values(
      lista.map((a, i) => ({
        cicloId,
        orden: i + 1,
        descripcion: a.descripcion,
        codigo: a.codigo,
        zona: a.zona,
        subsistema: a.subsistema,
        componente: a.componente,
        tipoTarea: a.tipoTarea,
        detencion: a.detencion,
        insumos: a.insumos,
        minutos: a.minutos,
        pautaOrigen: a.dueña.id === pauta.id ? null : a.dueña.nombre,
        operador: a.operador,
        especialidadId: a.operador ? a.especialidadId : (a.especialidadId ?? a.dueña.especialidadId),
      })),
    );
  }
  if (inferiores.length) {
    await ex
      .update(ciclosPauta)
      .set({ incluidoEnCicloId: cicloId })
      .where(and(inArray(ciclosPauta.pautaId, inferiores.map((p) => p.id)), inArray(ciclosPauta.estado, ["PROGRAMADA", "LIBERADA"])));
  }
  // Avisa a los técnicos de cada especialidad con actividades. A los operadores no se les
  // envía aviso: ven la cartilla en su inicio y al escanear el QR de la máquina.
  const involucradas = new Set([pauta.especialidadId, ...lista.filter((a) => a.especialidadId).map((a) => a.especialidadId!)]);
  const tecnicos = (await Promise.all([...involucradas].map((id) => tecnicosDe(ex, id)))).flat();
  await notificar(
    ex,
    [...tecnicos, ...(await idsPorPerfil(ex, "JEFE_PLANIFICADOR"))],
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
    if (ciclo.incluidoEnCicloId) {
      // Dentro de una cartilla mayor liberada no se libera ni se incumple por separado.
      const [mayor] = await ex
        .select({ estado: ciclosPauta.estado, activa: pautas.activa })
        .from(ciclosPauta)
        .innerJoin(pautas, eq(pautas.id, ciclosPauta.pautaId))
        .where(eq(ciclosPauta.id, ciclo.incluidoEnCicloId));
      if (mayor?.estado === "LIBERADA" && mayor.activa) return cambios;
      // La cartilla mayor se cerró o se desactivó: esta vuelve a correr sola.
      await ex.update(ciclosPauta).set({ incluidoEnCicloId: null }).where(eq(ciclosPauta.id, ciclo.id));
    }
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
  /** Tareas con su ficha completa (carga desde la planilla de cartillas). Tienen prioridad sobre `actividades`. */
  tareas?: TareaDatos[];
  /** Frecuencia teórica, solo de referencia. */
  frecuencia?: string | null;
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
      .values({
        activoId: maquina.id,
        tipo,
        intervalo: datos.intervalo,
        especialidadId: esp.id,
        creadaPor: actor.id,
        frecuencia: datos.frecuencia?.trim() || null,
        ...comunes,
      })
      .returning();
    const listaEsp = await tx.select().from(especialidades);
    const actividades: TareaDatos[] =
      datos.tareas ?? lineas(datos.actividades).map((l) => separarGrupo(l, listaEsp)).filter((a) => a.descripcion);
    if (actividades.length) {
      await tx.insert(actividadesPauta).values(actividades.map((a, i) => ({ pautaId: nueva.id, orden: i + 1, ...a })));
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
  datos: Pick<DatosPauta, "nombre" | "intervalo" | "especialidadId" | "pctLiberacion" | "pctLimite"> & {
    activa: boolean;
    /** Si se omite, no cambia. */
    incluyeInferiores?: boolean;
  },
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
      .set({
        ...comunes,
        intervalo: datos.intervalo,
        especialidadId: esp.id,
        activa: datos.activa,
        incluyeInferiores: datos.incluyeInferiores ?? actual.incluyeInferiores,
      })
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
export async function agregarActividad(
  db: DB,
  actor: UsuarioSesion,
  pautaId: number,
  descripcion: string,
  /** "OPERADOR", el id de una especialidad, o vacío para la especialidad responsable. */
  grupo = "",
): Promise<void> {
  exigirGestion(actor);
  const texto = descripcion.trim();
  if (!texto) throw new ErrorDeNegocio("Describe la actividad.");
  let quien: GrupoActividad = { operador: false, especialidadId: null };
  if (grupo === "OPERADOR") quien = { operador: true, especialidadId: null };
  else if (grupo) {
    const [esp] = await db.select({ id: especialidades.id }).from(especialidades).where(eq(especialidades.id, Number(grupo)));
    if (!esp) throw new ErrorDeNegocio("Elige quién hace la actividad.");
    quien = { operador: false, especialidadId: esp.id };
  }
  const existentes = await db.select({ orden: actividadesPauta.orden }).from(actividadesPauta).where(eq(actividadesPauta.pautaId, pautaId));
  const [pauta] = await db.select({ id: pautas.id }).from(pautas).where(eq(pautas.id, pautaId));
  if (!pauta) throw new ErrorDeNegocio("La pauta no existe.");
  await db.insert(actividadesPauta).values({ pautaId, descripcion: texto, orden: Math.max(0, ...existentes.map((e) => e.orden)) + 1, ...quien });
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

/**
 * Ciclo liberado, con su checklist y el grupo de quien actúa. Una cartilla puede tener
 * actividades de operadores y de varias especialidades: cada grupo marca solo las suyas.
 */
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
  if (fila.ciclo.incluidoEnCicloId) {
    const [mayor] = await tx
      .select({ nombre: pautas.nombre, estado: ciclosPauta.estado })
      .from(ciclosPauta)
      .innerJoin(pautas, eq(pautas.id, ciclosPauta.pautaId))
      .where(eq(ciclosPauta.id, fila.ciclo.incluidoEnCicloId));
    if (mayor?.estado === "LIBERADA") {
      throw new ErrorDeNegocio(`Esta cartilla está incluida en «${mayor.nombre}»: se ejecuta desde ahí.`);
    }
  }
  const grupo = await grupoDe(tx, actor);
  const checklist = await tx.select().from(actividadesCiclo).where(eq(actividadesCiclo.cicloId, cicloId));
  // Participa quien tiene actividades propias; en una cartilla sin checklist, la especialidad responsable.
  const participa =
    grupo.todos ||
    checklist.some((a) => esDelGrupo(grupo, a)) ||
    (checklist.length === 0 && !grupo.operador && grupo.especialidadId === fila.pauta.especialidadId);
  return { ...fila, grupo, checklist, participa };
}

function exigirParticipacion(c: { participa: boolean; grupo: GrupoActor }): void {
  if (c.participa) return;
  throw new ErrorDeNegocio(
    !c.grupo.todos && c.grupo.operador ? "Esta cartilla no tiene actividades de operador." : "Esta pauta es de otra especialidad.",
  );
}

/** Marca una actividad del checklist. La primera marca deja a la persona como responsable. */
export async function marcarActividad(
  db: DB,
  actor: UsuarioSesion,
  actividadId: number,
  estado: EstadoActividad,
  nota?: string,
  ahora = new Date(),
  motivoCrudo?: string,
): Promise<void> {
  const texto = nota?.trim() || null;
  // Sin motivo de la lista pero con explicación escrita, queda como «Otro».
  const motivo = motivoCrudo && motivoCrudo in MOTIVOS_NO_REALIZADA ? (motivoCrudo as MotivoNoRealizada) : texto ? "OTRO" : null;
  if (estado === "NO_REALIZADA" && (!motivo || (motivo === "OTRO" && !texto))) {
    throw new ErrorDeNegocio("Explica por qué no se realizó la actividad.");
  }
  await db.transaction(async (tx) => {
    const [actividad] = await tx.select().from(actividadesCiclo).where(eq(actividadesCiclo.id, actividadId));
    if (!actividad) throw new ErrorDeNegocio("La actividad no existe.");
    const { ciclo, grupo } = await cicloEjecutable(tx, actor, actividad.cicloId);
    if (!esDelGrupo(grupo, actividad)) {
      throw new ErrorDeNegocio(actividad.operador ? "Esta actividad la hacen los operadores." : "Esta actividad es de otra especialidad.");
    }
    const pendiente = estado === "PENDIENTE";
    await tx
      .update(actividadesCiclo)
      .set({
        estado,
        nota: pendiente ? null : texto,
        motivo: estado === "NO_REALIZADA" ? motivo : null,
        marcadaPor: pendiente ? null : actor.id,
        marcadaEn: pendiente ? null : ahora,
      })
      .where(eq(actividadesCiclo.id, actividadId));
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
    const ejecutable = await cicloEjecutable(tx, actor, cicloId);
    exigirParticipacion(ejecutable);
    const { ciclo, pauta, giros: contador, checklist } = ejecutable;
    const pendientes = checklist.filter((a) => a.estado === "PENDIENTE").length;
    if (pendientes > 0) {
      throw new ErrorDeNegocio(pendientes === 1 ? "Falta 1 actividad por marcar." : `Faltan ${pendientes} actividades por marcar.`);
    }
    const hoy = partesEnChile(ahora).fecha;
    let girosReales: number | null = contador;
    if (pauta.tipo === "GIROS") {
      // El operador no digita el contador: se usa la última lectura registrada.
      const leidos = (actor.perfil === "OPERADOR" ? null : datos.giros) ?? contador;
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
    const generales = await porcentajesGenerales(tx);
    await tx.insert(ciclosPauta).values({ pautaId: pauta.id, ...hitosDe(pauta, base, porcentajesDe(pauta, generales)) });
    // Las cartillas menores incluidas quedan ejecutadas con esta y parten de nuevo desde el mismo punto.
    const incluidos = await tx
      .select({ ciclo: ciclosPauta, pauta: pautas })
      .from(ciclosPauta)
      .innerJoin(pautas, eq(pautas.id, ciclosPauta.pautaId))
      .where(and(eq(ciclosPauta.incluidoEnCicloId, cicloId), inArray(ciclosPauta.estado, ["PROGRAMADA", "LIBERADA"])));
    for (const menor of incluidos) {
      await tx
        .update(ciclosPauta)
        .set({
          estado: "EJECUTADA",
          cerradoEn: ahora,
          ejecutadoPor: actor.id,
          girosReales,
          observaciones: `Incluida en «${pauta.nombre}».`,
        })
        .where(eq(ciclosPauta.id, menor.ciclo.id));
      await tx.insert(ciclosPauta).values({ pautaId: menor.pauta.id, ...hitosDe(menor.pauta, base, porcentajesDe(menor.pauta, generales)) });
    }
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
    const ejecutable = await cicloEjecutable(tx, actor, cicloId);
    if (actor.perfil === "OPERADOR") throw new ErrorDeNegocio("Los operadores reportan la falla; la orden de trabajo la deja un técnico.");
    exigirParticipacion(ejecutable);
    const { pauta, maquina } = ejecutable;
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
