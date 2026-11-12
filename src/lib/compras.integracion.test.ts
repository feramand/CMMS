// Compras contra una base real (DATABASE_URL_TEST): SC, OC, doble autorización y recepción.
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import { crearRepuesto, registrarEntrada, registrarSalida } from "./bodega-core";
import {
  anularOc,
  autorizarOc,
  crearSc,
  emitirOc,
  fijarAutorizador,
  guardarCentro,
  guardarProveedor,
  propuestaDeCompra,
  rechazarOc,
  recibirOc,
  resolverSc,
  totales,
} from "./compras-core";

describe("totales de una orden de compra", () => {
  it("pesos: neto, IVA 19 % y total sin decimales", () => {
    expect(totales([{ cantidad: 3, precioUnitario: 3500 }, { cantidad: 2.5, precioUnitario: 2101 }], "CLP")).toEqual({
      neto: 15753, // 10.500 + 5.252,5 = 15.752,5
      iva: 2993, // 15.753 × 0,19 = 2.993,07
      total: 18746,
    });
  });
  it("otras monedas: 2 decimales", () => {
    expect(totales([{ cantidad: 4, precioUnitario: 12.3456 }], "USD")).toEqual({ neto: 49.38, iva: 9.38, total: 58.76 });
  });
});

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("compras (integración)", () => {
  let pool: Pool;
  let db: DB;
  let bodeguero: UsuarioSesion, jefe: UsuarioSesion, planificador: UsuarioSesion, gerente: UsuarioSesion, compras: UsuarioSesion, tecnico: UsuarioSesion;
  let central: number, proveedor: number, rod: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema }) as unknown as DB;
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE lineas_recepcion, recepciones, autorizaciones_oc, lineas_oc, ordenes_compra, lineas_sc, solicitudes_compra, proveedores, centros_costo, cuentas_contables, lineas_toma, tomas_inventario, movimientos, existencias, repuestos_activo, solicitudes_repuesto, repuestos, notificaciones, bitacora, fichas_tecnico, usuarios RESTART IDENTITY CASCADE`,
    );
    const u = await db
      .insert(schema.usuarios)
      .values([
        { nombre: "Bodeguero", perfil: "BODEGUERO", identificador: "15000003-3", claveHash: "x" },
        { nombre: "Jefe Mantención", perfil: "JEFE_PLANIFICADOR", identificador: "12345678-5", claveHash: "x", puedeAutorizarOc: true },
        { nombre: "Planificador", perfil: "JEFE_PLANIFICADOR", identificador: "13000000-1", claveHash: "x" },
        { nombre: "Gerente Producción", perfil: "ADMINISTRADOR", identificador: "11111111-1", claveHash: "x", puedeAutorizarOc: true },
        { nombre: "Compras", perfil: "ABASTECIMIENTO", identificador: "16000000-1", claveHash: "x" },
        { nombre: "Técnico", perfil: "TECNICO", identificador: "15000001-7", claveHash: "x" },
      ])
      .returning();
    const s = (i: number): UsuarioSesion => ({ id: u[i].id, nombre: u[i].nombre, perfil: u[i].perfil });
    [bodeguero, jefe, planificador, gerente, compras, tecnico] = [s(0), s(1), s(2), s(3), s(4), s(5)];
    central = (await db.select().from(schema.almacenes)).find((a) => a.nombre === "Bodega central")!.id;
    proveedor = await guardarProveedor(db, compras, { nombre: "Rodamientos del Sur", rut: "76.123.456-0", condicionPago: "30 días" });
    rod = await crearRepuesto(db, bodeguero, { codigo: "ROD-6204", descripcion: "Rodamiento 6204", stockMinimo: 4, stockMaximo: 12 });
  });

  const avisos = async (usuarioId: number) =>
    (await db.select().from(schema.notificaciones).where(eq(schema.notificaciones.usuarioId, usuarioId))).map((n) => n.mensaje);
  const oc = async (id: number) => (await db.select().from(schema.ordenesCompra).where(eq(schema.ordenesCompra.id, id)))[0];
  const lineasDeSc = (scId: number) => db.select().from(schema.lineasSc).where(eq(schema.lineasSc.scId, scId)).orderBy(schema.lineasSc.id);

  /** SC del bodeguero aprobada, con una OC emitida por 10 rodamientos al precio dado. */
  async function ocEmitida(precio = 1300, moneda: schema.Moneda = "CLP") {
    const sc = await crearSc(db, bodeguero, { lineas: [{ repuestoId: rod, cantidad: 10 }, { descripcion: "Flete", cantidad: 1 }] });
    await resolverSc(db, compras, sc, true);
    const [l1, l2] = await lineasDeSc(sc);
    return emitirOc(db, compras, { scId: sc, proveedorId: proveedor, moneda, precios: { [l1.id]: precio, [l2.id]: 50 } });
  }

  it("proveedor: RUT válido y único", async () => {
    await expect(guardarProveedor(db, compras, { nombre: "X", rut: "76.123.456-1" })).rejects.toThrow("no es válido");
    await expect(guardarProveedor(db, compras, { nombre: "X", rut: "76123456-0" })).rejects.toThrow("Ya existe un proveedor");
    await expect(guardarProveedor(db, jefe, { nombre: "X" })).rejects.toThrow("Solo abastecimiento");
    expect((await db.select().from(schema.proveedores))[0]).toMatchObject({ rut: "76123456-0", nombre: "Rodamientos del Sur" });
  });

  it("SC: la crean bodega y jefatura, no el técnico; abastecimiento la aprueba o rechaza con motivo", async () => {
    await expect(crearSc(db, tecnico, { lineas: [{ repuestoId: rod, cantidad: 1 }] })).rejects.toThrow("no puede crear");
    await expect(crearSc(db, bodeguero, { lineas: [] })).rejects.toThrow("al menos una línea");
    await expect(crearSc(db, bodeguero, { lineas: [{ descripcion: " ", cantidad: 1 }] })).rejects.toThrow("falta la descripción");
    const sc = await crearSc(db, bodeguero, { lineas: [{ repuestoId: rod, cantidad: 8 }, { descripcion: "Servicio de rectificado", cantidad: 1 }] });
    expect((await lineasDeSc(sc)).map((l) => l.descripcion)).toEqual(["ROD-6204 · Rodamiento 6204", "Servicio de rectificado"]);
    expect(await avisos(compras.id)).toEqual(["Nueva solicitud de compra SC-00001 de Bodeguero"]);
    await expect(resolverSc(db, jefe, sc, true)).rejects.toThrow("Solo abastecimiento");
    await expect(resolverSc(db, compras, sc, false, "")).rejects.toThrow("motivo");
    await resolverSc(db, compras, sc, false, "Hay stock en pañol");
    expect(await avisos(bodeguero.id)).toEqual(["Solicitud de compra SC-00001 rechazada: Hay stock en pañol"]);
    await expect(resolverSc(db, compras, sc, true)).rejects.toThrow("ya fue resuelta");
    // La que crea abastecimiento nace aprobada.
    const propia = await crearSc(db, compras, { lineas: [{ repuestoId: rod, cantidad: 2 }] });
    expect((await db.select().from(schema.solicitudesCompra).where(eq(schema.solicitudesCompra.id, propia)))[0].estado).toBe("APROBADA");
  });

  it("OC: solo desde una SC aprobada; las líneas sin precio no se compran", async () => {
    const sc = await crearSc(db, bodeguero, { lineas: [{ repuestoId: rod, cantidad: 10 }, { descripcion: "Flete", cantidad: 1 }] });
    const [l1] = await lineasDeSc(sc);
    await expect(emitirOc(db, compras, { scId: sc, proveedorId: proveedor, moneda: "CLP", precios: { [l1.id]: 1300 } })).rejects.toThrow("solicitud aprobada");
    await resolverSc(db, compras, sc, true);
    await expect(emitirOc(db, compras, { scId: sc, proveedorId: proveedor, moneda: "CLP", precios: {} })).rejects.toThrow("al menos una línea");
    await expect(emitirOc(db, bodeguero, { scId: sc, proveedorId: proveedor, moneda: "CLP", precios: { [l1.id]: 1300 } })).rejects.toThrow("Solo abastecimiento");
    const id = await emitirOc(db, compras, { scId: sc, proveedorId: proveedor, moneda: "CLP", precios: { [l1.id]: 1300 } });
    expect(await oc(id)).toMatchObject({ estado: "EMITIDA", condicionPago: "30 días", codigoVerificacion: null });
    expect(await db.select().from(schema.lineasOc)).toHaveLength(1);
    expect((await db.select().from(schema.solicitudesCompra))[0].estado).toBe("CONVERTIDA");
    // Se avisa a quienes autorizan: jefe y gerente, no al planificador.
    expect(await avisos(jefe.id)).toEqual(["Orden de compra OC-00001 por autorizar: Rodamientos del Sur"]);
    expect(await avisos(gerente.id)).toHaveLength(1);
    expect(await avisos(planificador.id)).toEqual([]);
  });

  it("autorización: hacen falta las dos, jefe de mantenimiento y gerente de producción", async () => {
    const id = await ocEmitida();
    await expect(autorizarOc(db, planificador, id)).rejects.toThrow("No tienes permiso");
    await expect(autorizarOc(db, compras, id)).rejects.toThrow("No tienes permiso");
    await expect(recibirOc(db, bodeguero, { ocId: id, almacenId: central, cantidades: {} })).rejects.toThrow("no está autorizada");
    expect(await autorizarOc(db, jefe, id)).toEqual({ completa: false });
    expect((await oc(id)).estado).toBe("EMITIDA");
    await expect(autorizarOc(db, jefe, id)).rejects.toThrow("Ya está la autorización de jefe de mantenimiento");
    await expect(recibirOc(db, bodeguero, { ocId: id, almacenId: central, cantidades: {} })).rejects.toThrow("no está autorizada");
    expect(await autorizarOc(db, gerente, id)).toEqual({ completa: true });
    const o = await oc(id);
    expect(o.estado).toBe("AUTORIZADA");
    expect(o.codigoVerificacion).toMatch(/^[0-9A-F]{12}$/);
    expect((await db.select().from(schema.autorizacionesOc)).map((a) => [a.rol, a.nombre])).toEqual([
      ["JEFE_MANTENIMIENTO", "Jefe Mantención"],
      ["GERENTE_PRODUCCION", "Gerente Producción"],
    ]);
    await expect(autorizarOc(db, gerente, id)).rejects.toThrow("ya no está pendiente");
  });

  it("el permiso de autorizar es personal y lo define el administrador", async () => {
    await expect(fijarAutorizador(db, jefe, planificador.id, true)).rejects.toThrow("Solo el administrador");
    await expect(fijarAutorizador(db, gerente, compras.id, true)).rejects.toThrow("Solo un jefe o un administrador");
    await fijarAutorizador(db, gerente, jefe.id, false);
    const id = await ocEmitida();
    await expect(autorizarOc(db, jefe, id)).rejects.toThrow("No tienes permiso");
  });

  it("rechazo y anulación cierran la OC", async () => {
    const a = await ocEmitida();
    await expect(rechazarOc(db, jefe, a, "")).rejects.toThrow("motivo");
    await rechazarOc(db, jefe, a, "Muy caro");
    expect(await oc(a)).toMatchObject({ estado: "RECHAZADA", motivo: "Jefe Mantención: Muy caro" });
    await expect(autorizarOc(db, gerente, a)).rejects.toThrow("ya no está pendiente");
    const b = await ocEmitida();
    await anularOc(db, compras, b, "Proveedor sin stock");
    expect((await oc(b)).estado).toBe("ANULADA");
  });

  it("recepción: entra a bodega, actualiza el costo medio y no admite más de lo pedido", async () => {
    await registrarEntrada(db, bodeguero, { repuestoId: rod, almacenId: central, cantidad: 10, costoUnitario: 1000 });
    const id = await ocEmitida(1300);
    await autorizarOc(db, jefe, id);
    await autorizarOc(db, gerente, id);
    const [l1, l2] = await db.select().from(schema.lineasOc).where(eq(schema.lineasOc.ocId, id)).orderBy(schema.lineasOc.id);
    await expect(recibirOc(db, compras, { ocId: id, almacenId: central, cantidades: { [l1.id]: 5 } })).rejects.toThrow("Solo bodega");
    await expect(recibirOc(db, bodeguero, { ocId: id, almacenId: central, cantidades: { [l1.id]: 11 } })).rejects.toThrow("solo quedan 10 por recibir");
    await expect(recibirOc(db, bodeguero, { ocId: id, almacenId: central, cantidades: {} })).rejects.toThrow("al menos una línea");
    await recibirOc(db, bodeguero, { ocId: id, almacenId: central, documento: "Factura 77", cantidades: { [l1.id]: 5 } });
    expect((await oc(id)).estado).toBe("RECIBIDA_PARCIAL");
    const r = (await db.select().from(schema.repuestos).where(eq(schema.repuestos.id, rod)))[0];
    expect(r.costoMedio).toBe(1100); // 10 a $1.000 más 5 a $1.300
    expect((await db.select().from(schema.existencias))[0].cantidad).toBe(15);
    const mov = (await db.select().from(schema.movimientos).orderBy(schema.movimientos.id)).at(-1)!;
    expect(mov).toMatchObject({ tipo: "ENTRADA", cantidad: 5, costoUnitario: 1300, documento: "OC-00001 · Factura 77" });
    await expect(recibirOc(db, bodeguero, { ocId: id, almacenId: central, cantidades: { [l1.id]: 6 } })).rejects.toThrow("solo quedan 5");
    await expect(anularOc(db, compras, id, "x")).rejects.toThrow("sin recepciones");
    // El flete no es de catálogo: se recibe sin mover existencias.
    await recibirOc(db, bodeguero, { ocId: id, almacenId: central, cantidades: { [l1.id]: 5, [l2.id]: 1 } });
    expect((await oc(id)).estado).toBe("RECIBIDA_TOTAL");
    expect((await db.select().from(schema.existencias))[0].cantidad).toBe(20);
    expect((await db.select().from(schema.lineasRecepcion)).map((l) => l.movimientoId === null)).toEqual([false, false, true]);
    await expect(recibirOc(db, bodeguero, { ocId: id, almacenId: central, cantidades: { [l1.id]: 1 } })).rejects.toThrow("no admite recepciones");
  });

  it("OC en dólares: se valoriza en pesos con el tipo de cambio de la recepción", async () => {
    const id = await ocEmitida(4.25, "USD");
    await autorizarOc(db, jefe, id);
    await autorizarOc(db, gerente, id);
    const [l1] = await db.select().from(schema.lineasOc).where(eq(schema.lineasOc.ocId, id)).orderBy(schema.lineasOc.id);
    await expect(recibirOc(db, bodeguero, { ocId: id, almacenId: central, cantidades: { [l1.id]: 10 } })).rejects.toThrow("cuántos pesos vale 1 USD");
    await recibirOc(db, bodeguero, { ocId: id, almacenId: central, tipoCambio: 951.5, cantidades: { [l1.id]: 10 } });
    const r = (await db.select().from(schema.repuestos).where(eq(schema.repuestos.id, rod)))[0];
    expect(r.costoMedio).toBe(4043.88); // 4,25 × 951,5 = 4.043,875
  });

  it("propuesta de compra: lo que está bajo el mínimo, hasta el máximo, menos lo que viene en camino", async () => {
    await registrarEntrada(db, bodeguero, { repuestoId: rod, almacenId: central, cantidad: 5, costoUnitario: 1000 });
    expect(await propuestaDeCompra(db)).toEqual([]); // 5 no está bajo el mínimo de 4
    await registrarSalida(db, bodeguero, { repuestoId: rod, almacenId: central, cantidad: 3 });
    expect((await propuestaDeCompra(db)).map((p) => [p.codigo, p.total, p.enCamino, p.sugerida])).toEqual([["ROD-6204", 2, 0, 10]]);
    const sc = await crearSc(db, bodeguero, { lineas: [{ repuestoId: rod, cantidad: 6 }] });
    expect((await propuestaDeCompra(db))[0]).toMatchObject({ enCamino: 6, sugerida: 4 });
    await resolverSc(db, compras, sc, true);
    const [l] = await lineasDeSc(sc);
    await emitirOc(db, compras, { scId: sc, proveedorId: proveedor, moneda: "CLP", precios: { [l.id]: 1000 } });
    expect((await propuestaDeCompra(db))[0]).toMatchObject({ enCamino: 6, sugerida: 4 }); // ahora en la OC, no dos veces
  });

  it("centros de costo: código único", async () => {
    await guardarCentro(db, compras, { codigo: "cc-100", nombre: "Mantención" });
    await expect(guardarCentro(db, compras, { codigo: "CC-100", nombre: "Otro" })).rejects.toThrow("Ya existe un centro de costo con el código CC-100");
    await expect(guardarCentro(db, bodeguero, { codigo: "CC-200", nombre: "x" })).rejects.toThrow("Solo abastecimiento");
  });
});
