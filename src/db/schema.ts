import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  time,
  timestamp,
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

export type Usuario = typeof usuarios.$inferSelect;
export type Perfil = (typeof perfilEnum.enumValues)[number];
export type Modalidad = (typeof modalidadEnum.enumValues)[number];
