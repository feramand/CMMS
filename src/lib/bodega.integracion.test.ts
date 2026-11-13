// Bodega contra una base real (DATABASE_URL_TEST): existencias, costos, solicitudes e inventarios.
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import {
  abrirToma,
  actualizarRepuesto,
  cerrarToma,
  contar,
  crearRepuesto,
  entregarSolicitud,
  importarRepuestos,
  pedirCompraDeSolicitud,
  numero,
  precioMedio,
  rechazarSolicitud,
  registrarAjuste,
  registrarDevolucion,
  registrarEntrada,
  registrarSalida,
  registrarTraslado,
} from "./bodega-core";
import { ErrorDeCarga } from "./carga-core";
import { crearOt, solicitarRepuesto } from "./ot-core";

describe("cálculos de bodega", () => {
  it("precio medio ponderado: 10 a $1.000 más 5 a $1.300 quedan a $1.100", () => {
    expect(precioMedio(10, 1000, 5, 1300)).toBe(1100);
  });
  it("sin existencias, el costo pasa a ser el de la entrada", () => {
    expect(precioMedio(0, 900, 4, 1500)).toBe(1500);
  });
  it("redondea a 2 decimales", () => {
    expect(precioMedio(3, 100, 4, 133)).toBe(118.86); // (300 + 532) / 7 = 118,857…
  });
  it("lee números escritos a la chilena o con punto decimal", () => {
    expect(numero("1.234,5")).toBe(1234.5);
    expect(numero("1234.5")).toBe(1234.5);
    expect(numero("$ 3.500")).toBe(3500);
    expect(numero("1.250.000")).toBe(1250000);
    expect(numero("37.5")).toBe(37.5);
    expect(numero("")).toBeNull();
    expect(numero("diez")).toBeNaN();
  });
});

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("bodega (integración)", () => {
  let pool: Pool;
  let db: DB;
  let bodeguero: UsuarioSesion, tecnico: UsuarioSesion, jefe: UsuarioSesion, abastecimiento: UsuarioSesion;
  let central: number, panol: number, activoId: number, esp: number;

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
      sql`TRUNCATE lineas_sc, solicitudes_compra, lineas_toma, tomas_inventario, movimientos, existencias, repuestos_activo, solicitudes_repuesto, repuestos, notificaciones, ordenes_trabajo, folios_ot, solicitudes, sectores, activos, bitacora, fichas_tecnico, usuarios, especialidades, plantas RESTART IDENTITY CASCADE`,
    );
    const planta = (await db.insert(schema.plantas).values({ nombre: "Planta 1" }).returning())[0].id;
    const u = await db
      .insert(schema.usuarios)
      .values([
        { nombre: "Bodeguero", perfil: "BODEGUERO", identificador: "15000003-3", claveHash: "x" },
        { nombre: "Técnico", perfil: "TECNICO", identificador: "15000001-7", claveHash: "x" },
        { nombre: "Jefe", perfil: "JEFE_PLANIFICADOR", identificador: "12345678-5", claveHash: "x" },
        { nombre: "Compras", perfil: "ABASTECIMIENTO", identificador: "16000000-1", claveHash: "x" },
      ])
      .returning();
    bodeguero = { id: u[0].id, nombre: "Bodeguero", perfil: "BODEGUERO" };
    tecnico = { id: u[1].id, nombre: "Técnico", perfil: "TECNICO" };
    jefe = { id: u[2].id, nombre: "Jefe", perfil: "JEFE_PLANIFICADOR" };
    abastecimiento = { id: u[3].id, nombre: "Compras", perfil: "ABASTECIMIENTO" };
    esp = (await db.insert(schema.especialidades).values({ codigo: "MEC", nombre: "Mecánica" }).returning())[0].id;
    const alm = await db.select().from(schema.almacenes).orderBy(schema.almacenes.id);
    central = alm.find((a) => a.nombre === "Bodega central")!.id;
    panol = alm.find((a) => a.nombre === "Pañol mecánico")!.id;
    activoId = (await db.insert(schema.activos).values({ codigo: "IMP-001", nombre: "XL106", plantaId: planta }).returning())[0].id;
  });

  const rodamiento = () =>
    crearRepuesto(db, bodeguero, { codigo: "rod-6204", descripcion: "Rodamiento 6204", stockMinimo: 4, stockMaximo: 12 });
  const stock = async (repuestoId: number, almacenId: number) =>
    (await db.select().from(schema.existencias)).find((e) => e.repuestoId === repuestoId && e.almacenId === almacenId)?.cantidad ?? 0;
  const costo = async (id: number) => (await db.select().from(schema.repuestos).where(eq(schema.repuestos.id, id)))[0].costoMedio;
  const avisos = async (usuarioId: number) =>
    (await db.select().from(schema.notificaciones).where(eq(schema.notificaciones.usuarioId, usuarioId))).map((n) => n.mensaje);

  it("la migración crea la bodega central y los dos pañoles", async () => {
    const nombres = (await db.select().from(schema.almacenes)).map((a) => a.nombre).sort();
    expect(nombres).toEqual(["Bodega central", "Pañol eléctrico", "Pañol mecánico"]);
  });

  it("catálogo: el código queda en mayúsculas, no se repite y solo lo modifican bodega y abastecimiento", async () => {
    const id = await rodamiento();
    expect((await db.select().from(schema.repuestos))[0]).toMatchObject({ codigo: "ROD-6204", unidad: "unidad", stockMinimo: 4, costoMedio: 0 });
    await expect(rodamiento()).rejects.toThrow("Ya existe un repuesto con el código ROD-6204");
    await expect(crearRepuesto(db, tecnico, { codigo: "X", descripcion: "x" })).rejects.toThrow("Solo bodega y abastecimiento");
    await expect(crearRepuesto(db, jefe, { codigo: "X", descripcion: "x" })).rejects.toThrow("Solo bodega y abastecimiento");
    await expect(crearRepuesto(db, bodeguero, { codigo: "X", descripcion: "x", stockMinimo: 5, stockMaximo: 2 })).rejects.toThrow("máximo");
    await actualizarRepuesto(db, abastecimiento, id, { codigo: "ROD-6204", descripcion: "Rodamiento 6204 2RS", activoIds: [activoId] });
    expect(await db.select().from(schema.repuestosActivo)).toEqual([{ repuestoId: id, activoId }]);
  });

  it("entradas: suman existencias y actualizan el costo por precio medio ponderado", async () => {
    const id = await rodamiento();
    await registrarEntrada(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 10, costoUnitario: 1000 });
    await registrarEntrada(db, bodeguero, { repuestoId: id, almacenId: panol, cantidad: 5, costoUnitario: 1300, documento: "Guía 123" });
    expect(await stock(id, central)).toBe(10);
    expect(await stock(id, panol)).toBe(5);
    expect(await costo(id)).toBe(1100);
    // Sin costo informado, entra al costo vigente y no lo cambia.
    await registrarEntrada(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 5 });
    expect(await costo(id)).toBe(1100);
    await expect(registrarEntrada(db, tecnico, { repuestoId: id, almacenId: central, cantidad: 1 })).rejects.toThrow("Solo bodega");
    await expect(registrarEntrada(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 0 })).rejects.toThrow("mayor que cero");
    await expect(registrarEntrada(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 1.234 })).rejects.toThrow("2 decimales");
  });

  it("entrega: descuenta, no deja saldo negativo, carga el costo a la OT y avisa al cruzar el mínimo", async () => {
    const id = await rodamiento();
    await registrarEntrada(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 6, costoUnitario: 2000 });
    const ot = (await crearOt(db, jefe, { activoId, tipo: "CORRECTIVA", prioridad: "MEDIA", especialidadId: esp, descripcion: "Cambio de rodamiento" })).id;
    await expect(registrarSalida(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 7 })).rejects.toThrow(
      "No hay existencias suficientes en Bodega central: hay 6 unidad",
    );
    await expect(registrarSalida(db, bodeguero, { repuestoId: id, almacenId: panol, cantidad: 1 })).rejects.toThrow("Pañol mecánico: hay 0");
    await registrarSalida(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 2, otId: ot });
    expect(await stock(id, central)).toBe(4);
    expect(await avisos(bodeguero.id)).toEqual([]); // 4 no está bajo el mínimo de 4
    await registrarSalida(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 1, otId: ot });
    expect(await avisos(abastecimiento.id)).toEqual(["Stock bajo el mínimo: ROD-6204 Rodamiento 6204 (quedan 3 unidad, mínimo 4)"]);
    expect(await avisos(bodeguero.id)).toHaveLength(1);
    // Ya estaba bajo el mínimo: no se repite el aviso.
    await registrarSalida(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 1, otId: ot });
    expect(await avisos(abastecimiento.id)).toHaveLength(1);
    const movs = await db.select().from(schema.movimientos).where(eq(schema.movimientos.tipo, "SALIDA"));
    expect(movs.map((m) => [m.cantidad, m.costoUnitario, m.otId, m.activoId])).toEqual([
      [-2, 2000, ot, activoId],
      [-1, 2000, ot, activoId],
      [-1, 2000, ot, activoId],
    ]);
  });

  it("solicitud de repuesto: la entrega descuenta, la marca entregada y avisa a quien pidió", async () => {
    const id = await rodamiento();
    await registrarEntrada(db, bodeguero, { repuestoId: id, almacenId: panol, cantidad: 3, costoUnitario: 500 });
    const ot = (await crearOt(db, jefe, { activoId, tipo: "CORRECTIVA", prioridad: "MEDIA", especialidadId: esp, descripcion: "x" })).id;
    const sol = await solicitarRepuesto(db, tecnico, { otId: ot, cantidad: 2, descripcion: "Rodamiento 6204", repuestoId: id });
    await expect(entregarSolicitud(db, tecnico, sol, { repuestoId: id, almacenId: panol, cantidad: 2 })).rejects.toThrow("Solo bodega");
    await expect(entregarSolicitud(db, bodeguero, sol, { repuestoId: id, almacenId: panol, cantidad: 5 })).rejects.toThrow("No hay existencias");
    await entregarSolicitud(db, bodeguero, sol, { repuestoId: id, almacenId: panol, cantidad: 2 });
    expect(await stock(id, panol)).toBe(1);
    expect((await db.select().from(schema.solicitudesRepuesto))[0]).toMatchObject({ estado: "ENTREGADA", repuestoId: id, resueltaPor: bodeguero.id });
    expect((await db.select().from(schema.movimientos).where(eq(schema.movimientos.tipo, "SALIDA")))[0]).toMatchObject({
      otId: ot,
      activoId,
      recibeId: tecnico.id,
      solicitudRepuestoId: sol,
      cantidad: -2,
    });
    expect(await avisos(tecnico.id)).toContain("Repuesto entregado: Rodamiento 6204");
    await expect(entregarSolicitud(db, bodeguero, sol, { repuestoId: id, almacenId: panol, cantidad: 1 })).rejects.toThrow("ya fue resuelta");
    const otra = await solicitarRepuesto(db, tecnico, { otId: ot, cantidad: 1, descripcion: "Correa" });
    await rechazarSolicitud(db, bodeguero, otra, "No es de stock");
    expect(await avisos(tecnico.id)).toContain("Repuesto rechazado: Correa (No es de stock)");
  });

  it("entrega parcial: el resto va a solicitud de compra y la solicitud sigue abierta hasta completarse", async () => {
    const id = await rodamiento();
    await registrarEntrada(db, bodeguero, { repuestoId: id, almacenId: panol, cantidad: 2, costoUnitario: 500 });
    const ot = await crearOt(db, jefe, { activoId, tipo: "CORRECTIVA", prioridad: "MEDIA", especialidadId: esp, descripcion: "x" });
    const sol = await solicitarRepuesto(db, tecnico, { otId: ot.id, cantidad: 5, descripcion: "Rodamiento 6204", repuestoId: id });
    const fila = async () => (await db.select().from(schema.solicitudesRepuesto).where(eq(schema.solicitudesRepuesto.id, sol)))[0];
    const { scId } = await entregarSolicitud(db, bodeguero, sol, { repuestoId: id, almacenId: panol, cantidad: 2, pedirResto: true });
    expect(await fila()).toMatchObject({ estado: "PENDIENTE", entregada: 2, scId });
    const [sc] = await db.select().from(schema.solicitudesCompra);
    expect(sc).toMatchObject({ id: scId, estado: "ENVIADA", solicitanteId: bodeguero.id });
    expect(sc.nota).toContain(`OT ${ot.folio}`);
    expect((await db.select().from(schema.lineasSc))[0]).toMatchObject({ repuestoId: id, cantidad: 3 });
    expect(await avisos(tecnico.id)).toContain("Repuesto entregado en parte (2 de 5): Rodamiento 6204. El resto está en compra.");
    expect(await avisos(jefe.id)).toContain("Solicitud de compra SC-00001 de Bodeguero por visar");
    // Llega la compra: se entrega lo que faltaba y la solicitud se cierra. No se crea otra SC.
    await registrarEntrada(db, bodeguero, { repuestoId: id, almacenId: panol, cantidad: 3, costoUnitario: 500 });
    await entregarSolicitud(db, bodeguero, sol, { repuestoId: id, almacenId: panol, cantidad: 3, pedirResto: true });
    expect(await fila()).toMatchObject({ estado: "ENTREGADA", entregada: 5 });
    expect(await db.select().from(schema.solicitudesCompra)).toHaveLength(1);
    // Parcial sin pedir el resto: se cierra con lo entregado.
    await registrarEntrada(db, bodeguero, { repuestoId: id, almacenId: panol, cantidad: 1, costoUnitario: 500 });
    const corta = await solicitarRepuesto(db, tecnico, { otId: ot.id, cantidad: 4, descripcion: "Rodamiento 6204", repuestoId: id });
    await entregarSolicitud(db, bodeguero, corta, { repuestoId: id, almacenId: panol, cantidad: 1 });
    expect((await db.select().from(schema.solicitudesRepuesto).where(eq(schema.solicitudesRepuesto.id, corta)))[0]).toMatchObject({ estado: "ENTREGADA", entregada: 1, scId: null });
    // Sin existencias: todo a compra, una sola vez.
    const nada = await solicitarRepuesto(db, tecnico, { otId: ot.id, cantidad: 2, descripcion: "Correa especial", codigoFabricante: "XPZ-1000" });
    await expect(pedirCompraDeSolicitud(db, tecnico, nada)).rejects.toThrow("Solo bodega");
    const sc2 = await pedirCompraDeSolicitud(db, bodeguero, nada);
    expect((await db.select().from(schema.lineasSc).where(eq(schema.lineasSc.scId, sc2)))[0]).toMatchObject({ repuestoId: null, descripcion: "Correa especial · XPZ-1000", cantidad: 2 });
    await expect(pedirCompraDeSolicitud(db, bodeguero, nada)).rejects.toThrow("ya está pedido en la solicitud de compra SC-00002");
  });

  it("devolución: vuelve a existencias sin cambiar el costo, y no más de lo entregado a la OT", async () => {
    const id = await rodamiento();
    await registrarEntrada(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 10, costoUnitario: 1000 });
    const ot = (await crearOt(db, jefe, { activoId, tipo: "CORRECTIVA", prioridad: "MEDIA", especialidadId: esp, descripcion: "x" })).id;
    await registrarSalida(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 4, otId: ot });
    await expect(registrarDevolucion(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 5, otId: ot })).rejects.toThrow(
      "solo se le han entregado 4",
    );
    await registrarDevolucion(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 1, otId: ot });
    expect(await stock(id, central)).toBe(7);
    expect(await costo(id)).toBe(1000);
    await expect(registrarDevolucion(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 4, otId: ot })).rejects.toThrow(
      "solo se le han entregado 3",
    );
  });

  it("traslado: mueve entre almacenes sin cambiar el total ni el costo", async () => {
    const id = await rodamiento();
    await registrarEntrada(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 10, costoUnitario: 1000 });
    await registrarTraslado(db, bodeguero, { repuestoId: id, origenId: central, destinoId: panol, cantidad: 2.5 });
    expect([await stock(id, central), await stock(id, panol)]).toEqual([7.5, 2.5]);
    expect(await costo(id)).toBe(1000);
    await expect(registrarTraslado(db, bodeguero, { repuestoId: id, origenId: central, destinoId: central, cantidad: 1 })).rejects.toThrow("distinto");
    await expect(registrarTraslado(db, bodeguero, { repuestoId: id, origenId: panol, destinoId: central, cantidad: 3 })).rejects.toThrow("No hay existencias");
  });

  it("ajuste: exige motivo y registra la diferencia", async () => {
    const id = await rodamiento();
    await registrarEntrada(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 10, costoUnitario: 1000 });
    await expect(registrarAjuste(db, bodeguero, { repuestoId: id, almacenId: central, cantidadReal: 8, nota: " " })).rejects.toThrow("motivo");
    await registrarAjuste(db, bodeguero, { repuestoId: id, almacenId: central, cantidadReal: 8, nota: "Dos dañados" });
    expect(await stock(id, central)).toBe(8);
    expect((await db.select().from(schema.movimientos).where(eq(schema.movimientos.tipo, "AJUSTE")))[0]).toMatchObject({ cantidad: -2, nota: "Dos dañados" });
    expect(await registrarAjuste(db, bodeguero, { repuestoId: id, almacenId: central, cantidadReal: 8, nota: "Sin diferencia" })).toBeNull();
  });

  it("no se da de baja un repuesto con existencias", async () => {
    const id = await rodamiento();
    await registrarEntrada(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 1 });
    await expect(actualizarRepuesto(db, bodeguero, id, { codigo: "ROD-6204", descripcion: "x", activo: false })).rejects.toThrow("todavía tiene existencias");
    await registrarAjuste(db, bodeguero, { repuestoId: id, almacenId: central, cantidadReal: 0, nota: "Obsoleto" });
    await actualizarRepuesto(db, bodeguero, id, { codigo: "ROD-6204", descripcion: "x", activo: false });
    await expect(registrarEntrada(db, bodeguero, { repuestoId: id, almacenId: central, cantidad: 1 })).rejects.toThrow("dado de baja");
  });

  it("inventario: las diferencias se ajustan al cerrar y lo movido durante el conteo se conserva", async () => {
    const a = await rodamiento();
    const b = await crearRepuesto(db, bodeguero, { codigo: "COR-01", descripcion: "Correa" });
    const c = await crearRepuesto(db, bodeguero, { codigo: "FUS-10", descripcion: "Fusible 10 A" });
    await registrarEntrada(db, bodeguero, { repuestoId: a, almacenId: central, cantidad: 10, costoUnitario: 1000 });
    await registrarEntrada(db, bodeguero, { repuestoId: b, almacenId: central, cantidad: 5, costoUnitario: 800 });
    const toma = await abrirToma(db, bodeguero, central);
    await expect(abrirToma(db, bodeguero, central)).rejects.toThrow("Ya hay un inventario abierto en Bodega central");
    await expect(cerrarToma(db, bodeguero, toma)).rejects.toThrow("no se ha contado");
    await contar(db, bodeguero, toma, a, 9); // falta 1
    await contar(db, bodeguero, toma, c, 3); // no estaba en la lista: aparecen 3
    // Durante el conteo se entregan 2 del repuesto A.
    await registrarSalida(db, bodeguero, { repuestoId: a, almacenId: central, cantidad: 2 });
    expect(await cerrarToma(db, bodeguero, toma)).toEqual({ contadas: 2, ajustes: 2 });
    expect(await stock(a, central)).toBe(7); // 10 − 2 entregados − 1 de diferencia
    expect(await stock(b, central)).toBe(5); // sin contar: no se toca
    expect(await stock(c, central)).toBe(3);
    const ajustes = await db.select().from(schema.movimientos).where(eq(schema.movimientos.tipo, "AJUSTE"));
    expect(ajustes.map((m) => [m.repuestoId, m.cantidad, m.tomaId])).toEqual([
      [a, -1, toma],
      [c, 3, toma],
    ]);
    await expect(contar(db, bodeguero, toma, b, 5)).rejects.toThrow("ya está cerrado");
  });

  it("carga desde Excel: catálogo y existencias iniciales, todo o nada", async () => {
    const filas: Record<string, string>[] = [
      { codigo: "rod-6204", descripcion: "Rodamiento 6204", stockMinimo: "4", costo: "3500", almacen: "bodega central", existencia: "10", ubicacion: "A-3" },
      { codigo: "ROD-6204", descripcion: "Rodamiento 6204", stockMinimo: "4", costo: "3500", almacen: "Pañol mecánico", existencia: "2" },
      { codigo: "ACE-68", descripcion: "Aceite hidráulico 68", marca: " Shell ", unidad: "Litro", costo: "2.100,5", almacen: "Bodega central", existencia: "37,5" },
      { codigo: "FUS-10", descripcion: "Fusible 10 A" },
    ];
    expect(await importarRepuestos(db, bodeguero, filas)).toBe(4);
    const cat = await db.select().from(schema.repuestos).orderBy(schema.repuestos.codigo);
    expect(cat.map((r) => [r.codigo, r.unidad, r.costoMedio])).toEqual([
      ["ACE-68", "litro", 2100.5],
      ["FUS-10", "unidad", 0],
      ["ROD-6204", "unidad", 3500],
    ]);
    expect(cat.map((r) => r.marca)).toEqual(["Shell", null, null]);
    const rod = cat[2].id;
    expect([await stock(rod, central), await stock(rod, panol), await stock(cat[0].id, central)]).toEqual([10, 2, 37.5]);
    expect((await db.select().from(schema.existencias)).find((e) => e.repuestoId === rod && e.almacenId === central)?.ubicacion).toBe("A-3");
    // Volver a cargar la misma planilla no duplica existencias: se rechaza completa.
    const error = await importarRepuestos(db, bodeguero, filas).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeCarga);
    expect((error as ErrorDeCarga).errores[0]).toBe("Fila 2: ROD-6204 ya tiene movimientos en Bodega central; su existencia se corrige con un ajuste.");
    expect(await stock(rod, central)).toBe(10);
    // Sin existencias, la planilla sirve para actualizar el catálogo.
    await importarRepuestos(db, bodeguero, [{ codigo: "FUS-10", descripcion: "Fusible cerámico 10 A", stockMinimo: "20" }]);
    expect((await db.select().from(schema.repuestos).where(eq(schema.repuestos.codigo, "FUS-10")))[0]).toMatchObject({ descripcion: "Fusible cerámico 10 A", stockMinimo: 20 });
    const malo = await importarRepuestos(db, bodeguero, [
      { codigo: "A-1", descripcion: "a", almacen: "Bodega norte", existencia: "1" },
      { codigo: "A-2", descripcion: "b", stockMinimo: "muchos" },
    ]).catch((e) => e);
    expect((malo as ErrorDeCarga).errores).toEqual(['Fila 2: no existe el almacén "Bodega norte".', 'Fila 3: "Stock mínimo" debe ser un número.']);
    expect(await db.select().from(schema.repuestos)).toHaveLength(3);
  });
});
