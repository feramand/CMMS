CREATE TYPE "public"."estado_toma" AS ENUM('ABIERTA', 'CERRADA', 'ANULADA');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimiento" AS ENUM('ENTRADA', 'SALIDA', 'TRASLADO', 'AJUSTE', 'DEVOLUCION');--> statement-breakpoint
CREATE TABLE "almacenes" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "almacenes_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "existencias" (
	"repuesto_id" integer NOT NULL,
	"almacen_id" integer NOT NULL,
	"cantidad" numeric(14, 2) DEFAULT 0 NOT NULL,
	"ubicacion" text,
	CONSTRAINT "existencias_repuesto_id_almacen_id_pk" PRIMARY KEY("repuesto_id","almacen_id"),
	CONSTRAINT "existencia_no_negativa" CHECK ("existencias"."cantidad" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lineas_toma" (
	"toma_id" integer NOT NULL,
	"repuesto_id" integer NOT NULL,
	"sistema" numeric(14, 2) NOT NULL,
	"contada" numeric(14, 2),
	CONSTRAINT "lineas_toma_toma_id_repuesto_id_pk" PRIMARY KEY("toma_id","repuesto_id")
);
--> statement-breakpoint
CREATE TABLE "movimientos" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo" "tipo_movimiento" NOT NULL,
	"repuesto_id" integer NOT NULL,
	"almacen_id" integer NOT NULL,
	"almacen_destino_id" integer,
	"cantidad" numeric(14, 2) NOT NULL,
	"costo_unitario" numeric(14, 2) DEFAULT 0 NOT NULL,
	"usuario_id" integer NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"activo_id" integer,
	"ot_id" integer,
	"solicitud_repuesto_id" integer,
	"toma_id" integer,
	"recibe_id" integer,
	"documento" text,
	"nota" text
);
--> statement-breakpoint
CREATE TABLE "repuestos" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"codigo_fabricante" text,
	"descripcion" text NOT NULL,
	"unidad" text DEFAULT 'unidad' NOT NULL,
	"familia" text,
	"stock_minimo" numeric(14, 2) DEFAULT 0 NOT NULL,
	"stock_maximo" numeric(14, 2),
	"costo_medio" numeric(14, 2) DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repuestos_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "repuestos_activo" (
	"repuesto_id" integer NOT NULL,
	"activo_id" integer NOT NULL,
	CONSTRAINT "repuestos_activo_repuesto_id_activo_id_pk" PRIMARY KEY("repuesto_id","activo_id")
);
--> statement-breakpoint
CREATE TABLE "tomas_inventario" (
	"id" serial PRIMARY KEY NOT NULL,
	"almacen_id" integer NOT NULL,
	"estado" "estado_toma" DEFAULT 'ABIERTA' NOT NULL,
	"creada_por" integer NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"cerrada_por" integer,
	"cerrada_en" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "solicitudes_repuesto" ADD COLUMN "repuesto_id" integer;--> statement-breakpoint
ALTER TABLE "solicitudes_repuesto" ADD COLUMN "motivo_rechazo" text;--> statement-breakpoint
ALTER TABLE "existencias" ADD CONSTRAINT "existencias_repuesto_id_repuestos_id_fk" FOREIGN KEY ("repuesto_id") REFERENCES "public"."repuestos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "existencias" ADD CONSTRAINT "existencias_almacen_id_almacenes_id_fk" FOREIGN KEY ("almacen_id") REFERENCES "public"."almacenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineas_toma" ADD CONSTRAINT "lineas_toma_toma_id_tomas_inventario_id_fk" FOREIGN KEY ("toma_id") REFERENCES "public"."tomas_inventario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineas_toma" ADD CONSTRAINT "lineas_toma_repuesto_id_repuestos_id_fk" FOREIGN KEY ("repuesto_id") REFERENCES "public"."repuestos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_repuesto_id_repuestos_id_fk" FOREIGN KEY ("repuesto_id") REFERENCES "public"."repuestos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_almacen_id_almacenes_id_fk" FOREIGN KEY ("almacen_id") REFERENCES "public"."almacenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_almacen_destino_id_almacenes_id_fk" FOREIGN KEY ("almacen_destino_id") REFERENCES "public"."almacenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_activo_id_activos_id_fk" FOREIGN KEY ("activo_id") REFERENCES "public"."activos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_ot_id_ordenes_trabajo_id_fk" FOREIGN KEY ("ot_id") REFERENCES "public"."ordenes_trabajo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_solicitud_repuesto_id_solicitudes_repuesto_id_fk" FOREIGN KEY ("solicitud_repuesto_id") REFERENCES "public"."solicitudes_repuesto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_toma_id_tomas_inventario_id_fk" FOREIGN KEY ("toma_id") REFERENCES "public"."tomas_inventario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_recibe_id_usuarios_id_fk" FOREIGN KEY ("recibe_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repuestos_activo" ADD CONSTRAINT "repuestos_activo_repuesto_id_repuestos_id_fk" FOREIGN KEY ("repuesto_id") REFERENCES "public"."repuestos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repuestos_activo" ADD CONSTRAINT "repuestos_activo_activo_id_activos_id_fk" FOREIGN KEY ("activo_id") REFERENCES "public"."activos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tomas_inventario" ADD CONSTRAINT "tomas_inventario_almacen_id_almacenes_id_fk" FOREIGN KEY ("almacen_id") REFERENCES "public"."almacenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tomas_inventario" ADD CONSTRAINT "tomas_inventario_creada_por_usuarios_id_fk" FOREIGN KEY ("creada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tomas_inventario" ADD CONSTRAINT "tomas_inventario_cerrada_por_usuarios_id_fk" FOREIGN KEY ("cerrada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes_repuesto" ADD CONSTRAINT "solicitudes_repuesto_repuesto_id_repuestos_id_fk" FOREIGN KEY ("repuesto_id") REFERENCES "public"."repuestos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "almacenes" ("nombre") VALUES ('Bodega central'), ('Pañol mecánico'), ('Pañol eléctrico');
