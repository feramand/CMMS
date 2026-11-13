ALTER TABLE "actividades_pauta" ADD COLUMN "variante" text;--> statement-breakpoint
ALTER TABLE "ciclos_pauta" ADD COLUMN "variante" text;--> statement-breakpoint
ALTER TABLE "repuestos" ADD COLUMN "sin_codigo_fabricante" boolean DEFAULT false NOT NULL;