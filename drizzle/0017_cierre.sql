CREATE TABLE "competencias" (
	"usuario_id" integer NOT NULL,
	"activo_id" integer NOT NULL,
	"nivel" "nivel" NOT NULL,
	CONSTRAINT "competencias_usuario_id_activo_id_pk" PRIMARY KEY("usuario_id","activo_id")
);
--> statement-breakpoint
ALTER TABLE "solicitudes" ADD COLUMN "reanudada_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competencias" ADD CONSTRAINT "competencias_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competencias" ADD CONSTRAINT "competencias_activo_id_activos_id_fk" FOREIGN KEY ("activo_id") REFERENCES "public"."activos"("id") ON DELETE cascade ON UPDATE no action;