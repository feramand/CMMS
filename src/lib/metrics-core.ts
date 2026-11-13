// Integración con Metrics: el conector envía lecturas de giros y detenciones; el CMMS solo recibe.
import { timingSafeEqual } from "node:crypto";
import { eq, or } from "drizzle-orm";
import type { DB } from "@/db";
import {
  activos,
  avisosSolicitud,
  bitacora,
  categoriaEnum,
  codigosFallaMetrics,
  eventosIntegracion,
  solicitudes,
  usuarios,
  type Categoria,
} from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import { nombreBd, TIPOS_BD } from "./categorias";
import { registrarLectura } from "./pautas-core";
import { registrarSolicitud } from "./sat-core";
import { ErrorDeNegocio } from "./usuarios-core";

/**
 * Tipos de Breakdown Downtime (BD) que puede tener un código de Metrics: BD Mecánico, BD Eléctrico,
 * BD SAC y BD General (el que llega sin clasificar). Solo estos códigos disparan una solicitud;
 * los demás Delay (ajustes operacionales, esperas) se ignoran.
 */
export const CATEGORIAS_METRICS: Categoria[] = TIPOS_BD.map((t) => t.valor);

export type Resultado = { resultado: "PROCESADO" | "IGNORADO" | "ERROR"; detalle: string };

