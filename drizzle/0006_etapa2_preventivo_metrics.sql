CREATE TYPE "public"."estado_actividad" AS ENUM('PENDIENTE', 'HECHA', 'NO_REALIZADA');--> statement-breakpoint
CREATE TYPE "public"."estado_ciclo" AS ENUM('PROGRAMADA', 'LIBERADA', 'EJECUTADA', 'INCUMPLIDA');--> statement-breakpoint
CREATE TYPE "public"."origen_lectura" AS ENUM('METRICS', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."resultado_evento" AS ENUM('PROCESADO', 'IGNORADO', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."tipo_pauta" AS ENUM('TIEMPO', 'GIROS');--> statement-breakpoint
CREATE TABLE "actividades_ciclo" (
	"id" serial PRIMARY KEY NOT NULL,
	"ciclo_id" integer NOT NULL,
	"orden" integer NOT NULL,
	"descripcion" text NOT NULL,
	"estado" "estado_actividad" DEFAULT 'PENDIENTE' NOT NULL,
	"nota" text
);
--> statement-breakpoint
CREATE TABLE "actividades_pauta" (
	"id" serial PRIMARY KEY NOT NULL,
	"pauta_id" integer NOT NULL,
	"orden" integer NOT NULL,
	"descripcion" text NOT NULL,
	"activa" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ciclos_pauta" (
	"id" serial PRIMARY KEY NOT NULL,
	"pauta_id" integer NOT NULL,
	"estado" "estado_ciclo" DEFAULT 'PROGRAMADA' NOT NULL,
	"base_giros" bigint,
	"liberacion_giros" bigint,
	"objetivo_giros" bigint,
	"limite_giros" bigint,
	"base_fecha" date,
	"liberacion_fecha" date,
	"objetivo_fecha" date,
	"limite_fecha" date,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"liberado_en" timestamp with time zone,
	"liberado_por" integer,
	"aviso_objetivo_en" timestamp with time zone,
	"responsable_id" integer,
	"iniciado_en" timestamp with time zone,
	"cerrado_en" timestamp with time zone,
	"ejecutado_por" integer,
	"giros_reales" bigint,
	"observaciones" text
);
--> statement-breakpoint
CREATE TABLE "codigos_falla_metrics" (
	"codigo" text PRIMARY KEY NOT NULL,
	"descripcion" text,
	"categoria" "categoria_falla" NOT NULL,
	"activo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eventos_integracion" (
	"id" serial PRIMARY KEY NOT NULL,
	"recibido_en" timestamp with time zone DEFAULT now() NOT NULL,
	"tipo" text NOT NULL,
	"cuerpo" jsonb,
	"resultado" "resultado_evento" NOT NULL,
	"detalle" text
);
--> statement-breakpoint
CREATE TABLE "lecturas_contador" (
	"id" serial PRIMARY KEY NOT NULL,
	"activo_id" integer NOT NULL,
	"giros" bigint NOT NULL,
	"leida_en" timestamp with time zone DEFAULT now() NOT NULL,
	"origen" "origen_lectura" NOT NULL,
	"registrada_por" integer
);
--> statement-breakpoint
CREATE TABLE "pautas" (
	"id" serial PRIMARY KEY NOT NULL,
	"activo_id" integer NOT NULL,
	"nombre" text NOT NULL,
	"tipo" "tipo_pauta" NOT NULL,
	"intervalo" bigint NOT NULL,
	"especialidad_id" integer NOT NULL,
	"pct_liberacion" integer,
	"pct_limite" integer,
	"activa" boolean DEFAULT true NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creada_por" integer
);
--> statement-breakpoint
ALTER TABLE "avisos_solicitud" ADD COLUMN "id_detencion_metrics" text;--> statement-breakpoint
ALTER TABLE "ordenes_trabajo" ADD COLUMN "ciclo_id" integer;--> statement-breakpoint
ALTER TABLE "solicitudes_repuesto" ADD COLUMN "ciclo_id" integer;--> statement-breakpoint
ALTER TABLE "actividades_ciclo" ADD CONSTRAINT "actividades_ciclo_ciclo_id_ciclos_pauta_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclos_pauta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actividades_pauta" ADD CONSTRAINT "actividades_pauta_pauta_id_pautas_id_fk" FOREIGN KEY ("pauta_id") REFERENCES "public"."pautas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclos_pauta" ADD CONSTRAINT "ciclos_pauta_pauta_id_pautas_id_fk" FOREIGN KEY ("pauta_id") REFERENCES "public"."pautas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclos_pauta" ADD CONSTRAINT "ciclos_pauta_liberado_por_usuarios_id_fk" FOREIGN KEY ("liberado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclos_pauta" ADD CONSTRAINT "ciclos_pauta_responsable_id_usuarios_id_fk" FOREIGN KEY ("responsable_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclos_pauta" ADD CONSTRAINT "ciclos_pauta_ejecutado_por_usuarios_id_fk" FOREIGN KEY ("ejecutado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecturas_contador" ADD CONSTRAINT "lecturas_contador_activo_id_activos_id_fk" FOREIGN KEY ("activo_id") REFERENCES "public"."activos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecturas_contador" ADD CONSTRAINT "lecturas_contador_registrada_por_usuarios_id_fk" FOREIGN KEY ("registrada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pautas" ADD CONSTRAINT "pautas_activo_id_activos_id_fk" FOREIGN KEY ("activo_id") REFERENCES "public"."activos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pautas" ADD CONSTRAINT "pautas_especialidad_id_especialidades_id_fk" FOREIGN KEY ("especialidad_id") REFERENCES "public"."especialidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pautas" ADD CONSTRAINT "pautas_creada_por_usuarios_id_fk" FOREIGN KEY ("creada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_ciclo_id_ciclos_pauta_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclos_pauta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes_repuesto" ADD CONSTRAINT "solicitudes_repuesto_ciclo_id_ciclos_pauta_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclos_pauta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avisos_solicitud" ADD CONSTRAINT "avisos_solicitud_id_detencion_metrics_unique" UNIQUE("id_detencion_metrics");