ALTER TYPE "public"."rol_autorizacion" ADD VALUE 'GERENTE_GENERAL';--> statement-breakpoint
ALTER TABLE "adjuntos" ADD COLUMN "oc_id" integer;--> statement-breakpoint
ALTER TABLE "adjuntos" ADD COLUMN "nombre_original" text;--> statement-breakpoint
ALTER TABLE "lineas_oc" ADD COLUMN "linea_sc_id" integer;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "cuenta_id" integer;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "iva_exento" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "solicitudes_compra" ADD COLUMN "cuenta_id" integer;--> statement-breakpoint
ALTER TABLE "solicitudes_repuesto" ADD COLUMN "entregada" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "solicitudes_repuesto" ADD COLUMN "sc_id" integer;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "cargo_oc" "rol_autorizacion";--> statement-breakpoint
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_oc_id_ordenes_compra_id_fk" FOREIGN KEY ("oc_id") REFERENCES "public"."ordenes_compra"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineas_oc" ADD CONSTRAINT "lineas_oc_linea_sc_id_lineas_sc_id_fk" FOREIGN KEY ("linea_sc_id") REFERENCES "public"."lineas_sc"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_cuenta_id_cuentas_contables_id_fk" FOREIGN KEY ("cuenta_id") REFERENCES "public"."cuentas_contables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes_compra" ADD CONSTRAINT "solicitudes_compra_cuenta_id_cuentas_contables_id_fk" FOREIGN KEY ("cuenta_id") REFERENCES "public"."cuentas_contables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes_repuesto" ADD CONSTRAINT "solicitudes_repuesto_sc_id_solicitudes_compra_id_fk" FOREIGN KEY ("sc_id") REFERENCES "public"."solicitudes_compra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "solicitudes_repuesto" SET "entregada" = "cantidad" WHERE "estado" = 'ENTREGADA';--> statement-breakpoint
UPDATE "lineas_oc" lo SET "linea_sc_id" = ls."id" FROM "ordenes_compra" o, "lineas_sc" ls WHERE o."id" = lo."oc_id" AND ls."sc_id" = o."sc_id" AND ls."descripcion" = lo."descripcion" AND ls."repuesto_id" IS NOT DISTINCT FROM lo."repuesto_id";
