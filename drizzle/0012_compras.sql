CREATE TYPE "public"."estado_oc" AS ENUM('EMITIDA', 'AUTORIZADA', 'RECIBIDA_PARCIAL', 'RECIBIDA_TOTAL', 'RECHAZADA', 'ANULADA');--> statement-breakpoint
CREATE TYPE "public"."estado_sc" AS ENUM('ENVIADA', 'APROBADA', 'CONVERTIDA', 'RECHAZADA');--> statement-breakpoint
CREATE TYPE "public"."moneda" AS ENUM('CLP', 'UF', 'USD', 'EUR', 'CHF');--> statement-breakpoint
CREATE TYPE "public"."rol_autorizacion" AS ENUM('JEFE_MANTENIMIENTO', 'GERENTE_PRODUCCION');--> statement-breakpoint
CREATE TABLE "autorizaciones_oc" (
	"oc_id" integer NOT NULL,
	"rol" "rol_autorizacion" NOT NULL,
	"usuario_id" integer NOT NULL,
	"nombre" text NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autorizaciones_oc_oc_id_rol_pk" PRIMARY KEY("oc_id","rol")
);
--> statement-breakpoint
CREATE TABLE "centros_costo" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "centros_costo_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "cuentas_contables" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "cuentas_contables_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "lineas_oc" (
	"id" serial PRIMARY KEY NOT NULL,
	"oc_id" integer NOT NULL,
	"repuesto_id" integer,
	"descripcion" text NOT NULL,
	"cantidad" numeric(14, 2) NOT NULL,
	"precio_unitario" numeric(16, 4) NOT NULL,
	"recibida" numeric(14, 2) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lineas_recepcion" (
	"id" serial PRIMARY KEY NOT NULL,
	"recepcion_id" integer NOT NULL,
	"linea_oc_id" integer NOT NULL,
	"cantidad" numeric(14, 2) NOT NULL,
	"movimiento_id" integer
);
--> statement-breakpoint
CREATE TABLE "lineas_sc" (
	"id" serial PRIMARY KEY NOT NULL,
	"sc_id" integer NOT NULL,
	"repuesto_id" integer,
	"descripcion" text NOT NULL,
	"cantidad" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ordenes_compra" (
	"id" serial PRIMARY KEY NOT NULL,
	"sc_id" integer NOT NULL,
	"proveedor_id" integer NOT NULL,
	"moneda" "moneda" DEFAULT 'CLP' NOT NULL,
	"estado" "estado_oc" DEFAULT 'EMITIDA' NOT NULL,
	"centro_costo_id" integer,
	"fecha_entrega" date,
	"condicion_pago" text,
	"nota" text,
	"motivo" text,
	"codigo_verificacion" text,
	"emitida_por" integer NOT NULL,
	"emitida_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ordenes_compra_codigo_verificacion_unique" UNIQUE("codigo_verificacion")
);
--> statement-breakpoint
CREATE TABLE "proveedores" (
	"id" serial PRIMARY KEY NOT NULL,
	"rut" text,
	"nombre" text NOT NULL,
	"giro" text,
	"contacto" text,
	"email" text,
	"telefono" text,
	"direccion" text,
	"condicion_pago" text,
	"es_tecnico" boolean DEFAULT false NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "proveedores_rut_unique" UNIQUE("rut")
);
--> statement-breakpoint
CREATE TABLE "recepciones" (
	"id" serial PRIMARY KEY NOT NULL,
	"oc_id" integer NOT NULL,
	"almacen_id" integer NOT NULL,
	"tipo_cambio" numeric(14, 4) DEFAULT 1 NOT NULL,
	"documento" text,
	"usuario_id" integer NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solicitudes_compra" (
	"id" serial PRIMARY KEY NOT NULL,
	"solicitante_id" integer NOT NULL,
	"centro_costo_id" integer,
	"estado" "estado_sc" DEFAULT 'ENVIADA' NOT NULL,
	"nota" text,
	"motivo_rechazo" text,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"resuelta_por" integer,
	"resuelta_en" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activos" ADD COLUMN "centro_costo_id" integer;--> statement-breakpoint
ALTER TABLE "repuestos" ADD COLUMN "cuenta_id" integer;--> statement-breakpoint
ALTER TABLE "autorizaciones_oc" ADD CONSTRAINT "autorizaciones_oc_oc_id_ordenes_compra_id_fk" FOREIGN KEY ("oc_id") REFERENCES "public"."ordenes_compra"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autorizaciones_oc" ADD CONSTRAINT "autorizaciones_oc_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineas_oc" ADD CONSTRAINT "lineas_oc_oc_id_ordenes_compra_id_fk" FOREIGN KEY ("oc_id") REFERENCES "public"."ordenes_compra"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineas_oc" ADD CONSTRAINT "lineas_oc_repuesto_id_repuestos_id_fk" FOREIGN KEY ("repuesto_id") REFERENCES "public"."repuestos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineas_recepcion" ADD CONSTRAINT "lineas_recepcion_recepcion_id_recepciones_id_fk" FOREIGN KEY ("recepcion_id") REFERENCES "public"."recepciones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineas_recepcion" ADD CONSTRAINT "lineas_recepcion_linea_oc_id_lineas_oc_id_fk" FOREIGN KEY ("linea_oc_id") REFERENCES "public"."lineas_oc"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineas_recepcion" ADD CONSTRAINT "lineas_recepcion_movimiento_id_movimientos_id_fk" FOREIGN KEY ("movimiento_id") REFERENCES "public"."movimientos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineas_sc" ADD CONSTRAINT "lineas_sc_sc_id_solicitudes_compra_id_fk" FOREIGN KEY ("sc_id") REFERENCES "public"."solicitudes_compra"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineas_sc" ADD CONSTRAINT "lineas_sc_repuesto_id_repuestos_id_fk" FOREIGN KEY ("repuesto_id") REFERENCES "public"."repuestos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_sc_id_solicitudes_compra_id_fk" FOREIGN KEY ("sc_id") REFERENCES "public"."solicitudes_compra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_centro_costo_id_centros_costo_id_fk" FOREIGN KEY ("centro_costo_id") REFERENCES "public"."centros_costo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_emitida_por_usuarios_id_fk" FOREIGN KEY ("emitida_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recepciones" ADD CONSTRAINT "recepciones_oc_id_ordenes_compra_id_fk" FOREIGN KEY ("oc_id") REFERENCES "public"."ordenes_compra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recepciones" ADD CONSTRAINT "recepciones_almacen_id_almacenes_id_fk" FOREIGN KEY ("almacen_id") REFERENCES "public"."almacenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recepciones" ADD CONSTRAINT "recepciones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes_compra" ADD CONSTRAINT "solicitudes_compra_solicitante_id_usuarios_id_fk" FOREIGN KEY ("solicitante_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes_compra" ADD CONSTRAINT "solicitudes_compra_centro_costo_id_centros_costo_id_fk" FOREIGN KEY ("centro_costo_id") REFERENCES "public"."centros_costo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes_compra" ADD CONSTRAINT "solicitudes_compra_resuelta_por_usuarios_id_fk" FOREIGN KEY ("resuelta_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activos" ADD CONSTRAINT "activos_centro_costo_id_centros_costo_id_fk" FOREIGN KEY ("centro_costo_id") REFERENCES "public"."centros_costo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repuestos" ADD CONSTRAINT "repuestos_cuenta_id_cuentas_contables_id_fk" FOREIGN KEY ("cuenta_id") REFERENCES "public"."cuentas_contables"("id") ON DELETE no action ON UPDATE no action;