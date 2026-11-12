CREATE TABLE "adjuntos" (
	"id" serial PRIMARY KEY NOT NULL,
	"solicitud_id" integer,
	"ot_id" integer,
	"repuesto_id" integer,
	"archivo" text NOT NULL,
	"tipo" text NOT NULL,
	"bytes" integer NOT NULL,
	"subido_por" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjuntos_archivo_unique" UNIQUE("archivo")
);
--> statement-breakpoint
CREATE TABLE "feriados" (
	"fecha" date PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suscripciones_push" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suscripciones_push_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "fichas_tecnico" ADD COLUMN "dias_laborales" text;--> statement-breakpoint
ALTER TABLE "fichas_tecnico" ADD COLUMN "hora_entrada" time;--> statement-breakpoint
ALTER TABLE "fichas_tecnico" ADD COLUMN "hora_salida" time;--> statement-breakpoint
ALTER TABLE "notificaciones" ADD COLUMN "push_enviada_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_solicitud_id_solicitudes_id_fk" FOREIGN KEY ("solicitud_id") REFERENCES "public"."solicitudes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_ot_id_ordenes_trabajo_id_fk" FOREIGN KEY ("ot_id") REFERENCES "public"."ordenes_trabajo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_repuesto_id_solicitudes_repuesto_id_fk" FOREIGN KEY ("repuesto_id") REFERENCES "public"."solicitudes_repuesto"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_subido_por_usuarios_id_fk" FOREIGN KEY ("subido_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suscripciones_push" ADD CONSTRAINT "suscripciones_push_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;