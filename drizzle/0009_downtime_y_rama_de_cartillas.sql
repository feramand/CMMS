ALTER TABLE "actividades_ciclo" ADD COLUMN "pauta_origen" text;--> statement-breakpoint
ALTER TABLE "ciclos_pauta" ADD COLUMN "incluido_en_ciclo_id" integer;--> statement-breakpoint
ALTER TABLE "pautas" ADD COLUMN "incluye_inferiores" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "solicitudes" ADD COLUMN "maquina_detenida" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ciclos_pauta" ADD CONSTRAINT "ciclos_pauta_incluido_en_ciclo_id_ciclos_pauta_id_fk" FOREIGN KEY ("incluido_en_ciclo_id") REFERENCES "public"."ciclos_pauta"("id") ON DELETE set null ON UPDATE no action;