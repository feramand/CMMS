ALTER TABLE "actividades_ciclo" ADD COLUMN "operador" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "actividades_ciclo" ADD COLUMN "especialidad_id" integer;--> statement-breakpoint
ALTER TABLE "actividades_ciclo" ADD COLUMN "marcada_por" integer;--> statement-breakpoint
ALTER TABLE "actividades_ciclo" ADD COLUMN "marcada_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "actividades_pauta" ADD COLUMN "operador" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "actividades_pauta" ADD COLUMN "especialidad_id" integer;--> statement-breakpoint
ALTER TABLE "activos" ADD COLUMN "unidad_contador" text DEFAULT 'giros' NOT NULL;--> statement-breakpoint
ALTER TABLE "actividades_ciclo" ADD CONSTRAINT "actividades_ciclo_especialidad_id_especialidades_id_fk" FOREIGN KEY ("especialidad_id") REFERENCES "public"."especialidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actividades_ciclo" ADD CONSTRAINT "actividades_ciclo_marcada_por_usuarios_id_fk" FOREIGN KEY ("marcada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actividades_pauta" ADD CONSTRAINT "actividades_pauta_especialidad_id_especialidades_id_fk" FOREIGN KEY ("especialidad_id") REFERENCES "public"."especialidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "actividades_ciclo" ac SET "especialidad_id" = p."especialidad_id" FROM "ciclos_pauta" c JOIN "pautas" p ON p."id" = c."pauta_id" WHERE c."id" = ac."ciclo_id" AND ac."especialidad_id" IS NULL;
