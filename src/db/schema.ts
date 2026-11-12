import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  time,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const perfilEnum = pgEnum("perfil", [
  "ADMINISTRADOR",
  "JEFE_PLANIFICADOR",
  "TECNICO",
  "OPERADOR",
  "BODEGUERO",
  "ABASTECIMIENTO",
]);

export const modalidadEnum = pgEnum("modalidad", ["HORARIO_FIJO", "TURNOS"]);

export const nivelEnum = pgEnum("nivel", ["BASICO", "INTERMEDIO", "AVANZADO"]);

export const plantas = pgTable("plantas", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull().unique(),
  activa: boolean("activa").notNull().default(true),
});

export const especialidades = pgTable("especialidades", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull().unique(),
  nombre: text("nombre").notNull().unique(),
  activa: boolean("activa").notNull().default(true),
});

export const turnos = pgTable("turnos", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull().unique(),
  horaInicio: time("hora_inicio").notNull(),
  horaFin: time("hora_fin").notNull(),
});

export const usuarios = pgTable("usuarios", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  perfil: perfilEnum("perfil").notNull(),
  // RUT normalizado (12345678-5) o, para operadores, su usuario de Metrics en minúsculas.
  identificador: text("identificador").notNull().unique(),
  email: text("email").unique(),
  // Hash bcrypt del PIN o de la contraseña. Nunca se guarda la clave en claro.
  claveHash: text("clave_hash").notNull(),
  intentosFallidos: integer("intentos_fallidos").notNull().default(0),
  bloqueado: boolean("bloqueado").notNull().default(false),
  activo: boolean("activo").notNull().default(true),
  // Permiso por persona: autorizar órdenes de compra (jefe de mantenimiento, gerente de producción).
  puedeAutorizarOc: boolean("puede_autorizar_oc").notNull().default(false),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  ultimoIngreso: timestamp("ultimo_ingreso", { withTimezone: true }),
});

export const fichasTecnico = pgTable("fichas_tecnico", {
  usuarioId: integer("usuario_id")
    .primaryKey()
    .references(() => usuarios.id, { onDelete: "cascade" }),
  especialidadId: integer("especialidad_id")
    .notNull()
    .references(() => especialidades.id),
  modalidad: modalidadEnum("modalidad").notNull(),
  // Visible solo para perfiles administrativos.
  nivel: nivelEnum("nivel"),
  enTurno: boolean("en_turno").notNull().default(false),
  turnoDesde: timestamp("turno_desde", { withTimezone: true }),
  // Horario semanal de los técnicos de horario fijo. Días: 1 = lunes … 7 = domingo, separados por coma.
  diasLaborales: text("dias_laborales"),
  horaEntrada: time("hora_entrada"),
  horaSalida: time("hora_salida"),
});

export const feriados = pgTable("feriados", {
  fecha: date("fecha").primaryKey(),
  nombre: text("nombre").notNull(),
});

export const parametros = pgTable("parametros", {
  clave: text("clave").primaryKey(),
  valor: text("valor").notNull(),
  descripcion: text("descripcion").notNull(),
});

export const bitacora = pgTable("bitacora", {
  id: serial("id").primaryKey(),
  fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
  usuarioId: integer("usuario_id").references(() => usuarios.id),
  accion: text("accion").notNull(),
  entidad: text("entidad").notNull(),
  entidadId: text("entidad_id"),
  detalle: jsonb("detalle"),
});

// ---------- Etapa 1: activos, solicitudes de atención (SAT) y órdenes de trabajo (OT) ----------

export const condicionEnum = pgEnum("condicion_llegada", ["NUEVA", "USADA"]);
export const estadoOperativoEnum = pgEnum("estado_operativo", [
  "OPERATIVA",
  "DETENIDA",
  "FUERA_DE_SERVICIO",
]);

export const activos = pgTable("activos", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull().unique(),
  nombre: text("nombre").notNull(),
  tipo: text("tipo"),
  fabricante: text("fabricante"),
  modelo: text("modelo"),
  numeroSerie: text("numero_serie"),
  formato: text("formato"),
  paisOrigen: text("pais_origen"),
  anioFabricacion: integer("anio_fabricacion"),
  anioLlegada: integer("anio_llegada"),
  anioInstalacion: integer("anio_instalacion"),
  condicionLlegada: condicionEnum("condicion_llegada"),
  plantaId: integer("planta_id")
    .notNull()
    .references(() => plantas.id),
  seccion: text("seccion"),
  estadoOperativo: estadoOperativoEnum("estado_operativo").notNull().default("OPERATIVA"),
  garantia: text("garantia"),
  // Código de la máquina en Metrics, para la integración de la etapa 2.
  codigoMetrics: text("codigo_metrics").unique(),
  girosAcumulados: bigint("giros_acumulados", { mode: "number" }),
  ultimaPreventiva: date("ultima_preventiva"),
  activo: boolean("activo").notNull().default(true),
});

