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
  cambiarImputacionOc,
  cerrarOc,
  cerrarSc,
  conformarServicio,
  folioDe,
  marcarEnviadaOc,
  proveedoresSugeridos,
  guardarCentro,
  guardarCuenta,
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
  let central: number, proveedor: number, rod: number, cuenta: number, centro: number;
  const imp = () => ({ cuentaId: cuenta, centroCostoId: centro });

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
    await guardarCuenta(db, compras, { codigo: "5-1-02", nombre: "Repuestos" });
    await guardarCentro(db, compras, { codigo: "CC-210", nombre: "Prensas" });
    cuenta = (await db.select().from(schema.cuentasContables))[0].id;
    centro = (await db.select().from(schema.centrosCosto))[0].id;
    rod = await crearRepuesto(db, bodeguero, { codigo: "ROD-6204", descripcion: "Rodamiento 6204", stockMinimo: 4, stockMaximo: 12, sinCodigoFabricante: true });
  });

  const avisos = async (usuarioId: number) =>
    (await db.select().from(schema.notificaciones).where(eq(schema.notificaciones.usuarioId, usuarioId))).map((n) => n.mensaje);
  const oc = async (id: number) => (await db.select().from(schema.ordenesCompra).where(eq(schema.ordenesCompra.id, id)))[0];
  const lineasDeSc = (scId: number) => db.select().from(schema.lineasSc).where(eq(schema.lineasSc.scId, scId)).orderBy(schema.lineasSc.id);

  /** SC del bodeguero aprobada, con una OC emitida por 10 rodamientos al precio dado. */
  async function ocEmitida(precio = 1300, moneda: schema.Moneda = "CLP") {
    const sc = await crearSc(db, bodeguero, { lineas: [{ repuestoId: rod, cantidad: 10 }, { descripcion: "Flete", cantidad: 1 }] });
    await resolverSc(db, planificador, sc, true);
    const [l1, l2] = await lineasDeSc(sc);
    return emitirOc(db, compras, { ...imp(), scId: sc, proveedorId: proveedor, moneda, precios: { [l1.id]: precio, [l2.id]: 50 } });
  }

  it("proveedor: RUT válido y único", async () => {
    await expect(guardarProveedor(db, compras, { nombre: "X", rut: "76.123.456-1" })).rejects.toThrow("no es válido");
    await expect(guardarProveedor(db, compras, { nombre: "X", rut: "76123456-0" })).rejects.toThrow("Ya existe un proveedor");
    await expect(guardarProveedor(db, jefe, { nombre: "X" })).rejects.toThrow("Solo abastecimiento");
    expect((await db.select().from(schema.proveedores))[0]).toMatchObject({ rut: "76123456-0", nombre: "Rodamientos del Sur" });
  });

  it("SC: la crean bodega, abastecimiento y jefatura, no el técnico; la visa el planificador o el jefe", async () => {
    await expect(crearSc(db, tecnico, { lineas: [{ repuestoId: rod, cantidad: 1 }] })).rejects.toThrow("no puede crear");
    await expect(crearSc(db, bodeguero, { lineas: [] })).rejects.toThrow("al menos una línea");
    await expect(crearSc(db, bodeguero, { lineas: [{ descripcion: " ", cantidad: 1 }] })).rejects.toThrow("falta la descripción");
    const sc = await crearSc(db, bodeguero, { lineas: [{ repuestoId: rod, cantidad: 8 }, { descripcion: "Servicio de rectificado", cantidad: 1 }] });
    expect((await lineasDeSc(sc)).map((l) => l.descripcion)).toEqual(["ROD-6204 · Rodamiento 6204", "Servicio de rectificado"]);
    expect(await avisos(planificador.id)).toEqual(["Presolicitud de compra PSC-00001 de Bodeguero por aprobar"]);
    expect(await avisos(compras.id)).toEqual([]);
    await expect(resolverSc(db, compras, sc, true)).rejects.toThrow("las aprueba el planificador o el jefe");
    await expect(resolverSc(db, bodeguero, sc, true)).rejects.toThrow("las aprueba el planificador o el jefe");
    await expect(resolverSc(db, planificador, sc, false, "")).rejects.toThrow("motivo");
    await resolverSc(db, planificador, sc, false, "Hay stock en pañol");
    expect(await avisos(bodeguero.id)).toEqual(["Presolicitud PSC-00001 rechazada: Hay stock en pañol"]);
    await expect(resolverSc(db, planificador, sc, true)).rejects.toThrow("ya fue resuelta");
    // La de abastecimiento también necesita el visto bueno; al visarla se libera y se avisa a abastecimiento.
    const estado = async (id: number) => (await db.select().from(schema.solicitudesCompra).where(eq(schema.solicitudesCompra.id, id)))[0].estado;
    const propia = await crearSc(db, compras, { lineas: [{ repuestoId: rod, cantidad: 2 }], cuentaId: cuenta, centroCostoId: centro });
    expect(await estado(propia)).toBe("ENVIADA");
    await resolverSc(db, jefe, propia, true);
    expect(await estado(propia)).toBe("APROBADA");
    expect(await avisos(compras.id)).toEqual(["Presolicitud aprobada: ahora es la solicitud de compra SC-00002", "Solicitud de compra SC-00002 aprobada: lista para cotizar"]);
    // La que crea el planificador o el jefe nace visada.
    expect(await estado(await crearSc(db, planificador, { lineas: [{ repuestoId: rod, cantidad: 1 }] }))).toBe("APROBADA");
  });

  it("OC: solo desde una SC visada; exige cuenta contable y centro de costo", async () => {
    const sc = await crearSc(db, bodeguero, { lineas: [{ repuestoId: rod, cantidad: 10 }, { descripcion: "Flete", cantidad: 1 }] });
    const [l1] = await lineasDeSc(sc);
    await expect(emitirOc(db, compras, { ...imp(), scId: sc, proveedorId: proveedor, moneda: "CLP", precios: { [l1.id]: 1300 } })).rejects.toThrow("solicitud visada");
    await resolverSc(db, planificador, sc, true);
    await expect(emitirOc(db, compras, { ...imp(), scId: sc, proveedorId: proveedor, moneda: "CLP", precios: {} })).rejects.toThrow("al menos una línea");
    await expect(emitirOc(db, bodeguero, { ...imp(), scId: sc, proveedorId: proveedor, moneda: "CLP", precios: { [l1.id]: 1300 } })).rejects.toThrow("Solo abastecimiento");
    await expect(emitirOc(db, compras, { scId: sc, proveedorId: proveedor, moneda: "CLP", precios: { [l1.id]: 1300 } })).rejects.toThrow("necesita una cuenta contable");
    await expect(emitirOc(db, compras, { cuentaId: cuenta, scId: sc, proveedorId: proveedor, moneda: "CLP", precios: { [l1.id]: 1300 } })).rejects.toThrow("necesita un centro de costo");
    const id = await emitirOc(db, compras, { ...imp(), scId: sc, proveedorId: proveedor, moneda: "CLP", precios: { [l1.id]: 1300 } });
    expect(await oc(id)).toMatchObject({ estado: "EMITIDA", condicionPago: "30 días", codigoVerificacion: null, cuentaId: cuenta, centroCostoId: centro, ivaExento: false });
    expect(await db.select().from(schema.lineasOc)).toHaveLength(1);
    // Queda una línea sin orden: la solicitud sigue visada, con líneas por comprar.
    expect((await db.select().from(schema.solicitudesCompra))[0].estado).toBe("APROBADA");
    // La imputación se puede corregir en la OC mientras no se reciba.
    await guardarCentro(db, compras, { codigo: "CC-300", nombre: "Terminación" });
    const otro = (await db.select().from(schema.centrosCosto)).find((c) => c.codigo === "CC-300")!.id;
    await expect(cambiarImputacionOc(db, bodeguero, id, { cuentaId: cuenta, centroCostoId: otro })).rejects.toThrow("Solo abastecimiento");
    await cambiarImputacionOc(db, compras, id, { cuentaId: cuenta, centroCostoId: otro });
    expect((await oc(id)).centroCostoId).toBe(otro);
    // La ruta parte por el jefe de mantenimiento: se le avisa a él; al gerente, cuando el jefe ya firmó.
    const porAutorizar = "Orden de compra OC-00001 por autorizar: Rodamientos del Sur";
    expect(await avisos(jefe.id)).toContain(porAutorizar);
    expect(await avisos(gerente.id)).toEqual([]);
    expect(await avisos(planificador.id)).not.toContain(porAutorizar);
    await autorizarOc(db, jefe, id);
    expect(await avisos(gerente.id)).toEqual(["Orden de compra OC-00001 por autorizar: ya firmó el jefe de mantenimiento"]);
  });

  it("autorización: hacen falta las dos, jefe de mantenimiento y gerente de producción", async () => {
    const id = await ocEmitida();
    await expect(autorizarOc(db, planificador, id)).rejects.toThrow("No tienes permiso");
    await expect(autorizarOc(db, compras, id)).rejects.toThrow("No tienes permiso");
    await expect(recibirOc(db, bodeguero, { ocId: id, almacenId: central, cantidades: {} })).rejects.toThrow("no está autorizada");
    // La ruta va en orden: el gerente de producción no firma antes que el jefe de mantenimiento.
    await expect(autorizarOc(db, gerente, id)).rejects.toThrow("primero debe autorizar el jefe de mantenimiento");
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

  it("una SC se reparte en varias OC; la cuenta y el centro vienen de la SC si la OC no los cambia", async () => {
    const [otroProv] = await db.insert(schema.proveedores).values({ nombre: "Transportes Norte" }).returning();
    const sc = await crearSc(db, planificador, {
      lineas: [{ repuestoId: rod, cantidad: 10 }, { descripcion: "Flete", cantidad: 1 }, { descripcion: "Embalaje", cantidad: 2 }],
      cuentaId: cuenta,
      centroCostoId: centro,
    });
    const estadoSc = async () => (await db.select().from(schema.solicitudesCompra))[0].estado;
    const [l1, l2, l3] = await lineasDeSc(sc);
    const a = await emitirOc(db, compras, { scId: sc, proveedorId: proveedor, moneda: "CLP", precios: { [l1.id]: 1300 } });
    expect(await oc(a)).toMatchObject({ cuentaId: cuenta, centroCostoId: centro, scId: sc });
    expect(await estadoSc()).toBe("APROBADA");
    await expect(emitirOc(db, compras, { scId: sc, proveedorId: otroProv.id, moneda: "CLP", precios: { [l1.id]: 1200 } })).rejects.toThrow("ya está en la orden de compra OC-00001");
    const b = await emitirOc(db, compras, { scId: sc, proveedorId: otroProv.id, moneda: "CLP", precios: { [l2.id]: 50000, [l3.id]: 900 } });
    expect((await oc(b)).scId).toBe(sc);
    expect(await estadoSc()).toBe("CONVERTIDA");
    await expect(emitirOc(db, compras, { scId: sc, proveedorId: proveedor, moneda: "CLP", precios: { [l2.id]: 1 } })).rejects.toThrow("solicitud visada");
    // Si se anula o se rechaza una OC, sus líneas vuelven a quedar pendientes en la SC.
    await anularOc(db, compras, b, "Cotización vencida");
    expect(await estadoSc()).toBe("APROBADA");
    const c = await emitirOc(db, compras, { scId: sc, proveedorId: proveedor, moneda: "CLP", precios: { [l2.id]: 45000 } });
    expect((await db.select().from(schema.lineasOc).where(eq(schema.lineasOc.ocId, c)))[0].lineaScId).toBe(l2.id);
    expect(await estadoSc()).toBe("APROBADA");
    // Abastecimiento cierra la solicitud: el embalaje ya no se compra y deja de contar como "en camino".
    await expect(cerrarSc(db, bodeguero, sc)).rejects.toThrow("Solo abastecimiento");
    await cerrarSc(db, compras, sc);
    expect(await estadoSc()).toBe("CONVERTIDA");
    await rechazarOc(db, jefe, c, "Muy caro");
    expect(await estadoSc()).toBe("CONVERTIDA");
  });

  it("IVA exento: con la marca, el IVA es 0 y el total es el neto", async () => {
    expect(totales([{ cantidad: 10, precioUnitario: 1300 }], "CLP", true)).toEqual({ neto: 13000, iva: 0, total: 13000 });
    expect(totales([{ cantidad: 10, precioUnitario: 1300 }], "CLP")).toEqual({ neto: 13000, iva: 2470, total: 15470 });
    const sc = await crearSc(db, jefe, { lineas: [{ repuestoId: rod, cantidad: 10 }] });
    const [l1] = await lineasDeSc(sc);
    const id = await emitirOc(db, compras, { ...imp(), scId: sc, proveedorId: proveedor, moneda: "CLP", ivaExento: true, precios: { [l1.id]: 1300 } });
    expect((await oc(id)).ivaExento).toBe(true);
  });

  it("gerente general: su firma es opcional y va al final de la ruta, después de las dos obligatorias", async () => {
    const [u] = await db.insert(schema.usuarios).values({ nombre: "Gerente General", perfil: "ADMINISTRADOR", identificador: "10000000-8", claveHash: "x" }).returning();
    const general: UsuarioSesion = { id: u.id, nombre: u.nombre, perfil: u.perfil };
    await expect(autorizarOc(db, general, await ocEmitida())).rejects.toThrow("No tienes permiso");
    await expect(fijarAutorizador(db, gerente, jefe.id, "GERENTE_GENERAL")).rejects.toThrow("no puede firmar como gerente general");
    await fijarAutorizador(db, gerente, general.id, "GERENTE_GENERAL");
    const id = await ocEmitida();
    // El gerente general no firma antes que el jefe ni que el gerente de producción.
    await expect(autorizarOc(db, general, id)).rejects.toThrow("primero deben autorizar");
    expect(await autorizarOc(db, jefe, id)).toEqual({ completa: false });
    await expect(autorizarOc(db, general, id)).rejects.toThrow("primero deben autorizar");
    expect(await autorizarOc(db, gerente, id)).toEqual({ completa: true });
    expect((await oc(id)).estado).toBe("AUTORIZADA");
    expect(await avisos(general.id)).toContain(`Orden de compra OC-0000${id} autorizada: tu firma como gerente general es opcional`);
    // En otra orden, ya autorizada por los dos obligatorios, el general firma después sin cambiar el estado ni el código.
    const otra = await ocEmitida();
    await autorizarOc(db, jefe, otra);
    await autorizarOc(db, gerente, otra);
    const codigo = (await oc(otra)).codigoVerificacion;
    expect(await autorizarOc(db, general, otra)).toEqual({ completa: false });
    expect(await oc(otra)).toMatchObject({ estado: "AUTORIZADA", codigoVerificacion: codigo });
    await expect(autorizarOc(db, general, otra)).rejects.toThrow("Ya está la autorización de gerente general");
    expect((await db.select().from(schema.autorizacionesOc).where(eq(schema.autorizacionesOc.ocId, otra))).map((a) => a.rol).sort()).toEqual([
      "GERENTE_GENERAL",
      "GERENTE_PRODUCCION",
      "JEFE_MANTENIMIENTO",
    ]);
  });

  it("el permiso de autorizar es personal y lo define el administrador", async () => {
    await expect(fijarAutorizador(db, jefe, planificador.id, "JEFE_MANTENIMIENTO")).rejects.toThrow("Solo el administrador");
    await expect(fijarAutorizador(db, gerente, compras.id, "JEFE_MANTENIMIENTO")).rejects.toThrow("Solo un jefe o un administrador");
    await fijarAutorizador(db, gerente, jefe.id, null);
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
    // Al quedar bajo el mínimo nació sola la presolicitud por lo que falta para el máximo (12 − 2 = 10): ya viene en camino.
    expect((await propuestaDeCompra(db)).map((p) => [p.codigo, p.total, p.enCamino, p.sugerida])).toEqual([["ROD-6204", 2, 10, 0]]);
    const [auto] = await db.select().from(schema.solicitudesCompra);
    await resolverSc(db, bodeguero, auto.id, false, "Se compra a mano");
    expect((await propuestaDeCompra(db)).map((p) => [p.codigo, p.total, p.enCamino, p.sugerida])).toEqual([["ROD-6204", 2, 0, 10]]);
    const sc = await crearSc(db, bodeguero, { lineas: [{ repuestoId: rod, cantidad: 6 }] });
    expect((await propuestaDeCompra(db))[0]).toMatchObject({ enCamino: 6, sugerida: 4 });
    await resolverSc(db, planificador, sc, true);
    const [l] = await lineasDeSc(sc);
    await emitirOc(db, compras, { ...imp(), scId: sc, proveedorId: proveedor, moneda: "CLP", precios: { [l.id]: 1000 } });
    expect((await propuestaDeCompra(db))[0]).toMatchObject({ enCamino: 6, sugerida: 4 }); // ahora en la OC, no dos veces
  });

  // ---------- Proceso de solicitudes de compra y abastecimiento (diagrama de la gerencia) ----------

  const sc1 = async (id: number) => (await db.select().from(schema.solicitudesCompra).where(eq(schema.solicitudesCompra.id, id)))[0];
  /** OC autorizada por la ruta completa, a partir de una SC ya aprobada, con todas sus líneas al precio dado. */
  async function ocAutorizada(scId: number, extra: Partial<Parameters<typeof emitirOc>[2]> = {}, precio = 1000) {
    const precios = Object.fromEntries((await lineasDeSc(scId)).map((l) => [l.id, precio]));
    const id = await emitirOc(db, compras, { ...imp(), scId, proveedorId: proveedor, moneda: "CLP", precios, ...extra });
    await autorizarOc(db, jefe, id);
    await autorizarOc(db, gerente, id);
    return id;
  }

  it("stock mínimo: nace sola la presolicitud, la aprueba el encargado de bodega y pasa a ser la SC", async () => {
    await registrarEntrada(db, bodeguero, { repuestoId: rod, almacenId: central, cantidad: 5, costoUnitario: 1000 });
    await registrarSalida(db, bodeguero, { repuestoId: rod, almacenId: central, cantidad: 1 });
    expect(await db.select().from(schema.solicitudesCompra)).toEqual([]); // 4 no está bajo el mínimo de 4
    await registrarSalida(db, bodeguero, { repuestoId: rod, almacenId: central, cantidad: 1 });
    const [psc] = await db.select().from(schema.solicitudesCompra);
    expect(psc).toMatchObject({ estado: "ENVIADA", origen: "STOCK_MINIMO", tipo: "INVENTARIO" });
    expect(folioDe(psc)).toBe("PSC-00001");
    expect((await lineasDeSc(psc.id)).map((l) => [l.repuestoId, l.cantidad])).toEqual([[rod, 9]]); // hasta el máximo: 12 − 3
    // Otra salida: no se abre una segunda presolicitud; la misma línea sube a lo que falta (12 − 1 = 11).
    await registrarSalida(db, bodeguero, { repuestoId: rod, almacenId: central, cantidad: 2 });
    expect(await db.select().from(schema.solicitudesCompra)).toHaveLength(1);
    expect((await lineasDeSc(psc.id)).map((l) => l.cantidad)).toEqual([11]);
    // La aprueba el encargado de bodega, no el jefe ni abastecimiento.
    await expect(resolverSc(db, jefe, psc.id, true)).rejects.toThrow("la aprueba el encargado de bodega");
    await expect(resolverSc(db, compras, psc.id, true)).rejects.toThrow("la aprueba el encargado de bodega");
    await resolverSc(db, bodeguero, psc.id, true);
    const sc = await sc1(psc.id);
    expect(sc.estado).toBe("APROBADA");
    expect(folioDe(sc)).toBe("SC-00001");
    expect(await avisos(compras.id)).toContain("Solicitud de compra SC-00001 aprobada: lista para cotizar");
    // Con la compra en camino, otra salida no vuelve a pedir lo mismo.
    await registrarSalida(db, bodeguero, { repuestoId: rod, almacenId: central, cantidad: 1 });
    const todas = await db.select().from(schema.solicitudesCompra).orderBy(schema.solicitudesCompra.id);
    expect(todas.map((s) => [s.estado, s.origen])).toEqual([["APROBADA", "STOCK_MINIMO"], ["ENVIADA", "STOCK_MINIMO"]]);
    expect((await lineasDeSc(todas[1].id)).map((l) => l.cantidad)).toEqual([1]); // solo la unidad que salió después
  });

  it("tipos de SC: inventario, sin código de inventario y servicios", async () => {
    expect((await sc1(await crearSc(db, jefe, { lineas: [{ repuestoId: rod, cantidad: 1 }] }))).tipo).toBe("INVENTARIO");
    expect((await sc1(await crearSc(db, jefe, { lineas: [{ descripcion: "Guantes de nitrilo", cantidad: 10 }] }))).tipo).toBe("SIN_CODIGO");
    expect((await sc1(await crearSc(db, jefe, { tipo: "SERVICIO", lineas: [{ descripcion: "Rectificado de rodillo", cantidad: 1 }] }))).tipo).toBe("SERVICIO");
    // Inventario admite una línea anexa (un flete), pero necesita al menos un repuesto del catálogo.
    expect((await sc1(await crearSc(db, jefe, { tipo: "INVENTARIO", lineas: [{ repuestoId: rod, cantidad: 1 }, { descripcion: "Flete", cantidad: 1 }] }))).tipo).toBe("INVENTARIO");
    await expect(crearSc(db, jefe, { tipo: "INVENTARIO", lineas: [{ descripcion: "Guantes", cantidad: 1 }] })).rejects.toThrow("Ninguna línea es un repuesto del catálogo");
    await expect(crearSc(db, jefe, { tipo: "SERVICIO", lineas: [{ repuestoId: rod, cantidad: 1 }] })).rejects.toThrow("es un repuesto del catálogo");
    await expect(crearSc(db, jefe, { tipo: "SIN_CODIGO", lineas: [{ repuestoId: rod, cantidad: 1 }] })).rejects.toThrow("es un repuesto del catálogo");
  });

  it("proveedores sugeridos: los del historial de compra, con la última compra primero", async () => {
    const nueva = () => crearSc(db, jefe, { lineas: [{ repuestoId: rod, cantidad: 2 }] });
    expect(await proveedoresSugeridos(db, await nueva())).toEqual([]); // sin historial
    const [otro] = await db.insert(schema.proveedores).values({ nombre: "Importadora Andes" }).returning();
    await ocAutorizada(await nueva(), {}, 1000);
    await ocAutorizada(await nueva(), {}, 1100);
    await ocAutorizada(await nueva(), { proveedorId: otro.id, moneda: "USD" }, 1.5);
    // Una orden sin autorizar no cuenta como historial.
    const sinFirma = await nueva();
    await emitirOc(db, compras, { ...imp(), scId: sinFirma, proveedorId: otro.id, moneda: "CLP", precios: { [(await lineasDeSc(sinFirma))[0].id]: 5 } });
    const sugeridos = await proveedoresSugeridos(db, await nueva());
    expect(sugeridos.map((s) => [s.proveedor, s.compras, s.ultimoPrecio, s.moneda, s.ultimaOc])).toEqual([
      ["Importadora Andes", 1, 1.5, "USD", 3],
      ["Rodamientos del Sur", 2, 1100, "CLP", 2],
    ]);
  });

  it("OC de importación: exige incoterm y vía de embarque; la nacional no los guarda", async () => {
    const sc = await crearSc(db, jefe, { lineas: [{ repuestoId: rod, cantidad: 2 }, { descripcion: "Flete", cantidad: 1 }] });
    const [l1, l2] = await lineasDeSc(sc);
    const base = { ...imp(), scId: sc, proveedorId: proveedor, moneda: "EUR" as const };
    await expect(emitirOc(db, compras, { ...base, tipo: "IMPORTACION", precios: { [l1.id]: 10 } })).rejects.toThrow("necesita el incoterm");
    await expect(emitirOc(db, compras, { ...base, tipo: "IMPORTACION", incoterm: "FOB", precios: { [l1.id]: 10 } })).rejects.toThrow("necesita la vía de embarque");
    const imp1 = await emitirOc(db, compras, { ...base, tipo: "IMPORTACION", incoterm: "fob", viaEmbarque: "Marítima", precios: { [l1.id]: 10 } });
    expect(await oc(imp1)).toMatchObject({ tipo: "IMPORTACION", incoterm: "FOB", viaEmbarque: "Marítima" });
    const nac = await emitirOc(db, compras, { ...base, moneda: "CLP", incoterm: "FOB", viaEmbarque: "Aérea", precios: { [l2.id]: 10 } });
    expect(await oc(nac)).toMatchObject({ tipo: "NACIONAL", incoterm: null, viaEmbarque: null });
  });

  it("recepción completa: se avisa a abastecimiento, que envía la orden al proveedor y la cierra", async () => {
    const sc = await crearSc(db, jefe, { lineas: [{ repuestoId: rod, cantidad: 4 }] });
    const precios = { [(await lineasDeSc(sc))[0].id]: 1000 };
    const id = await emitirOc(db, compras, { ...imp(), scId: sc, proveedorId: proveedor, moneda: "CLP", precios });
    await expect(marcarEnviadaOc(db, compras, id)).rejects.toThrow("no completa su ruta de aprobación");
    await autorizarOc(db, jefe, id);
    await autorizarOc(db, gerente, id);
    await expect(marcarEnviadaOc(db, bodeguero, id)).rejects.toThrow("Solo abastecimiento");
    await marcarEnviadaOc(db, compras, id);
    expect((await oc(id)).enviadaEn).toBeInstanceOf(Date);
    await expect(marcarEnviadaOc(db, compras, id)).rejects.toThrow("ya figura enviada");
    await expect(cerrarOc(db, compras, id)).rejects.toThrow("antes bodega debe registrar la recepción");
    const [l] = await db.select().from(schema.lineasOc).where(eq(schema.lineasOc.ocId, id));
    await recibirOc(db, bodeguero, { ocId: id, almacenId: central, cantidades: { [l.id]: 3 } });
    // Con saldo por recibir, cerrar exige una explicación.
    await expect(cerrarOc(db, compras, id)).rejects.toThrow("explica por qué se cierra así");
    await recibirOc(db, bodeguero, { ocId: id, almacenId: central, cantidades: { [l.id]: 1 } });
    expect(await avisos(compras.id)).toContain("Orden de compra OC-00001: recepción total en Bodega central. Lista para cerrar.");
    await expect(cerrarOc(db, bodeguero, id)).rejects.toThrow("Solo abastecimiento");
    await cerrarOc(db, compras, id);
    expect(await oc(id)).toMatchObject({ estado: "RECIBIDA_TOTAL", cerradaPor: compras.id });
    await expect(cerrarOc(db, compras, id)).rejects.toThrow("ya está cerrada");
    expect(await avisos(jefe.id)).toContain("Orden de compra OC-00001 cerrada");
    // Cierre con saldo: deja de admitir recepciones.
    const sc2 = await crearSc(db, jefe, { lineas: [{ repuestoId: rod, cantidad: 4 }] });
    const otra = await ocAutorizada(sc2);
    const [l2] = await db.select().from(schema.lineasOc).where(eq(schema.lineasOc.ocId, otra));
    await recibirOc(db, bodeguero, { ocId: otra, almacenId: central, cantidades: { [l2.id]: 1 } });
    // Mientras está abierta, el saldo (3) cuenta como en camino; cerrada con motivo, deja de contar.
    const enOc = async () => Number((await db.execute(sql`select coalesce(sum(l.cantidad - l.recibida), 0) n from lineas_oc l join ordenes_compra o on o.id = l.oc_id where o.estado = 'RECIBIDA_PARCIAL' and o.cerrada_en is null`)).rows[0].n);
    expect(await enOc()).toBe(3);
    await registrarSalida(db, bodeguero, { repuestoId: rod, almacenId: central, cantidad: 4 }); // quedan 1 de 5 → bajo el mínimo de 4
    expect((await propuestaDeCompra(db))[0]).toMatchObject({ total: 1, enCamino: 11 }); // 3 de la OC + 8 de la presolicitud automática
    await cerrarOc(db, compras, otra, "El proveedor descontinuó el repuesto");
    expect(await oc(otra)).toMatchObject({ estado: "RECIBIDA_PARCIAL", notaCierre: "El proveedor descontinuó el repuesto" });
    expect((await propuestaDeCompra(db))[0]).toMatchObject({ total: 1, enCamino: 8, sugerida: 3 }); // el saldo cerrado vuelve a proponerse
    await expect(recibirOc(db, bodeguero, { ocId: otra, almacenId: central, cantidades: { [l2.id]: 1 } })).rejects.toThrow("no admite recepciones");
  });

  it("OC de servicio: no entra a bodega; el jefe de área firma la factura y queda pendiente de cierre", async () => {
    const sc = await crearSc(db, planificador, { tipo: "SERVICIO", lineas: [{ descripcion: "Rectificado de rodillo", cantidad: 1 }] });
    const id = await ocAutorizada(sc, {}, 250000);
    expect(await avisos(planificador.id)).toContain("Orden de servicio OC-00001 autorizada: cuando llegue la factura del proveedor, el jefe de área debe firmarla en el sistema");
    const [l] = await db.select().from(schema.lineasOc).where(eq(schema.lineasOc.ocId, id));
    await expect(recibirOc(db, bodeguero, { ocId: id, almacenId: central, cantidades: { [l.id]: 1 } })).rejects.toThrow("no se recibe en bodega");
    await expect(cerrarOc(db, compras, id)).rejects.toThrow("antes el jefe de área debe firmar la factura");
    await expect(conformarServicio(db, compras, id, "F-1234")).rejects.toThrow("la firma el jefe de área");
    await expect(conformarServicio(db, jefe, id, " ")).rejects.toThrow("número de la factura");
    await conformarServicio(db, jefe, id, "F-1234");
    expect(await oc(id)).toMatchObject({ estado: "RECIBIDA_TOTAL", facturaServicio: "F-1234", conformePor: jefe.id, cerradaEn: null });
    expect((await db.select().from(schema.lineasOc).where(eq(schema.lineasOc.ocId, id)))[0].recibida).toBe(1);
    expect(await db.select().from(schema.movimientos)).toEqual([]);
    const pendiente = "Orden de servicio OC-00001: Jefe Mantención firmó la factura F-1234. Pendiente de cierre.";
    expect(await avisos(compras.id)).toContain(pendiente);
    expect(await avisos(planificador.id)).toContain(pendiente); // el usuario que la pidió
    await expect(conformarServicio(db, jefe, id, "F-9")).rejects.toThrow("ya fue firmada");
    await cerrarOc(db, compras, id);
    expect((await oc(id)).cerradaEn).toBeInstanceOf(Date);
    // Una orden que no es de servicio no se cierra con factura.
    const otra = await ocAutorizada(await crearSc(db, jefe, { lineas: [{ repuestoId: rod, cantidad: 1 }] }));
    await expect(conformarServicio(db, jefe, otra, "F-2")).rejects.toThrow("no es de servicio");
  });

  it("Capex: entra a la bodega Capex con su costo y no cambia el costo medio ni el stock del inventario", async () => {
    const capex = (await db.select().from(schema.almacenes)).find((a) => a.esCapex)!.id;
    await registrarEntrada(db, bodeguero, { repuestoId: rod, almacenId: central, cantidad: 10, costoUnitario: 1000 });
    const id = await ocAutorizada(await crearSc(db, jefe, { lineas: [{ repuestoId: rod, cantidad: 5 }] }), { esCapex: true }, 9000);
    const [l] = await db.select().from(schema.lineasOc).where(eq(schema.lineasOc.ocId, id));
    await expect(recibirOc(db, bodeguero, { ocId: id, almacenId: central, cantidades: { [l.id]: 5 } })).rejects.toThrow("se recibe en la bodega Capex");
    await recibirOc(db, bodeguero, { ocId: id, almacenId: capex, cantidades: { [l.id]: 5 } });
    const r = (await db.select().from(schema.repuestos).where(eq(schema.repuestos.id, rod)))[0];
    expect(r.costoMedio).toBe(1000); // sin Capex sería (10 × 1.000 + 5 × 9.000) ÷ 15 = 3.666,67
    const mov = (await db.select().from(schema.movimientos).orderBy(schema.movimientos.id)).at(-1)!;
    expect(mov).toMatchObject({ tipo: "ENTRADA", almacenId: capex, cantidad: 5, costoUnitario: 9000 });
    // Para el stock mínimo y la propuesta de compra solo cuenta el inventario: 10, no 15.
    await registrarSalida(db, bodeguero, { repuestoId: rod, almacenId: central, cantidad: 7 });
    expect((await propuestaDeCompra(db))[0]).toMatchObject({ total: 3, enCamino: 9, sugerida: 0 });
    // Una orden normal no se recibe en la bodega Capex.
    const normal = await ocAutorizada(await crearSc(db, jefe, { lineas: [{ repuestoId: rod, cantidad: 1 }] }));
    const [ln] = await db.select().from(schema.lineasOc).where(eq(schema.lineasOc.ocId, normal));
    await expect(recibirOc(db, bodeguero, { ocId: normal, almacenId: capex, cantidades: { [ln.id]: 1 } })).rejects.toThrow("solo recibe órdenes de compra Capex");
  });

  it("centros de costo: código único", async () => {
    await guardarCentro(db, compras, { codigo: "cc-100", nombre: "Mantención" });
    await expect(guardarCentro(db, compras, { codigo: "CC-100", nombre: "Otro" })).rejects.toThrow("Ya existe un centro de costo con el código CC-100");
    await expect(guardarCentro(db, bodeguero, { codigo: "CC-200", nombre: "x" })).rejects.toThrow("Solo abastecimiento");
  });

  it("el administrador fija desde qué número sigue el folio de las órdenes de compra", async () => {
    const { fijarProximoFolioOc, folioOc, proximoFolioOc } = await import("./compras-core");
    expect(await proximoFolioOc(db)).toBe(1);
    await expect(fijarProximoFolioOc(db, compras, 62_061)).rejects.toThrow("Solo el administrador");
    await expect(fijarProximoFolioOc(db, gerente, 0)).rejects.toThrow("entero mayor que cero");
    await fijarProximoFolioOc(db, gerente, 62_061);
    expect(await proximoFolioOc(db)).toBe(62_061);
    const [prov] = await db.insert(schema.proveedores).values({ rut: "76000000-0", nombre: "Proveedor" }).returning();
    const [sc] = await db.insert(schema.solicitudesCompra).values({ solicitanteId: compras.id, estado: "APROBADA" }).returning();
    const [oc] = await db.insert(schema.ordenesCompra).values({ scId: sc.id, proveedorId: prov.id, emitidaPor: compras.id }).returning();
    expect(folioOc(oc.id)).toBe("OC-62061");
    // Solo hacia adelante: retroceder repetiría folios.
    await expect(fijarProximoFolioOc(db, gerente, 100)).rejects.toThrow("no puede ser menor que 62062");
    expect(await proximoFolioOc(db)).toBe(62_062);
  });
});
