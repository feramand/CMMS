import ExcelJS from "exceljs";
import { db } from "@/db";
import { nombreCategoria } from "@/lib/categorias";
import { informe, periodoPedido } from "@/lib/indicadores-core";
import { usuarioActual } from "@/lib/dal";
import { fechaHora } from "@/lib/tiempo";

type Celda = string | number | null;

function hoja(libro: ExcelJS.Workbook, nombre: string, columnas: [string, number][], filas: Celda[][]) {
  const h = libro.addWorksheet(nombre);
  h.columns = columnas.map(([header, width]) => ({ header, width }));
  h.getRow(1).font = { bold: true };
  h.views = [{ state: "frozen", ySplit: 1 }];
  for (const f of filas) h.addRow(f.map((c) => c ?? ""));
}

// Los mismos indicadores de la pantalla, en un libro Excel. Los tiempos van en minutos, como número.
export async function GET(request: Request) {
  const usuario = await usuarioActual();
  if (!usuario || (usuario.perfil !== "ADMINISTRADOR" && usuario.perfil !== "JEFE_PLANIFICADOR")) {
    return new Response("No autorizado", { status: 403 });
  }
  const parametros = new URL(request.url).searchParams;
  const { desde, hasta } = periodoPedido({ desde: parametros.get("desde"), hasta: parametros.get("hasta") });
  const i = await informe(db, desde, hasta);
  const p = i.preventivo;
  const libro = new ExcelJS.Workbook();

  hoja(libro, "Resumen", [["Indicador", 46], ["Valor", 16], ["Unidad", 12]], [
    ["Período desde", desde, ""],
    ["Período hasta", hasta, ""],
    ["Tiempo detenido por fallas (suma de máquinas)", i.detencion.minutos, "minutos"],
    ["Fallas con detención", i.detencion.fallas, ""],
    ["Fallas con detención aún abiertas", i.detencion.abiertas, ""],
    ["Fallas con detención resueltas en el período", i.detencion.resueltas, ""],
    ["MTTR (detención → solución)", i.detencion.mttr, "minutos"],
    ["Tiempo de respuesta promedio", i.detencion.respuesta, "minutos"],
    ["Tiempo de reparación promedio", i.detencion.reparacion, "minutos"],
    ["Solicitudes creadas", i.atencion.creadas, ""],
    ["Solicitudes resueltas", i.atencion.resueltas, ""],
    ["Solicitudes resueltas sin OT", i.atencion.sinOt, ""],
    ["Solicitudes resueltas con OT", i.atencion.conOt, ""],
    ["% resueltas sin OT", i.atencion.pctSinOt, "%"],
    ...i.atencion.porCategoria.map((c): Celda[] => [`Solicitudes creadas · ${nombreCategoria(c.categoria)}`, c.cantidad, ""]),
    ["Pautas cerradas", p.total, ""],
    ["Pautas ejecutadas a tiempo", p.aTiempo, ""],
    ["Pautas ejecutadas con atraso", p.conAtraso, ""],
    ["Pautas incumplidas", p.incumplidas, ""],
    ["Cumplimiento preventivo", p.pctCumplimiento, "%"],
    ["Pautas a tiempo", p.pctATiempo, "%"],
    ["Actividades de pauta hechas", p.actividades.hechas, ""],
    ["Actividades de pauta no realizadas", p.actividades.noRealizadas, ""],
  ]);

  hoja(
    libro,
    "Por máquina",
    [["Máquina", 28], ["Planta", 16], ["Fallas con detención", 18], ["Iniciadas en el período", 20], ["Abiertas", 10], ["Minutos detenida", 16], ["% del período", 13], ["Resueltas", 10], ["MTTR (min)", 12], ["Respuesta (min)", 15], ["Reparación (min)", 16], ["MTBF (min)", 12]],
    i.maquinas.map((m) => [m.activo, m.planta, m.fallas, m.iniciadas, m.abiertas, m.minutosDetenida, m.pctDetenida, m.resueltas, m.mttr, m.respuesta, m.reparacion, m.mtbf]),
  );

  hoja(
    libro,
    "Fallas",
    [["Solicitud", 10], ["Máquina", 28], ["Sistema", 22], ["Tipo de falla", 20], ["Detenida desde", 18], ["Tomada", 18], ["Resuelta", 18], ["Con OT", 8], ["Minutos en el período", 20]],
    i.detalle.map((f) => [f.id, f.activo, f.sistema, nombreCategoria(f.categoria), fechaHora(f.desde), f.tomadaEn ? fechaHora(f.tomadaEn) : "", f.hasta ? fechaHora(f.hasta) : "Abierta", f.conOt ? "Sí" : "No", f.minutos]),
  );

  hoja(
    libro,
    "Preventivo por máquina",
    [["Máquina", 28], ["Cerradas", 10], ["A tiempo", 10], ["Con atraso", 11], ["Incumplidas", 12], ["Cumplimiento %", 15], ["A tiempo %", 12]],
    p.porMaquina.map((m) => [m.activo, m.total, m.aTiempo, m.conAtraso, m.incumplidas, m.pctCumplimiento, m.pctATiempo]),
  );

  hoja(
    libro,
    "Pautas",
    [["Máquina", 28], ["Pauta", 24], ["Vuelta", 8], ["Resultado", 22], ["Cerrada", 18], ["Objetivo", 18], ["Real", 18], ["Ejecutó", 22]],
    p.ciclos.map((c) => [c.activo, c.pauta, c.vuelta, c.estado === "INCUMPLIDA" ? "Incumplida" : c.aTiempo ? "Ejecutada a tiempo" : "Ejecutada con atraso", fechaHora(c.cerradoEn), c.objetivo, c.real, c.ejecuto]),
  );

  hoja(libro, "Recurrentes", [["Máquina", 28], ["Sistema", 26], ["Veces", 8]], i.recurrentes.map((r) => [r.activo, r.sistema, r.veces]));

  hoja(
    libro,
    "Técnicos",
    [["Técnico", 26], ["Solicitudes resueltas sin OT", 26], ["OT finalizadas", 15], ["Apoyos", 9], ["Pautas finalizadas", 18], ["Actividades de pauta", 20]],
    i.porTecnico.map((t) => [t.nombre, t.solicitudes, t.ordenes, t.apoyos, t.pautas, t.actividades]),
  );

  return new Response(new Uint8Array(await libro.xlsx.writeBuffer()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="indicadores-${desde}-a-${hasta}.xlsx"`,
    },
  });
}