// Sectores o componentes de cada máquina: alimentan la lista al cerrar una solicitud.
export const sectores = pgTable(
  "sectores",
  {
    id: serial("id").primaryKey(),
    activoId: integer("activo_id")
      .notNull()
      .references(() => activos.id, { onDelete: "cascade" }),
    nombre: text("nombre").notNull(),
  },
  (t) => [unique().on(t.activoId, t.nombre)],
);

export const categoriaEnum = pgEnum("categoria_falla", [
  "MECANICA",
  "ELECTRICA",
  "INDETERMINADA",
  "SAC",
  "SERVICIOS_GENERALES",
]);
export const origenSatEnum = pgEnum("origen_sat", ["METRICS", "OPERADOR", "TECNICO", "JEFE", "PAUTA"]);
export const estadoSatEnum = pgEnum("estado_sat", [
  "PENDIENTE",
  "EN_ATENCION",
  "SOLUCIONADA",
  "ESCALADA",
  "CERRADA",
  "ANULADA",
]);

export const tipoOtEnum = pgEnum("tipo_ot", ["CORRECTIVA", "PROGRAMADA", "PREVENTIVA", "MEJORA"]);
export const prioridadEnum = pgEnum("prioridad", ["BAJA", "MEDIA", "ALTA"]);
export const estadoOtEnum = pgEnum("estado_ot", [
  "CREADA",
  "ASIGNADA",
  "EN_CURSO",
  "ESPERA_REPUESTOS",
  "FINALIZADA",
  "CANCELADA",
]);

export const ordenesTrabajo = pgTable("ordenes_trabajo", {
  id: serial("id").primaryKey(),
  // Folio AANNNN: dos dígitos del año y correlativo anual.
  folio: text("folio").notNull().unique(),
  activoId: integer("activo_id")
    .notNull()
    .references(() => activos.id),
  tipo: tipoOtEnum("tipo").notNull(),
  descripcion: text("descripcion").notNull(),
  especialidadId: integer("especialidad_id")
    .notNull()
    .references(() => especialidades.id),
  prioridad: prioridadEnum("prioridad").notNull().default("MEDIA"),
  responsableId: integer("responsable_id").references(() => usuarios.id),
  proveedorExterno: text("proveedor_externo"),
  creadaEn: timestamp("creada_en", { withTimezone: true }).notNull().defaultNow(),
  creadaPor: integer("creada_por").references(() => usuarios.id),
  fechaProgramada: date("fecha_programada"),
  inicioEn: timestamp("inicio_en", { withTimezone: true }),
  terminoEn: timestamp("termino_en", { withTimezone: true }),
  observaciones: text("observaciones"),
  estado: estadoOtEnum("estado").notNull().default("CREADA"),
  // Análisis de causa raíz: opcional, no se exige para cerrar.
  rcaCausa: text("rca_causa"),
  rcaSolucion: text("rca_solucion"),
  rcaAcciones: text("rca_acciones"),
  rcaObservaciones: text("rca_observaciones"),
});

export const foliosOt = pgTable("folios_ot", {
  anio: integer("anio").primaryKey(),
  ultimo: integer("ultimo").notNull(),
});

export const solicitudes = pgTable("solicitudes", {
  id: serial("id").primaryKey(),
  activoId: integer("activo_id")
    .notNull()
    .references(() => activos.id),
  categoria: categoriaEnum("categoria").notNull(),
  origen: origenSatEnum("origen").notNull(),
  idDetencionMetrics: text("id_detencion_metrics").unique(),
  // Hora en que se detuvo la máquina (viene de Metrics); distinta de la creación de la solicitud.
  detenidaEn: timestamp("detenida_en", { withTimezone: true }),
  creadaEn: timestamp("creada_en", { withTimezone: true }).notNull().defaultNow(),
  creadaPor: integer("creada_por").references(() => usuarios.id),
  comentario: text("comentario"),
  estado: estadoSatEnum("estado").notNull().default("PENDIENTE"),
  responsableId: integer("responsable_id").references(() => usuarios.id),
  tomadaEn: timestamp("tomada_en", { withTimezone: true }),
  cerradaEn: timestamp("cerrada_en", { withTimezone: true }),
  sectorId: integer("sector_id").references(() => sectores.id),
  solucion: text("solucion"),
  // Origen real, obligatorio al cerrar una solicitud que llegó como indeterminada.
  origenReal: categoriaEnum("origen_real"),
  otId: integer("ot_id").references(() => ordenesTrabajo.id),
});

