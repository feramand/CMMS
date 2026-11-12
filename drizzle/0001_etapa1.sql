CREATE TYPE "public"."categoria_falla" AS ENUM('MECANICA', 'ELECTRICA', 'INDETERMINADA', 'SAC', 'SERVICIOS_GENERALES');--> statement-breakpoint
CREATE TYPE "public"."condicion_llegada" AS ENUM('NUEVA', 'USADA');--> statement-breakpoint
CREATE TYPE "public"."estado_operativo" AS ENUM('OPERATIVA', 'DETENIDA', 'FUERA_DE_SERVICIO');--> statement-breakpoint
CREATE TYPE "public"."estado_ot" AS ENUM('CREADA', 'ASIGNADA', 'EN_CURSO', 'ESPERA_REPUESTOS', 'FINALIZADA', 'CANCELADA');--> statement-breakpoint
CREATE TYPE "public"."estado_solicitud_repuesto" AS ENUM('PENDIENTE', 'APROBADA', 'ENTREGADA', 'RECHAZADA');--> statement-breakpoint
CREATE TYPE "public"."estado_sat" AS ENUM('PENDIENTE', 'EN_ATENCION', 'SOLUCIONADA', 'ESCALADA', 'CERRADA', 'ANULADA');--> statement-breakpoint
CREATE TYPE "public"."origen_sat" AS ENUM('METRICS', 'OPERADOR', 'TECNICO', 'JEFE', 'PAUTA');--> statement-breakpoint
CREATE TYPE "public"."prioridad" AS ENUM('BAJA', 'MEDIA', 'ALTA');--> statement-breakpoint
CREATE TYPE "public"."tipo_ot" AS ENUM('CORRECTIVA', 'PROGRAMADA', 'PREVENTIVA', 'MEJORA');--> statement-breakpoint
CREATE TABLE "activos" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"tipo" text,
	"fabricante" text,
	"modelo" text,
	"numero_serie" text,
	"formato" text,
	"pais_origen" text,
	"anio_fabricacion" integer,
	"anio_llegada" integer,
	"anio_instalacion" integer,
	"condicion_llegada" "condicion_llegada",
	"planta_id" integer NOT NULL,
	"seccion" text,
	"estado_operativo" "estado_operativo" DEFAULT 'OPERATIVA' NOT NULL,
	"garantia" text,
	"codigo_metrics" text,
	"giros_acumulados" bigint,
	"ultima_preventiva" date,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "activos_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "activos_codigo_metrics_unique" UNIQUE("codigo_metrics")
);
--> statement-breakpoint
CREATE TABLE "apoyos" (
	"id" serial PRIMARY KEY NOT NULL,
	"solicitud_id" integer,
	"ot_id" integer,
	"usuario_id" integer NOT NULL,
	"registrado_por" integer,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apoyos_solicitud_id_usuario_id_unique" UNIQUE("solicitud_id","usuario_id"),
	CONSTRAINT "apoyos_ot_id_usuario_id_unique" UNIQUE("ot_id","usuario_id")
);
--> statement-breakpoint
CREATE TABLE "avisos_solicitud" (
	"id" serial PRIMARY KEY NOT NULL,
	"solicitud_id" integer NOT NULL,
	"usuario_id" integer,
	"comentario" text,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folios_ot" (
	"anio" integer PRIMARY KEY NOT NULL,
	"ultimo" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notificaciones" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_id" integer NOT NULL,
	"mensaje" text NOT NULL,
	"enlace" text,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"leida_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ordenes_trabajo" (
	"id" serial PRIMARY KEY NOT NULL,
	"folio" text NOT NULL,
	"activo_id" integer NOT NULL,
	"tipo" "tipo_ot" NOT NULL,
	"descripcion" text NOT NULL,
	"especialidad_id" integer NOT NULL,
	"prioridad" "prioridad" DEFAULT 'MEDIA' NOT NULL,
	"responsable_id" integer,
	"proveedor_externo" text,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creada_por" integer,
	"fecha_programada" date,
	"inicio_en" timestamp with time zone,
	"termino_en" timestamp with time zone,
	"observaciones" text,
	"estado" "estado_ot" DEFAULT 'CREADA' NOT NULL,
	"rca_causa" text,
	"rca_solucion" text,
	"rca_acciones" text,
	"rca_observaciones" text,
	CONSTRAINT "ordenes_trabajo_folio_unique" UNIQUE("folio")
);
--> statement-breakpoint
CREATE TABLE "sectores" (
	"id" serial PRIMARY KEY NOT NULL,
	"activo_id" integer NOT NULL,
	"nombre" text NOT NULL,
	CONSTRAINT "sectores_activo_id_nombre_unique" UNIQUE("activo_id","nombre")
);
--> statement-breakpoint
CREATE TABLE "solicitudes" (
	"id" serial PRIMARY KEY NOT NULL,
	"activo_id" integer NOT NULL,
	"categoria" "categoria_falla" NOT NULL,
	"origen" "origen_sat" NOT NULL,
	"id_detencion_metrics" text,
	"detenida_en" timestamp with time zone,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creada_por" integer,
	"comentario" text,
	"estado" "estado_sat" DEFAULT 'PENDIENTE' NOT NULL,
	"responsable_id" integer,
	"tomada_en" timestamp with time zone,
	"cerrada_en" timestamp with time zone,
	"sector_id" integer,
	"solucion" text,
	"origen_real" "categoria_falla",
	"ot_id" integer,
	CONSTRAINT "solicitudes_id_detencion_metrics_unique" UNIQUE("id_detencion_metrics")
);
--> statement-breakpoint
CREATE TABLE "solicitudes_repuesto" (
	"id" serial PRIMARY KEY NOT NULL,
	"activo_id" integer NOT NULL,
	"solicitud_id" integer,
	"ot_id" integer,
	"solicitante_id" integer NOT NULL,
	"cantidad" integer NOT NULL,
	"codigo_fabricante" text,
	"descripcion" text NOT NULL,
	"estado" "estado_solicitud_repuesto" DEFAULT 'PENDIENTE' NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"resuelta_en" timestamp with time zone,
	"resuelta_por" integer
);
--> statement-breakpoint
ALTER TABLE "activos" ADD CONSTRAINT "activos_planta_id_plantas_id_fk" FOREIGN KEY ("planta_id") REFERENCES "public"."plantas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apoyos" ADD CONSTRAINT "apoyos_solicitud_id_solicitudes_id_fk" FOREIGN KEY ("solicitud_id") REFERENCES "public"."solicitudes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apoyos" ADD CONSTRAINT "apoyos_ot_id_ordenes_trabajo_id_fk" FOREIGN KEY ("ot_id") REFERENCES "public"."ordenes_trabajo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apoyos" ADD CONSTRAINT "apoyos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apoyos" ADD CONSTRAINT "apoyos_registrado_por_usuarios_id_fk" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avisos_solicitud" ADD CONSTRAINT "avisos_solicitud_solicitud_id_solicitudes_id_fk" FOREIGN KEY ("solicitud_id") REFERENCES "public"."solicitudes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avisos_solicitud" ADD CONSTRAINT "avisos_solicitud_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_activo_id_activos_id_fk" FOREIGN KEY ("activo_id") REFERENCES "public"."activos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_especialidad_id_especialidades_id_fk" FOREIGN KEY ("especialidad_id") REFERENCES "public"."especialidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_responsable_id_usuarios_id_fk" FOREIGN KEY ("responsable_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_creada_por_usuarios_id_fk" FOREIGN KEY ("creada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sectores" ADD CONSTRAINT "sectores_activo_id_activos_id_fk" FOREIGN KEY ("activo_id") REFERENCES "public"."activos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_activo_id_activos_id_fk" FOREIGN KEY ("activo_id") REFERENCES "public"."activos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_creada_por_usuarios_id_fk" FOREIGN KEY ("creada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_responsable_id_usuarios_id_fk" FOREIGN KEY ("responsable_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_sector_id_sectores_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_ot_id_ordenes_trabajo_id_fk" FOREIGN KEY ("ot_id") REFERENCES "public"."ordenes_trabajo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes_repuesto" ADD CONSTRAINT "solicitudes_repuesto_activo_id_activos_id_fk" FOREIGN KEY ("activo_id") REFERENCES "public"."activos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes_repuesto" ADD CONSTRAINT "solicitudes_repuesto_solicitud_id_solicitudes_id_fk" FOREIGN KEY ("solicitud_id") REFERENCES "public"."solicitudes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes_repuesto" ADD CONSTRAINT "solicitudes_repuesto_ot_id_ordenes_trabajo_id_fk" FOREIGN KEY ("ot_id") REFERENCES "public"."ordenes_trabajo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes_repuesto" ADD CONSTRAINT "solicitudes_repuesto_solicitante_id_usuarios_id_fk" FOREIGN KEY ("solicitante_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes_repuesto" ADD CONSTRAINT "solicitudes_repuesto_resuelta_por_usuarios_id_fk" FOREIGN KEY ("resuelta_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;