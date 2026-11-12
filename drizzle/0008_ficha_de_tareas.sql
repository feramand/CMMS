ALTER TABLE "actividades_ciclo" ADD COLUMN "codigo" text;--> statement-breakpoint
ALTER TABLE "actividades_ciclo" ADD COLUMN "zona" text;--> statement-breakpoint
ALTER TABLE "actividades_ciclo" ADD COLUMN "subsistema" text;--> statement-breakpoint
ALTER TABLE "actividades_ciclo" ADD COLUMN "componente" text;--> statement-breakpoint
ALTER TABLE "actividades_ciclo" ADD COLUMN "tipo_tarea" text;--> statement-breakpoint
ALTER TABLE "actividades_ciclo" ADD COLUMN "detencion" text;--> statement-breakpoint
ALTER TABLE "actividades_ciclo" ADD COLUMN "insumos" text;--> statement-breakpoint
ALTER TABLE "actividades_ciclo" ADD COLUMN "minutos" integer;--> statement-breakpoint
ALTER TABLE "actividades_ciclo" ADD COLUMN "motivo" text;--> statement-breakpoint
ALTER TABLE "actividades_pauta" ADD COLUMN "codigo" text;--> statement-breakpoint
ALTER TABLE "actividades_pauta" ADD COLUMN "zona" text;--> statement-breakpoint
ALTER TABLE "actividades_pauta" ADD COLUMN "subsistema" text;--> statement-breakpoint
ALTER TABLE "actividades_pauta" ADD COLUMN "componente" text;--> statement-breakpoint
ALTER TABLE "actividades_pauta" ADD COLUMN "tipo_tarea" text;--> statement-breakpoint
ALTER TABLE "actividades_pauta" ADD COLUMN "detencion" text;--> statement-breakpoint
ALTER TABLE "actividades_pauta" ADD COLUMN "insumos" text;--> statement-breakpoint
ALTER TABLE "actividades_pauta" ADD COLUMN "minutos" integer;--> statement-breakpoint
ALTER TABLE "pautas" ADD COLUMN "frecuencia" text;