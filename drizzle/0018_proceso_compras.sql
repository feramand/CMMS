CREATE TYPE "public"."origen_sc" AS ENUM('OT', 'STOCK_MINIMO', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."tipo_oc" AS ENUM('NACIONAL', 'IMPORTACION');--> statement-breakpoint
CREATE TYPE "public"."tipo_sc" AS ENUM('INVENTARIO', 'SIN_CODIGO', 'SERVICIO');--> statement-breakpoint
ALTER TABLE "almacenes" ADD COLUMN "es_capex" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "tipo" "tipo_oc" DEFAULT 'NACIONAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "incoterm" text;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "via_embarque" text;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "es_capex" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "enviada_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "factura_servicio" text;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "conforme_por" integer;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "conforme_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "cerrada_por" integer;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "cerrada_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "nota_cierre" text;--> statement-breakpoint
ALTER TABLE "solicitudes_compra" ADD COLUMN "tipo" "tipo_sc" DEFAULT 'INVENTARIO' NOT NULL;--> statement-breakpoint
ALTER TABLE "solicitudes_compra" ADD COLUMN "origen" "origen_sc" DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_conforme_por_usuarios_id_fk" FOREIGN KEY ("conforme_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_cerrada_por_usuarios_id_fk" FOREIGN KEY ("cerrada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "almacenes" ("nombre", "es_capex") VALUES ('Bodega Capex', true) ON CONFLICT ("nombre") DO NOTHING;
--> statement-breakpoint
UPDATE "solicitudes_compra" s SET "origen" = 'OT' WHERE EXISTS (SELECT 1 FROM "solicitudes_repuesto" r WHERE r."sc_id" = s."id");
--> statement-breakpoint
UPDATE "solicitudes_compra" s SET "tipo" = 'SIN_CODIGO' WHERE NOT EXISTS (SELECT 1 FROM "lineas_sc" l WHERE l."sc_id" = s."id" AND l."repuesto_id" IS NOT NULL);