/** Compara la clave del conector sin revelar por tiempo cuánto acertó. */
export function claveValida(recibida: string | null, esperada: string | undefined): boolean {
  if (!recibida || !esperada) return false;
  const a = Buffer.from(recibida);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

function instante(v: unknown): Date | null {
  const t = texto(v);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function maquinaPorCodigo(db: DB, codigo: string) {
  const [m] = await db
    .select({ id: activos.id, nombre: activos.nombre, estado: activos.estadoOperativo })
    .from(activos)
    .where(eq(activos.codigoMetrics, codigo));
  return m;
}

/** Lectura de giros acumulados: { codigoMaquina, giros, fechaHora? }. */
async function procesarGiros(db: DB, cuerpo: Record<string, unknown>): Promise<Resultado> {
  const codigo = texto(cuerpo.codigoMaquina);
  const giros = typeof cuerpo.giros === "number" ? cuerpo.giros : Number(texto(cuerpo.giros) || NaN);
  if (!codigo) return { resultado: "ERROR", detalle: "Falta codigoMaquina." };
  if (!Number.isSafeInteger(giros) || giros < 0) return { resultado: "ERROR", detalle: "giros debe ser un entero mayor o igual a cero." };
  const leidaEn = cuerpo.fechaHora === undefined ? undefined : instante(cuerpo.fechaHora);
  if (leidaEn === null) return { resultado: "ERROR", detalle: "fechaHora no es una fecha válida (ISO 8601)." };
  const maquina = await maquinaPorCodigo(db, codigo);
  if (!maquina) return { resultado: "ERROR", detalle: `Ninguna máquina tiene el código de Metrics "${codigo}".` };
  if (maquina.estado === "DESINSTALADO") return { resultado: "IGNORADO", detalle: `${maquina.nombre} está desinstalada.` };
  try {
    await registrarLectura(db, { activoId: maquina.id, giros, origen: "METRICS", leidaEn });
  } catch (e) {
    if (e instanceof ErrorDeNegocio) return { resultado: "ERROR", detalle: e.message };
    throw e;
  }
  return { resultado: "PROCESADO", detalle: `${maquina.nombre}: ${giros.toLocaleString("es-CL")} giros.` };
}

/**
 * Detención clasificada: { idApuntamiento, codigoMaquina, codigoFalla, fechaHora?, usuarioOperador? }.
 * Solo los códigos de la tabla de mantenimiento crean una solicitud; el resto se ignora.
 * El mismo apuntamiento nunca crea dos solicitudes, aunque llegue repetido o cambie de código.
 */
async function procesarDetencion(db: DB, cuerpo: Record<string, unknown>): Promise<Resultado> {
  const id = texto(cuerpo.idApuntamiento);
  const codigoMaquina = texto(cuerpo.codigoMaquina);
  const codigoFalla = texto(cuerpo.codigoFalla);
  if (!id || !codigoMaquina || !codigoFalla) {
    return { resultado: "ERROR", detalle: "Faltan idApuntamiento, codigoMaquina o codigoFalla." };
  }
  const detenidaEn = cuerpo.fechaHora === undefined ? undefined : instante(cuerpo.fechaHora);
  if (detenidaEn === null) return { resultado: "ERROR", detalle: "fechaHora no es una fecha válida (ISO 8601)." };
  const [codigo] = await db.select().from(codigosFallaMetrics).where(eq(codigosFallaMetrics.codigo, codigoFalla));
  if (!codigo || !codigo.activo) {
    return { resultado: "IGNORADO", detalle: `El código "${codigoFalla}" no está en la tabla de mantenimiento.` };
  }
  const [yaSolicitud] = await db.select({ id: solicitudes.id }).from(solicitudes).where(eq(solicitudes.idDetencionMetrics, id));
  const [yaAviso] = await db
    .select({ id: avisosSolicitud.solicitudId })
    .from(avisosSolicitud)
    .where(eq(avisosSolicitud.idDetencionMetrics, id));
  if (yaSolicitud || yaAviso) {
    return { resultado: "IGNORADO", detalle: `El apuntamiento ${id} ya generó la solicitud ${(yaSolicitud ?? yaAviso).id}.` };
  }
  const maquina = await maquinaPorCodigo(db, codigoMaquina);
  if (!maquina) return { resultado: "ERROR", detalle: `Ninguna máquina tiene el código de Metrics "${codigoMaquina}".` };
  const operador = texto(cuerpo.usuarioOperador).toLowerCase();
  const [persona] = operador
    ? await db.select({ id: usuarios.id }).from(usuarios).where(or(eq(usuarios.identificador, operador), eq(usuarios.identificador, texto(cuerpo.usuarioOperador))))
    : [];
  try {
    const { id: solicitudId, duplicada } = await registrarSolicitud(db, {
      activoId: maquina.id,
      categoria: codigo.categoria,
      comentario: `Metrics: ${codigoFalla}${codigo.descripcion ? ` · ${codigo.descripcion}` : ""}`,
      origen: "METRICS",
      creadaPor: persona?.id ?? null,
      idDetencionMetrics: id,
      detenidaEn,
    });
    return {
      resultado: "PROCESADO",
      detalle: duplicada
        ? `${maquina.nombre}: se sumó a la solicitud ${solicitudId}, ya abierta (${nombreBd(codigo.categoria)}).`
        : `${maquina.nombre}: solicitud ${solicitudId} creada (${nombreBd(codigo.categoria)}).`,
    };
  } catch (e) {
    if (e instanceof ErrorDeNegocio) return { resultado: "IGNORADO", detalle: e.message };
    throw e;
  }
}

/**
 * Fin de detención: { idApuntamiento, fechaHora }. La máquina volvió a producir.
 * Desde esa hora deja de contar el tiempo detenido de la solicitud que generó ese apuntamiento,
 * aunque la solicitud siga abierta. Los apuntamientos que no generaron solicitud se ignoran.
 */
async function procesarFin(db: DB, cuerpo: Record<string, unknown>): Promise<Resultado> {
  const id = texto(cuerpo.idApuntamiento);
  if (!id) return { resultado: "ERROR", detalle: "Falta idApuntamiento." };
  const fin = instante(cuerpo.fechaHora);
  if (!fin) return { resultado: "ERROR", detalle: "Falta fechaHora o no es una fecha válida (ISO 8601)." };
  const [directa] = await db.select({ id: solicitudes.id }).from(solicitudes).where(eq(solicitudes.idDetencionMetrics, id));
  const [porAviso] = directa
    ? []
    : await db.select({ id: avisosSolicitud.solicitudId }).from(avisosSolicitud).where(eq(avisosSolicitud.idDetencionMetrics, id));
  const solicitudId = (directa ?? porAviso)?.id;
  if (!solicitudId) return { resultado: "IGNORADO", detalle: `El apuntamiento ${id} no generó ninguna solicitud.` };
  const [s] = await db.select().from(solicitudes).where(eq(solicitudes.id, solicitudId));
  const desde = s.detenidaEn ?? s.creadaEn;
  if (fin < desde) return { resultado: "ERROR", detalle: "El fin de la detención es anterior a su inicio." };
  // Varias detenciones de una misma falla: vale la última vez que la máquina volvió a producir.
  if (s.reanudadaEn && s.reanudadaEn >= fin) return { resultado: "IGNORADO", detalle: `La solicitud ${solicitudId} ya tiene un fin de detención posterior.` };
  await db.update(solicitudes).set({ reanudadaEn: fin }).where(eq(solicitudes.id, solicitudId));
  return { resultado: "PROCESADO", detalle: `Solicitud ${solicitudId}: fin de detención registrado.` };
}

/** Procesa un mensaje del conector y lo deja registrado tal como llegó, con su resultado. */
export async function recibirDeMetrics(db: DB, tipo: "GIROS" | "DETENCION" | "FIN_DETENCION", cuerpo: unknown): Promise<Resultado> {
  let salida: Resultado;
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    salida = { resultado: "ERROR", detalle: "El cuerpo debe ser un objeto JSON." };
  } else {
    const datos = cuerpo as Record<string, unknown>;
    salida = tipo === "GIROS" ? await procesarGiros(db, datos) : tipo === "DETENCION" ? await procesarDetencion(db, datos) : await procesarFin(db, datos);
  }
  await db.insert(eventosIntegracion).values({ tipo, cuerpo: cuerpo ?? null, ...salida });
  return salida;
}

// ---------- Tabla de códigos de falla ----------

function exigirAdmin(actor: UsuarioSesion): void {
  if (actor.perfil !== "ADMINISTRADOR" && actor.perfil !== "JEFE_PLANIFICADOR") {
    throw new ErrorDeNegocio("Solo jefe, planificador o administrador editan los códigos de falla.");
  }
}

export function categoriaMetrics(valor: string): Categoria {
  // Se acepta con o sin el prefijo «BD»: "BD Mecánico", "Mecánica", "BD General", "Indeterminada"…
  const limpio = valor.trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^BD\s+/, "");
  const alias: Record<string, Categoria> = {
    MECANICO: "MECANICA", ELECTRICO: "ELECTRICA", INDETERMINADO: "INDETERMINADA", "NO SE": "INDETERMINADA",
    GENERAL: "INDETERMINADA", INDEFINIDO: "INDETERMINADA", INDEFINIDA: "INDETERMINADA",
  };
  const c = (alias[limpio] ?? limpio) as Categoria;
  if (!categoriaEnum.enumValues.includes(c) || !CATEGORIAS_METRICS.includes(c)) {
    throw new ErrorDeNegocio(`"${valor}" no es un tipo válido: usa BD Mecánico, BD Eléctrico, BD SAC o BD General.`);
  }
  return c;
}

