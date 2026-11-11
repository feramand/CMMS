CREATE TYPE "public"."modalidad" AS ENUM('HORARIO_FIJO', 'TURNOS');--> statement-breakpoint
CREATE TYPE "public"."nivel" AS ENUM('BASICO', 'INTERMEDIO', 'AVANZADO');--> statement-breakpoint
CREATE TYPE "public"."perfil" AS ENUM('ADMINISTRADOR', 'JEFE_PLANIFICADOR', 'TECNICO', 'OPERADOR', 'BODEGUERO', 'ABASTECIMIENTO');--> statement-breakpoint
CREATE TABLE "bitacora" (
	"id" serial PRIMARY KEY NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" integer,
	"accion" text NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" text,
	"detalle" jsonb
);
--> statement-breakpoint
CREATE TABLE "especialidades" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	CONSTRAINT "especialidades_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "especialidades_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "fichas_tecnico" (
	"usuario_id" integer PRIMARY KEY NOT NULL,
	"especialidad_id" integer NOT NULL,
	"modalidad" "modalidad" NOT NULL,
	"nivel" "nivel",
	"en_turno" boolean DEFAULT false NOT NULL,
	"turno_desde" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "parametros" (
	"clave" text PRIMARY KEY NOT NULL,
	"valor" text NOT NULL,
	"descripcion" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plantas" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	CONSTRAINT "plantas_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "turnos" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"hora_inicio" time NOT NULL,
	"hora_fin" time NOT NULL,
	CONSTRAINT "turnos_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"perfil" "perfil" NOT NULL,
	"identificador" text NOT NULL,
	"email" text,
	"clave_hash" text NOT NULL,
	"intentos_fallidos" integer DEFAULT 0 NOT NULL,
	"bloqueado" boolean DEFAULT false NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"puede_autorizar_oc" boolean DEFAULT false NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_ingreso" timestamp with time zone,
	CONSTRAINT "usuarios_identificador_unique" UNIQUE("identificador"),
	CONSTRAINT "usuarios_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "bitacora" ADD CONSTRAINT "bitacora_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fichas_tecnico" ADD CONSTRAINT "fichas_tecnico_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fichas_tecnico" ADD CONSTRAINT "fichas_tecnico_especialidad_id_especialidades_id_fk" FOREIGN KEY ("especialidad_id") REFERENCES "public"."especialidades"("id") ON DELETE no action ON UPDATE no action;