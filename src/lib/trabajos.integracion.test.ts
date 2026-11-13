// Solicitudes, órdenes de trabajo y repuestos contra una base real (DATABASE_URL_TEST).
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import { asignarOt, cambiarEstadoOt, crearOt, resolverRepuesto, solicitarRepuesto } from "./ot-core";
import {
  asignarSolicitud,
  cerrarSolicitud,
  crearSolicitud,
  escalarSolicitud,
  siguienteFolio,
  tomarSolicitud,
} from "./sat-core";
import { anioEnChile } from "./tiempo";
import { ErrorDeNegocio } from "./usuarios-core";

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("solicitudes y órdenes de trabajo (integración)", () => {
  let pool: Pool;
  let db: DB;
  let jefe: UsuarioSesion, operador: UsuarioSesion, bodeguero: UsuarioSesion;
  let mec1: UsuarioSesion, mec2: UsuarioSesion, ele1: UsuarioSesion;
  let maquina: number, sectorId: number, sectorOtraMaquina: number, espMec: number;
  const aa = String(anioEnChile(new Date()) % 100).padStart(2, "0");

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema }) as unknown as DB;
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  afterAll(async () => {
    await pool.end();
  });

  async function usuario(nombre: string, perfil: schema.Perfil, ident: string): Promise<UsuarioSesion> {
    const [u] = await db
      .insert(schema.usuarios)
      .values({ nombre, perfil, identificador: ident, claveHash: "x" })
      .returning();
    return { id: u.id, nombre, perfil };
  }
  async function tecnico(nombre: string, ident: string, especialidadId: number, enTurno = true) {
    const u = await usuario(nombre, "TECNICO", ident);
    await db.insert(schema.fichasTecnico).values({ usuarioId: u.id, especialidadId, modalidad: "TURNOS", enTurno });
    return u;
  }
  const avisosDe = async (u: UsuarioSesion) =>
    (await db.select().from(schema.notificaciones).where(eq(schema.notificaciones.usuarioId, u.id))).map(
      (n) => n.mensaje,
    );
  const sat = async (id: number) =>
    (await db.select().from(schema.solicitudes).where(eq(schema.solicitudes.id, id)))[0];
  const ot = async (id: number) =>
    (await db.select().from(schema.ordenesTrabajo).where(eq(schema.ordenesTrabajo.id, id)))[0];

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE notificaciones, solicitudes_repuesto, apoyos, avisos_solicitud, solicitudes,
      ordenes_trabajo, folios_ot, sectores, activos, bitacora, fichas_tecnico, usuarios, especialidades, plantas
      RESTART IDENTITY CASCADE`);
    const [planta] = await db.insert(schema.plantas).values({ nombre: "Planta 1" }).returning();
    const esp = await db
      .insert(schema.especialidades)
      .values([
        { codigo: "MEC", nombre: "Mecánica" },
        { codigo: "ELE", nombre: "Electricidad" },
        { codigo: "SAC", nombre: "Sistemas de Apoyo Crítico" },
        { codigo: "SSGG", nombre: "Servicios generales" },
      ])
      .returning();
    espMec = esp[0].id;
    jefe = await usuario("Jefe", "JEFE_PLANIFICADOR", "j");
    operador = await usuario("Operador", "OPERADOR", "o");
    bodeguero = await usuario("Bodeguero", "BODEGUERO", "b");
    mec1 = await tecnico("Mecánico 1", "m1", esp[0].id);
    mec2 = await tecnico("Mecánico 2", "m2", esp[0].id, false); // fuera de turno
    ele1 = await tecnico("Eléctrico 1", "e1", esp[1].id);
    const [a, otra] = await db
      .insert(schema.activos)
      .values([
        { codigo: "A-1", nombre: "Heidelberg XL106", plantaId: planta.id },
        { codigo: "A-2", nombre: "Guillotina", plantaId: planta.id },
      ])
      .returning();
    maquina = a.id;
    const s = await db
      .insert(schema.sectores)
      .values([
        { activoId: a.id, nombre: "Marcador" },
        { activoId: otra.id, nombre: "Cuchilla" },
      ])
      .returning();
    sectorId = s[0].id;
    sectorOtraMaquina = s[1].id;
  });

  const nueva = (categoria: schema.Categoria = "MECANICA", actor = operador) =>
    crearSolicitud(db, actor, { activoId: maquina, categoria });

  it("avisa al jefe y solo a los técnicos disponibles de la especialidad", async () => {
    const { id } = await nueva("MECANICA");
    expect((await sat(id)).estado).toBe("PENDIENTE");
    expect((await sat(id)).origen).toBe("OPERADOR");
    expect(await avisosDe(jefe)).toHaveLength(1);
    expect(await avisosDe(mec1)).toHaveLength(1);
    expect(await avisosDe(mec2)).toHaveLength(0); // fuera de turno
    expect(await avisosDe(ele1)).toHaveLength(0); // otra especialidad
    expect(await avisosDe(operador)).toHaveLength(0); // quien reporta no se avisa a sí mismo
  });

  it("operadores, técnicos y jefes reportan a mano una falla de servicios generales (infraestructura)", async () => {
    const { id } = await nueva("SERVICIOS_GENERALES", operador);
    const [s] = await db.select().from(schema.solicitudes).where(eq(schema.solicitudes.id, id));
    expect(s).toMatchObject({ categoria: "SERVICIOS_GENERALES", origen: "OPERADOR" });
    // Misma máquina y categoría: los avisos del técnico y del jefe se suman a la solicitud abierta.
    expect(await nueva("SERVICIOS_GENERALES", mec1)).toEqual({ id, duplicada: true });
    expect(await nueva("SERVICIOS_GENERALES", jefe)).toEqual({ id, duplicada: true });
    await expect(nueva("SERVICIOS_GENERALES", bodeguero)).rejects.toThrow("no puede reportar fallas");
  });

  it("una falla indeterminada avisa a mecánicos y eléctricos", async () => {
    await nueva("INDETERMINADA");
    expect(await avisosDe(mec1)).toHaveLength(1);
    expect(await avisosDe(ele1)).toHaveLength(1);
  });

  it("no duplica: un segundo aviso de la misma máquina y categoría se une al primero", async () => {
    const a = await nueva("MECANICA");
    const b = await nueva("MECANICA", mec1);
    expect(b).toEqual({ id: a.id, duplicada: true });
    expect(await db.select().from(schema.solicitudes)).toHaveLength(1);
    expect(await db.select().from(schema.avisosSolicitud)).toHaveLength(1);
    // Otra categoría sí es una solicitud distinta.
    const c = await nueva("ELECTRICA");
    expect(c.duplicada).toBe(false);
    expect(c.id).not.toBe(a.id);
  });

  it("dos reportes simultáneos crean una sola solicitud", async () => {
    const r = await Promise.all([nueva("MECANICA"), nueva("MECANICA", mec1), nueva("MECANICA", jefe)]);
    expect(new Set(r.map((x) => x.id)).size).toBe(1);
    expect(r.filter((x) => !x.duplicada)).toHaveLength(1);
    expect(await db.select().from(schema.solicitudes)).toHaveLength(1);
  });

  it("bodeguero y abastecimiento no pueden reportar fallas", async () => {
    await expect(nueva("MECANICA", bodeguero)).rejects.toThrow(ErrorDeNegocio);
    const abast = await usuario("Abastecimiento", "ABASTECIMIENTO", "ab");
    await expect(nueva("MECANICA", abast)).rejects.toThrow(ErrorDeNegocio);
  });

  it("una máquina desinstalada no admite solicitudes ni OT; fuera de servicio sí", async () => {
    const base = { activoId: maquina, tipo: "PROGRAMADA" as const, descripcion: "Revisión", especialidadId: espMec, prioridad: "MEDIA" as const };
    await db.update(schema.activos).set({ estadoOperativo: "FUERA_DE_SERVICIO" }).where(eq(schema.activos.id, maquina));
    await expect(nueva("MECANICA")).resolves.toBeDefined();
    await expect(crearOt(db, jefe, base)).resolves.toBeDefined();
    await db.update(schema.activos).set({ estadoOperativo: "DESINSTALADO" }).where(eq(schema.activos.id, maquina));
    await expect(nueva("ELECTRICA")).rejects.toThrow("desinstalada");
    await expect(crearOt(db, jefe, base)).rejects.toThrow("desinstalada");
  });

  it("solo un técnico gana cuando dos toman la misma solicitud a la vez", async () => {
    const { id } = await nueva("MECANICA");
    const r = await Promise.allSettled([tomarSolicitud(db, mec1, id), tomarSolicitud(db, mec2, id)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    const s = await sat(id);
    expect(s.estado).toBe("EN_ATENCION");
    expect([mec1.id, mec2.id]).toContain(s.responsableId);
    expect(s.tomadaEn).not.toBeNull();
  });

  it("un técnico no toma solicitudes de otra especialidad, salvo las indeterminadas", async () => {
    const mecanica = await nueva("MECANICA");
    await expect(tomarSolicitud(db, ele1, mecanica.id)).rejects.toThrow("especialidad");
    const indet = await nueva("INDETERMINADA");
    await tomarSolicitud(db, ele1, indet.id);
    expect((await sat(indet.id)).responsableId).toBe(ele1.id);
    await expect(tomarSolicitud(db, operador, mecanica.id)).rejects.toThrow(ErrorDeNegocio);
  });

  it("el jefe asigna y reasigna; un técnico no puede asignar", async () => {
    const { id } = await nueva("MECANICA");
    await expect(asignarSolicitud(db, mec1, id, mec2.id)).rejects.toThrow(ErrorDeNegocio);
    await asignarSolicitud(db, jefe, id, mec2.id);
    const primera = await sat(id);
    expect(primera.responsableId).toBe(mec2.id);
    expect(await avisosDe(mec2)).toContain("Te asignaron una solicitud: Heidelberg XL106");
    await asignarSolicitud(db, jefe, id, mec1.id);
    const segunda = await sat(id);
    expect(segunda.responsableId).toBe(mec1.id);
    // Reasignar no reinicia el tiempo de respuesta.
    expect(segunda.tomadaEn).toEqual(primera.tomadaEn);
    await expect(asignarSolicitud(db, jefe, id, operador.id)).rejects.toThrow("técnico");
  });

  it("cierra una falla simple con sector y solución, y avisa a quien la reportó", async () => {
    const { id } = await nueva("MECANICA");
    await tomarSolicitud(db, mec1, id);
    await cerrarSolicitud(db, mec1, id, { sectorId, solucion: "  Se ajustó sensor de pliego  " });
    const s = await sat(id);
    expect(s).toMatchObject({ estado: "SOLUCIONADA", sectorId, solucion: "Se ajustó sensor de pliego", otId: null });
    expect(s.cerradaEn!.getTime()).toBeGreaterThanOrEqual(s.tomadaEn!.getTime());
    expect(await avisosDe(operador)).toContain("Tu solicitud fue solucionada: Se ajustó sensor de pliego");
    expect(await db.select().from(schema.ordenesTrabajo)).toHaveLength(0);
  });

  it("exige sector de la misma máquina, solución y ser el responsable", async () => {
    const { id } = await nueva("MECANICA");
    await expect(cerrarSolicitud(db, mec1, id, { sectorId, solucion: "x" })).rejects.toThrow("en atención");
    await tomarSolicitud(db, mec1, id);
    await expect(cerrarSolicitud(db, mec1, id, { sectorId, solucion: "   " })).rejects.toThrow("solución");
    await expect(
      cerrarSolicitud(db, mec1, id, { sectorId: sectorOtraMaquina, solucion: "x" }),
    ).rejects.toThrow("sector");
    await expect(cerrarSolicitud(db, mec2, id, { sectorId, solucion: "x" })).rejects.toThrow("responsable");
    expect((await sat(id)).estado).toBe("EN_ATENCION");
  });

  it("una solicitud indeterminada exige el origen real al cerrar", async () => {
    const { id } = await nueva("INDETERMINADA");
    await tomarSolicitud(db, ele1, id);
    await expect(cerrarSolicitud(db, ele1, id, { sectorId, solucion: "x" })).rejects.toThrow("origen real");
    await expect(
      cerrarSolicitud(db, ele1, id, { sectorId, solucion: "x", origenReal: "INDETERMINADA" }),
    ).rejects.toThrow("origen real");
    await cerrarSolicitud(db, ele1, id, { sectorId, solucion: "Fusible", origenReal: "ELECTRICA" });
    expect((await sat(id)).origenReal).toBe("ELECTRICA");
  });

  it("registra técnicos de apoyo de cualquier especialidad y les avisa", async () => {
    const { id } = await nueva("MECANICA");
    await tomarSolicitud(db, mec1, id);
    await cerrarSolicitud(db, mec1, id, {
      sectorId,
      solucion: "Cambio de pieza",
      apoyoIds: [ele1.id, mec2.id, ele1.id, mec1.id], // repetido y uno mismo: se ignoran
    });
    const filas = await db.select().from(schema.apoyos);
    expect(filas.map((f) => f.usuarioId).sort()).toEqual([mec2.id, ele1.id].sort());
    expect(filas.every((f) => f.solicitudId === id && f.registradoPor === mec1.id)).toBe(true);
    expect(await avisosDe(ele1)).toContain("Mecánico 1 te registró como apoyo en un trabajo");
  });

  it("no acepta como apoyo a quien no es técnico, y no cierra a medias", async () => {
    const { id } = await nueva("MECANICA");
    await tomarSolicitud(db, mec1, id);
    await expect(
      cerrarSolicitud(db, mec1, id, { sectorId, solucion: "x", apoyoIds: [operador.id] }),
    ).rejects.toThrow("apoyo");
    expect((await sat(id)).estado).toBe("EN_ATENCION");
  });

  it("escala a OT: folio del año, datos heredados y ambas vinculadas", async () => {
    const { id } = await nueva("MECANICA");
    await tomarSolicitud(db, mec1, id);
    const r = await escalarSolicitud(db, mec1, id, { descripcion: "Rodamiento con juego", prioridad: "ALTA" });
    expect(r.folio).toBe(`${aa}0001`);
    const o = await ot(r.otId);
    expect(o).toMatchObject({
      folio: `${aa}0001`,
      activoId: maquina,
      tipo: "CORRECTIVA",
      especialidadId: espMec,
      prioridad: "ALTA",
      responsableId: mec1.id,
      estado: "ASIGNADA",
    });
    expect(await sat(id)).toMatchObject({ estado: "ESCALADA", otId: r.otId, cerradaEn: null });
  });

  it("al finalizar la OT se cierra la solicitud de origen", async () => {
    const { id } = await nueva("MECANICA");
    await tomarSolicitud(db, mec1, id);
    const { otId } = await escalarSolicitud(db, mec1, id, { descripcion: "Cambio mayor" });
    await cambiarEstadoOt(db, mec1, otId, "EN_CURSO");
    await cambiarEstadoOt(db, mec1, otId, "ESPERA_REPUESTOS");
    expect((await sat(id)).estado).toBe("ESCALADA");
    await cambiarEstadoOt(db, mec1, otId, "EN_CURSO");
    await cambiarEstadoOt(db, mec1, otId, "FINALIZADA", { apoyoIds: [ele1.id] });
    const o = await ot(otId);
    expect(o.estado).toBe("FINALIZADA");
    expect(o.inicioEn).not.toBeNull();
    expect(o.terminoEn!.getTime()).toBeGreaterThanOrEqual(o.inicioEn!.getTime());
    const s = await sat(id);
    expect(s.estado).toBe("CERRADA");
    expect(s.cerradaEn).toEqual(o.terminoEn);
    expect((await db.select().from(schema.apoyos))[0]).toMatchObject({ otId, usuarioId: ele1.id });
  });

  it("los folios son correlativos y no se repiten aunque se pidan a la vez", async () => {
    const folios = await Promise.all(Array.from({ length: 12 }, () => siguienteFolio(db)));
    const esperados = Array.from({ length: 12 }, (_, i) => `${aa}${String(i + 1).padStart(4, "0")}`);
    expect([...folios].sort()).toEqual(esperados);
  });

  it("el correlativo reinicia cada año", async () => {
    expect(await siguienteFolio(db, new Date("2026-06-01T12:00:00Z"))).toBe("260001");
    expect(await siguienteFolio(db, new Date("2026-06-02T12:00:00Z"))).toBe("260002");
    expect(await siguienteFolio(db, new Date("2027-06-01T12:00:00Z"))).toBe("270001");
  });

  it("OT manual: solo administrativos; sin responsable queda Creada, con responsable Asignada", async () => {
    const base = { activoId: maquina, tipo: "PROGRAMADA" as const, descripcion: "Cambio de correas", especialidadId: espMec, prioridad: "MEDIA" as const };
    await expect(crearOt(db, mec1, base)).rejects.toThrow(ErrorDeNegocio);
    const a = await crearOt(db, jefe, base);
    expect((await ot(a.id)).estado).toBe("CREADA");
    const b = await crearOt(db, jefe, { ...base, responsableId: mec1.id, fechaProgramada: "2026-11-14" });
    expect(await ot(b.id)).toMatchObject({ estado: "ASIGNADA", fechaProgramada: "2026-11-14", responsableId: mec1.id });
    const c = await crearOt(db, jefe, { ...base, proveedorExterno: "Servicio técnico externo" });
    expect(await ot(c.id)).toMatchObject({ estado: "ASIGNADA", responsableId: null });
    await asignarOt(db, jefe, a.id, { responsableId: mec2.id, fechaProgramada: "2026-11-20" });
    expect(await ot(a.id)).toMatchObject({ estado: "ASIGNADA", responsableId: mec2.id, fechaProgramada: "2026-11-20" });
  });

  it("respeta los cambios de estado permitidos y quién puede hacerlos", async () => {
    const { id } = await crearOt(db, jefe, {
      activoId: maquina, tipo: "CORRECTIVA", descripcion: "Revisión", especialidadId: espMec, prioridad: "BAJA", responsableId: mec1.id,
    });
    await expect(cambiarEstadoOt(db, mec2, id, "EN_CURSO")).rejects.toThrow("responsable");
    await expect(cambiarEstadoOt(db, mec1, id, "FINALIZADA")).rejects.toThrow("no está permitido");
    await expect(cambiarEstadoOt(db, mec1, id, "CANCELADA")).rejects.toThrow("no está permitido");
    await cambiarEstadoOt(db, jefe, id, "CANCELADA");
    await expect(cambiarEstadoOt(db, jefe, id, "EN_CURSO")).rejects.toThrow("no está permitido");
    await expect(asignarOt(db, jefe, id, { responsableId: mec2.id })).rejects.toThrow("cerrada");
  });

  const otBase = () => ({ activoId: maquina, tipo: "CORRECTIVA" as const, descripcion: "x", especialidadId: espMec, prioridad: "MEDIA" as const });

  it("el repuesto se pide desde la OT, hereda su máquina y avisa a bodega", async () => {
    const { id } = await nueva("MECANICA");
    await tomarSolicitud(db, mec1, id);
    // Desde la solicitud (SAT) no se piden repuestos: primero se convierte en OT.
    await expect(solicitarRepuesto(db, mec1, { solicitudId: id, cantidad: 1, descripcion: "Rodamiento" })).rejects.toThrow("primero convierte la solicitud en orden de trabajo");
    const ot = (await crearOt(db, jefe, otBase())).id;
    const rep = await solicitarRepuesto(db, mec1, { otId: ot, cantidad: 2, codigoFabricante: " 6205-2RS ", descripcion: "Rodamiento" });
    const [fila] = await db.select().from(schema.solicitudesRepuesto);
    expect(fila).toMatchObject({ id: rep, activoId: maquina, solicitudId: null, otId: ot, cantidad: 2, codigoFabricante: "6205-2RS", estado: "PENDIENTE" });
    expect(await avisosDe(bodeguero)).toContain("Solicitud de repuesto: 2 × Rodamiento");
    await expect(solicitarRepuesto(db, mec1, { otId: ot, cantidad: 0, descripcion: "x" })).rejects.toThrow("cantidad");
    await expect(solicitarRepuesto(db, mec1, { otId: ot, cantidad: 1.5, descripcion: "x" })).rejects.toThrow("cantidad");
    await expect(solicitarRepuesto(db, mec1, { cantidad: 1, descripcion: "x" })).rejects.toThrow("orden de trabajo o una pauta");
    await expect(solicitarRepuesto(db, operador, { otId: ot, cantidad: 1, descripcion: "x" })).rejects.toThrow(ErrorDeNegocio);
  });

  it("bodega entrega o rechaza una sola vez y avisa al solicitante", async () => {
    const ot = (await crearOt(db, jefe, otBase())).id;
    const rep = await solicitarRepuesto(db, mec1, { otId: ot, cantidad: 1, descripcion: "Retén" });
    await expect(resolverRepuesto(db, mec1, rep, "ENTREGADA")).rejects.toThrow("bodega");
    await resolverRepuesto(db, bodeguero, rep, "ENTREGADA");
    expect((await db.select().from(schema.solicitudesRepuesto))[0]).toMatchObject({ estado: "ENTREGADA", resueltaPor: bodeguero.id });
    expect(await avisosDe(mec1)).toContain("Repuesto entregado: Retén");
    await expect(resolverRepuesto(db, bodeguero, rep, "RECHAZADA")).rejects.toThrow("ya fue resuelta");
  });
});