/** Crea o actualiza un código de falla. */
export async function guardarCodigo(
  db: DB | Parameters<Parameters<DB["transaction"]>[0]>[0],
  actor: UsuarioSesion,
  datos: { codigo: string; descripcion?: string; categoria: string; activo?: boolean },
): Promise<void> {
  exigirAdmin(actor);
  const codigo = datos.codigo.trim();
  if (!codigo) throw new ErrorDeNegocio("Falta el código de falla.");
  const categoria = categoriaMetrics(datos.categoria);
  const descripcion = datos.descripcion?.trim() || null;
  await db
    .insert(codigosFallaMetrics)
    .values({ codigo, descripcion, categoria, activo: datos.activo ?? true })
    .onConflictDoUpdate({ target: codigosFallaMetrics.codigo, set: { descripcion, categoria, activo: datos.activo ?? true } });
  await db.insert(bitacora).values({
    usuarioId: actor.id,
    accion: "GUARDAR_CODIGO_METRICS",
    entidad: "codigo_falla_metrics",
    entidadId: codigo,
    detalle: { categoria, activo: datos.activo ?? true },
  });
}

/** Deja de generar solicitudes para ese código, sin borrarlo. */
export async function desactivarCodigo(db: DB, actor: UsuarioSesion, codigo: string): Promise<void> {
  exigirAdmin(actor);
  await db.update(codigosFallaMetrics).set({ activo: false }).where(eq(codigosFallaMetrics.codigo, codigo));
}
