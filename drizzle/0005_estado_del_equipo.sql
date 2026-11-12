ALTER TABLE "activos" ALTER COLUMN "estado_operativo" SET DATA TYPE text;--> statement-breakpoint
UPDATE "activos" SET "estado_operativo" = 'ACTIVO' WHERE "estado_operativo" IN ('OPERATIVA', 'DETENIDA');--> statement-breakpoint
ALTER TABLE "activos" ALTER COLUMN "estado_operativo" SET DEFAULT 'ACTIVO'::text;--> statement-breakpoint
DROP TYPE "public"."estado_operativo";--> statement-breakpoint
CREATE TYPE "public"."estado_operativo" AS ENUM('ACTIVO', 'FUERA_DE_SERVICIO', 'DESINSTALADO');--> statement-breakpoint
ALTER TABLE "activos" ALTER COLUMN "estado_operativo" SET DEFAULT 'ACTIVO'::"public"."estado_operativo";--> statement-breakpoint
ALTER TABLE "activos" ALTER COLUMN "estado_operativo" SET DATA TYPE "public"."estado_operativo" USING "estado_operativo"::"public"."estado_operativo";