// Avisos repetidos de una misma falla: se vinculan a la solicitud abierta en vez de duplicarla.
export const avisosSolicitud = pgTable("avisos_solicitud", {
  id: serial("id").primaryKey(),
  solicitudId: integer("solicitud_id")
    .notNull()
    .references(() => solicitudes.id, { onDelete: "cascade" }),
  usuarioId: integer("usuario_id").references(() => usuarios.id),
  comentario: text("comentario"),
  fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
});

// Técnicos de apoyo de una solicitud o de una orden de trabajo.
export const apoyos = pgTable(
  "apoyos",
  {
    id: serial("id").primaryKey(),
    solicitudId: integer("solicitud_id").references(() => solicitudes.id, { onDelete: "cascade" }),
    otId: integer("ot_id").references(() => ordenesTrabajo.id, { onDelete: "cascade" }),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    registradoPor: integer("registrado_por").references(() => usuarios.id),
    fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.solicitudId, t.usuarioId), unique().on(t.otId, t.usuarioId)],
);

export const estadoRepuestoEnum = pgEnum("estado_solicitud_repuesto", [
  "PENDIENTE",
  "APROBADA",
  "ENTREGADA",
  "RECHAZADA",
]);

export const solicitudesRepuesto = pgTable("solicitudes_repuesto", {
  id: serial("id").primaryKey(),
  // La máquina se hereda del trabajo: el técnico no la digita.
  activoId: integer("activo_id")
    .notNull()
    .references(() => activos.id),
  solicitudId: integer("solicitud_id").references(() => solicitudes.id),
  otId: integer("ot_id").references(() => ordenesTrabajo.id),
  solicitanteId: integer("solicitante_id")
    .notNull()
    .references(() => usuarios.id),
  cantidad: integer("cantidad").notNull(),
  codigoFabricante: text("codigo_fabricante"),
  descripcion: text("descripcion").notNull(),
  estado: estadoRepuestoEnum("estado").notNull().default("PENDIENTE"),
  creadaEn: timestamp("creada_en", { withTimezone: true }).notNull().defaultNow(),
  resueltaEn: timestamp("resuelta_en", { withTimezone: true }),
  resueltaPor: integer("resuelta_por").references(() => usuarios.id),
});

export const notificaciones = pgTable("notificaciones", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id")
    .notNull()
    .references(() => usuarios.id, { onDelete: "cascade" }),
  mensaje: text("mensaje").notNull(),
  enlace: text("enlace"),
  creadaEn: timestamp("creada_en", { withTimezone: true }).notNull().defaultNow(),
  leidaEn: timestamp("leida_en", { withTimezone: true }),
  // Momento en que se intentó enviar al celular; null = todavía no despachada.
  pushEnviadaEn: timestamp("push_enviada_en", { withTimezone: true }),
});

// Dispositivos donde cada persona activó las notificaciones push.
export const suscripcionesPush = pgTable("suscripciones_push", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id")
    .notNull()
    .references(() => usuarios.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  creadaEn: timestamp("creada_en", { withTimezone: true }).notNull().defaultNow(),
});

// Fotos adjuntas a una solicitud, una orden de trabajo o una solicitud de repuesto.
export const adjuntos = pgTable("adjuntos", {
  id: serial("id").primaryKey(),
  solicitudId: integer("solicitud_id").references(() => solicitudes.id, { onDelete: "cascade" }),
  otId: integer("ot_id").references(() => ordenesTrabajo.id, { onDelete: "cascade" }),
  repuestoId: integer("repuesto_id").references(() => solicitudesRepuesto.id, { onDelete: "cascade" }),
  // Nombre del archivo en la carpeta de adjuntos (aleatorio; nunca el nombre original).
  archivo: text("archivo").notNull().unique(),
  tipo: text("tipo").notNull(),
  bytes: integer("bytes").notNull(),
  subidoPor: integer("subido_por").references(() => usuarios.id),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export type Usuario = typeof usuarios.$inferSelect;
export type Categoria = (typeof categoriaEnum.enumValues)[number];
export type EstadoSat = (typeof estadoSatEnum.enumValues)[number];
export type EstadoOt = (typeof estadoOtEnum.enumValues)[number];
export type Prioridad = (typeof prioridadEnum.enumValues)[number];
export type TipoOt = (typeof tipoOtEnum.enumValues)[number];
export type Perfil = (typeof perfilEnum.enumValues)[number];
export type Modalidad = (typeof modalidadEnum.enumValues)[number];
