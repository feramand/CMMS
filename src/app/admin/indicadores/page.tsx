import Link from "next/link";
import { Encabezado } from "@/componentes/encabezado";
import { botonPrimario, botonSecundario, campo, Chip, Dato, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { nombreCategoria } from "@/lib/categorias";
import { informe, periodoPedido, UMBRAL_RECURRENTE } from "@/lib/indicadores-core";
import { exigirPerfil } from "@/lib/dal";
import { MOTIVOS_NO_REALIZADA } from "@/lib/pautas-core";
import { sumarDias } from "@/lib/pautas-calculo";
import { duracion, fechaHora } from "@/lib/tiempo";

const corta = (iso: string) => iso.split("-").reverse().join("-");
const pct = (valor: number | null) => (valor === null ? "—" : `${valor.toLocaleString("es-CL")} %`);
/** Tiempos largos (MTBF) en días, horas y minutos. */
function duracionLarga(minutos: number | null): string {
  if (minutos === null || minutos < 48 * 60) return duracion(minutos);
  const dias = Math.floor(minutos / 1440);
  const resto = minutos % 1440;
  return resto === 0 ? `${dias} d` : `${dias} d ${duracion(resto)}`;
}
const th = "p-2 font-semibold";
const num = "p-2 text-right tabular-nums";

// Indicadores de mantenimiento de un período: detención, MTTR, MTBF, preventivo, recurrencia y trabajo por técnico.
export default async function Indicadores({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const { desde, hasta, hoy } = periodoPedido(await searchParams);
  const i = await informe(db, desde, hasta);
  const primeroDelMes = `${hoy.slice(0, 8)}01`;
  const mesAnterior = sumarDias(primeroDelMes, -1);
  const atajos = [
    { nombre: "Hoy", desde: hoy, hasta: hoy },
    { nombre: "Últimos 7 días", desde: sumarDias(hoy, -6), hasta: hoy },
    { nombre: "Este mes", desde: primeroDelMes, hasta: hoy },
    { nombre: "Mes anterior", desde: `${mesAnterior.slice(0, 8)}01`, hasta: mesAnterior },
    { nombre: "Este año", desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy },
  ];
  const p = i.preventivo;
  const motivo = (m: string) => MOTIVOS_NO_REALIZADA[m as keyof typeof MOTIVOS_NO_REALIZADA] ?? m;
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Indicadores</h1>
          <Link href="/soluciones" className="text-marca underline">
            Base de soluciones
          </Link>
        </div>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Período</h2>
          <nav aria-label="Períodos frecuentes" className="flex flex-wrap gap-2">
            {atajos.map((a) => {
              const activo = a.desde === desde && a.hasta === hasta;
              return (
                <Link
                  key={a.nombre}
                  href={`/admin/indicadores?desde=${a.desde}&hasta=${a.hasta}`}
                  aria-current={activo ? "true" : undefined}
                  className={`flex h-11 items-center rounded-full border px-4 text-base ${activo ? "border-marca bg-marca font-semibold text-white" : "border-slate-400 bg-white"}`}
                >
                  {a.nombre}
                </Link>
              );
            })}
          </nav>
          <form className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Desde
              <input type="date" name="desde" defaultValue={desde} required className={campo} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Hasta
              <input type="date" name="hasta" defaultValue={hasta} required className={campo} />
            </label>
            <button type="submit" className={botonPrimario}>
              Ver período
            </button>
            <a href={`/admin/indicadores/exportar?desde=${desde}&hasta=${hasta}`} className={botonSecundario}>
              Descargar en Excel
            </a>
          </form>
        </section>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">
            Resumen · {corta(desde)} al {corta(hasta)}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Dato etiqueta="Tiempo detenido (suma de máquinas)">{duracionLarga(i.detencion.minutos)}</Dato>
            <Dato etiqueta="Fallas con detención">{i.detencion.fallas}</Dato>
            <Dato etiqueta="MTTR (detención → solución)">{duracion(i.detencion.mttr)}</Dato>
            <Dato etiqueta="Fallas aún abiertas">{i.detencion.abiertas}</Dato>
            <Dato etiqueta="Tiempo de respuesta promedio">{duracion(i.detencion.respuesta)}</Dato>
            <Dato etiqueta="Tiempo de reparación promedio">{duracion(i.detencion.reparacion)}</Dato>
            <Dato etiqueta="Cumplimiento preventivo">{pct(p.pctCumplimiento)}</Dato>
            <Dato etiqueta="Solicitudes resueltas sin OT">{pct(i.atencion.pctSinOt)}</Dato>
          </div>
        </section>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Fallas con detención por máquina</h2>
          {i.maquinas.length === 0 ? (
            <p className="text-slate-600">No hubo detenciones por falla en este período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-base">
                <thead className="text-sm text-slate-600">
                  <tr>
                    <th className={th}>Máquina</th>
                    <th className={`${th} text-right`}>Fallas</th>
                    <th className={`${th} text-right`}>Tiempo detenida</th>
                    <th className={`${th} text-right`}>% del período</th>
                    <th className={`${th} text-right`}>MTTR</th>
                    <th className={`${th} text-right`}>Respuesta</th>
                    <th className={`${th} text-right`}>Reparación</th>
                    <th className={`${th} text-right`}>MTBF</th>
                  </tr>
                </thead>
                <tbody>
                  {i.maquinas.map((m) => (
                    <tr key={m.activoId} className="border-t border-slate-200">
                      <td className="p-2">
                        <Link href={`/admin/activos/${m.activoId}`} className="text-marca underline">
                          {m.activo}
                        </Link>{" "}
                        <span className="text-sm text-slate-600">{m.planta}</span> {m.abiertas > 0 && <Chip tono="rojo">Detenida ahora</Chip>}
                      </td>
                      <td className={num}>{m.fallas}</td>
                      <td className={`${num} font-semibold`}>{duracion(m.minutosDetenida)}</td>
                      <td className={num}>{pct(m.pctDetenida)}</td>
                      <td className={num}>{duracion(m.mttr)}</td>
                      <td className={num}>{duracion(m.respuesta)}</td>
                      <td className={num}>{duracion(m.reparacion)}</td>
                      <td className={num}>{duracionLarga(m.mtbf)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Solicitudes de atención</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Dato etiqueta="Creadas en el período">{i.atencion.creadas}</Dato>
            <Dato etiqueta="Resueltas en el período">{i.atencion.resueltas}</Dato>
            <Dato etiqueta="Resueltas sin OT">{i.atencion.sinOt}</Dato>
            <Dato etiqueta="Resueltas con OT">{i.atencion.conOt}</Dato>
            <Dato etiqueta="% resueltas sin OT">{pct(i.atencion.pctSinOt)}</Dato>
          </div>
          {i.atencion.porCategoria.length > 0 && (
            <p className="text-slate-700">
              Creadas por tipo de falla: {i.atencion.porCategoria.map((c) => `${nombreCategoria(c.categoria)} ${c.cantidad}`).join(" · ")}
            </p>
          )}
        </section>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Mantenimiento preventivo</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Dato etiqueta="Pautas cerradas en el período">{p.total}</Dato>
            <Dato etiqueta="Ejecutadas a tiempo">{p.aTiempo}</Dato>
            <Dato etiqueta="Ejecutadas con atraso">{p.conAtraso}</Dato>
            <Dato etiqueta="Incumplidas">{p.incumplidas}</Dato>
            <Dato etiqueta="Cumplimiento · a tiempo">
              {pct(p.pctCumplimiento)} · {pct(p.pctATiempo)}
            </Dato>
          </div>
          {p.total === 0 ? (
            <p className="text-slate-600">No se cerró ninguna pauta en este período.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-base">
                  <thead className="text-sm text-slate-600">
                    <tr>
                      <th className={th}>Máquina</th>
                      <th className={`${th} text-right`}>A tiempo</th>
                      <th className={`${th} text-right`}>Con atraso</th>
                      <th className={`${th} text-right`}>Incumplidas</th>
                      <th className={`${th} text-right`}>Cumplimiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.porMaquina.map((m) => (
                      <tr key={m.activoId} className="border-t border-slate-200">
                        <td className="p-2">{m.activo}</td>
                        <td className={num}>{m.aTiempo}</td>
                        <td className={num}>{m.conAtraso}</td>
                        <td className={num}>{m.incumplidas}</td>
                        <td className={`${num} font-semibold`}>{pct(m.pctCumplimiento)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-slate-700">
                Actividades de las pautas ejecutadas: {p.actividades.hechas} hechas y {p.actividades.noRealizadas} no realizadas
                {p.actividades.porMotivo.length > 0 ? ` (${p.actividades.porMotivo.map((m) => `${motivo(m.motivo)} ${m.cantidad}`).join(" · ")})` : ""}.
              </p>
            </>
          )}
        </section>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Fallas recurrentes</h2>
          {i.recurrentes.length === 0 ? (
            <p className="text-slate-600">Ningún sistema falló {UMBRAL_RECURRENTE} o más veces en este período.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {i.recurrentes.map((r) => (
                <li key={`${r.activoId}-${r.sectorId}`} className="border-t border-slate-200 pt-1">
                  <Link href={`/soluciones?activoId=${r.activoId}&q=${encodeURIComponent(r.sistema)}`} className="text-marca underline">
                    {r.activo} · {r.sistema}
                  </Link>{" "}
                  <span className="font-semibold tabular-nums">{r.veces} veces</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Trabajo por técnico</h2>
          <p className="text-sm text-slate-600">En orden alfabético. Son cantidades de trabajo registrado, no una clasificación.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-base">
              <thead className="text-sm text-slate-600">
                <tr>
                  <th className={th}>Técnico</th>
                  <th className={`${th} text-right`}>Solicitudes resueltas sin OT</th>
                  <th className={`${th} text-right`}>OT finalizadas</th>
                  <th className={`${th} text-right`}>Apoyos</th>
                  <th className={`${th} text-right`}>Pautas finalizadas</th>
                  <th className={`${th} text-right`}>Actividades de pauta</th>
                </tr>
              </thead>
              <tbody>
                {i.porTecnico.map((t) => (
                  <tr key={t.usuarioId} className="border-t border-slate-200">
                    <td className="p-2">{t.nombre}</td>
                    <td className={num}>{t.solicitudes}</td>
                    <td className={num}>{t.ordenes}</td>
                    <td className={num}>{t.apoyos}</td>
                    <td className={num}>{t.pautas}</td>
                    <td className={num}>{t.actividades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {i.detalle.length > 0 && (
          <section className={`${tarjeta} flex flex-col gap-3`}>
            <h2 className="text-lg font-bold">Detalle de fallas con detención · {i.detalle.length}</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-base">
                <thead className="text-sm text-slate-600">
                  <tr>
                    <th className={th}>Detenida desde</th>
                    <th className={th}>Máquina</th>
                    <th className={th}>Tipo de falla</th>
                    <th className={th}>Resuelta</th>
                    <th className={`${th} text-right`}>En el período</th>
                  </tr>
                </thead>
                <tbody>
                  {i.detalle.slice(0, 100).map((f) => (
                    <tr key={f.id} className="border-t border-slate-200">
                      <td className="p-2">
                        <Link href={`/sat/${f.id}`} className="text-marca underline">
                          {fechaHora(f.desde)}
                        </Link>
                      </td>
                      <td className="p-2">
                        {f.activo}
                        {f.sistema ? ` · ${f.sistema}` : ""}
                      </td>
                      <td className="p-2">{nombreCategoria(f.categoria)}</td>
                      <td className="p-2">{f.hasta ? fechaHora(f.hasta) : "Abierta"}</td>
                      <td className={`${num} font-semibold`}>{duracion(f.minutos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {i.detalle.length > 100 && <p className="text-sm text-slate-600">Se muestran las 100 más largas. El Excel las trae todas.</p>}
          </section>
        )}

        <details className={tarjeta}>
          <summary className="cursor-pointer text-lg font-semibold text-marca">Cómo se calcula cada indicador</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-slate-700">
            <li>Falla con detención: solicitud de atención marcada con «máquina detenida», incluidas todas las que llegan de Metrics. Las anuladas no cuentan.</li>
            <li>Tiempo detenida: desde la hora de detención de Metrics (o del reporte, si se hizo a mano) hasta que la solicitud queda solucionada; si pasó a orden de trabajo, hasta que esa orden se finaliza. Solo cuenta la parte que cae dentro del período; una falla abierta cuenta hasta este momento; dos fallas simultáneas de la misma máquina se cuentan una vez.</li>
            <li>% del período: tiempo detenida sobre el tiempo calendario (24 horas por día), no sobre las horas de producción.</li>
            <li>MTTR: promedio del tiempo entre la detención y la solución, sobre las fallas resueltas dentro del período, con su duración completa.</li>
            <li>Respuesta: promedio entre que llega el aviso y un técnico lo toma. Reparación: promedio entre que lo toma y queda resuelto.</li>
            <li>MTBF: tiempo calendario transcurrido del período menos el tiempo detenida, dividido por las fallas que empezaron en el período. Sin fallas no se calcula.</li>
            <li>Cumplimiento preventivo: pautas ejecutadas sobre las cerradas en el período (ejecutadas más incumplidas). «A tiempo» es ejecutada antes o justo en el 100 % del intervalo; «con atraso», entre el 100 % y el límite; al pasar el límite queda incumplida.</li>
            <li>Resueltas sin OT: solicitudes solucionadas directamente por el técnico, sobre el total de resueltas en el período.</li>
            <li>Falla recurrente: el mismo sistema de la misma máquina con {UMBRAL_RECURRENTE} o más solicitudes creadas en el período.</li>
          </ul>
        </details>
      </main>
    </>
  );
}
