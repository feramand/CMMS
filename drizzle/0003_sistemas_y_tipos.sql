CREATE TABLE "sistemas_tipo" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo_id" integer NOT NULL,
	"padre_id" integer,
	"nombre" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tipos_maquina" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	CONSTRAINT "tipos_maquina_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
ALTER TABLE "sectores" DROP CONSTRAINT "sectores_activo_id_nombre_unique";--> statement-breakpoint
ALTER TABLE "activos" ADD COLUMN "tipo_maquina_id" integer;--> statement-breakpoint
ALTER TABLE "activos" ADD COLUMN "ultimo_mp" text;--> statement-breakpoint
ALTER TABLE "sectores" ADD COLUMN "padre_id" integer;--> statement-breakpoint
ALTER TABLE "sectores" ADD COLUMN "activo" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sistemas_tipo" ADD CONSTRAINT "sistemas_tipo_tipo_id_tipos_maquina_id_fk" FOREIGN KEY ("tipo_id") REFERENCES "public"."tipos_maquina"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sistemas_tipo" ADD CONSTRAINT "sistemas_tipo_padre_id_sistemas_tipo_id_fk" FOREIGN KEY ("padre_id") REFERENCES "public"."sistemas_tipo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activos" ADD CONSTRAINT "activos_tipo_maquina_id_tipos_maquina_id_fk" FOREIGN KEY ("tipo_maquina_id") REFERENCES "public"."tipos_maquina"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sectores" ADD CONSTRAINT "sectores_padre_id_sectores_id_fk" FOREIGN KEY ("padre_id") REFERENCES "public"."sectores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "tipos_maquina" ("nombre") SELECT DISTINCT trim("tipo") FROM "activos" WHERE "tipo" IS NOT NULL AND trim("tipo") <> '' ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "activos" a SET "tipo_maquina_id" = t."id" FROM "tipos_maquina" t WHERE t."nombre" = trim(a."tipo");
