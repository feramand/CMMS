import { and, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import Link from "next/link";
import { Encabezado } from "@/componentes/encabezado";
import { botonPrimario, campo, Chip, Dato, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { activos, plantas, solicitudes } from "@/db/schema";
import { nombreCategoria } from "@/lib/categorias";
import { exigirPerfil } from "@/lib/dal";
import { downtimePorMaquina, porcentajeDetenida } from "@/lib/downtime";
import { esFechaValida, sumarDias } from "@/lib/pautas-calculo";
import { duracion, fechaHora, inicioDelDiaEnChile, minutosEntre, partesEnChile } from "@/lib/tiempo";

const corta = (iso: string) => iso.split("-").reverse().join("-");

// Indicadores de mantenimiento. Por ahora: downtime por falla. El resto llega con la etapa 5.
export default async function Indicadores({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const pedido = await searchParams;
  const ahora = new Date();
  const hoy = partesEnChile(ahora).fecha;
  const primeroDelMes = `${hoy.slice(0, 8)}01`;
  // Período: fechas de Chile, ambas inclusive. Por defecto, el mes en curso.
  let desde = pedido.desde && esFechaValida(pedido.desde) ? pedido.desde : primeroDelMes;
  let hasta = pedido.hasta && esFechaValida(pedido.hasta) ? pedido.hasta : hoy;
  if (hasta < desde) [desde, hasta] = [hasta, desde];
  const inicio = inicioDelDiaEnChile(desde);
  const fin = inicioDelDiaEnChile(sumarDias(hasta, 1));
  const empieza = sql<Date>`coalesce(${solicitudes.detenidaEn}, ${solicitudes.creadaEn})`;

  const fallas = await db
    .select({
      id: solicitudes.id,
      activoId: solicitudes.activoId,
      activo: activos.nombre,
      planta: plantas.nombre,
      categoria: solicitudes.categoria,
      origenReal: solicitudes.origenReal,
      detenidaEn: solicitudes.detenidaEn,
      creadaEn: solicitudes.creadaEn,
      cerradaEn: solicitudes.cerradaEn,
    })
    .from(solicitudes)
    .innerJoin(activos, eq(activos.id, solicitudes.activoId))
    .innerJoin(plantas, eq(plantas.id, activos.plantaId))
    .where(
      and(
        eq(solicitudes.maquinaDetenida, true),
        ne(solicitudes.estado, "ANULADA"),
        lt(empieza, fin),
        or(isNull(solicitudes.cerradaEn), gt(solicitudes.cerradaEn, inicio)),
      ),
    );
  const conTramo = fallas.map((f) => ({ ...f, desde: f.detenidaEn ?? f.creadaEn, hasta: f.cerradaEn }));
  const porMaquina = downtimePorMaquina(conTramo, inicio, fin, ahora)
    .map((d) => {
      const f = conTramo.find((x) => x.activoId === d.activoId)!;
      return { ...d, activo: f.activo, planta: f.planta, porcentaje: porcentajeDetenida(d.minutos, inicio, fin, ahora) };
    })
    .sort((a, b) => b.minutos - a.minutos);
  const total = porMaquina.reduce((t, m) => t + m.minutos, 0);
  const totalFallas = porMaquina.reduce((t, m) => t + m.fallas, 0);
  const abiertas = porMaquina.reduce((t, m) => t + m.abiertas, 0);
  // Detalle: cada falla con su duración dentro del período.
  const tope = new Date(Math.min(fin.getTime(), ahora.getTime()));
  const detalle = conTramo
    .map((f) => ({
      ...f,
      minutos: minutosEntre(new Date(Math.max(f.desde.getTime(), inicio.getTime())), new Date(Math.min((f.hasta ?? tope).getTime(), tope.getTime()))) ?? 0,
    }))
    .filter((f) => f.minutos > 0)
    .sort((a, b) => b.minutos - a.minutos);

  const mesAnterior = sumarDias(primeroDelMes, -1);
  const atajos = [
    { nombre: "Hoy", desde: hoy, hasta: hoy },
    { nombre: "Últimos 7 días", desde: sumarDias(hoy, -6), hasta: hoy },
    { nombre: "Este mes", desde: primeroDelMes, hasta: hoy },
    { nombre: "Mes anterior", desde: `${mesAnterior.slice(0, 8)}01`, hasta: mesAnterior },
    { nombre: "Este año", desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy },
  ];
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Indicadores</h1>

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
          </form>
        </section>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">
            Downtime por falla · {corta(desde)} al {corta(hasta)}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Dato etiqueta="Tiempo detenido (suma de máquinas)">{duracion(total)}</Dato>
            <Dato etiqueta="Fallas con detención">{totalFallas}</Dato>
            <Dato etiqueta="Máquinas afectadas">{porMaquina.length}</Dato>
            <Dato etiqueta="Fallas aún abiertas">{abiertas}</Dato>
          </div>
          {porMaquina.length === 0 ? (
            <p className="text-slate-600">No hubo detenciones por falla en este período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-base">
                <thead className="text-sm text-slate-600">
                  <tr>
                    <th className="p-2 font-semibold">Máquina</th>
                    <th className="p-2 font-semibold">Planta</th>
                    <th className="p-2 text-right font-semibold">Fallas</th>
                    <th className="p-2 text-right font-semibold">Tiempo detenida</th>
                    <th className="p-2 text-right font-semibold">% del período</th>
                  </tr>
                </thead>
                <tbody>
                  {porMaquina.map((m) => (
                    <tr key={m.activoId} className="border-t border-slate-200">
                      <td className="p-2">
                        <Link href={`/admin/activos/${m.activoId}`} className="text-marca underline">
                          {m.activo}
                        </Link>{" "}
                        {m.abiertas > 0 && <Chip tono="rojo">Detenida ahora</Chip>}
                      </td>
                      <td className="p-2">{m.planta}</td>
                      <td className="p-2 text-right tabular-nums">{m.fallas}</td>
                      <td className="p-2 text-right font-semibold tabular-nums">{duracion(m.minutos)}</td>
                      <td className="p-2 text-right tabular-nums">{m.porcentaje.toLocaleString("es-CL")} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details>
            <summary className="cursor-pointer text-marca">Cómo se calcula</summary>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-slate-700">
              <li>Cuentan las solicitudes de atención marcadas con «máquina detenida», incluidas todas las que llegan de Metrics. Las anuladas no cuentan.</li>
              <li>El tiempo corre desde la hora de detención informada por Metrics, o desde el reporte si se hizo a mano, hasta que la solicitud queda solucionada. Si pasó a una orden de trabajo, hasta que esa orden se finaliza.</li>
              <li>Solo se cuenta la parte de cada falla que cae dentro del período. Una falla abierta cuenta hasta este momento.</li>
              <li>Si una máquina tiene dos fallas a la vez, ese rato se cuenta una sola vez.</li>
              <li>El porcentaje es sobre el tiempo calendario del período (24 horas por día), no sobre las horas de producción.</li>
            </ul>
          </details>
        </section>

        {detalle.length > 0 && (
          <section className={`${tarjeta} flex flex-col gap-3`}>
            <h2 className="text-lg font-bold">Detalle de fallas · {detalle.length}</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-base">
                <thead className="text-sm text-slate-600">
                  <tr>
                    <th className="p-2 font-semibold">Detenida desde</th>
                    <th className="p-2 font-semibold">Máquina</th>
                    <th className="p-2 font-semibold">Tipo de falla</th>
                    <th className="p-2 font-semibold">Resuelta</th>
                    <th className="p-2 text-right font-semibold">En el período</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.slice(0, 100).map((f) => (
                    <tr key={f.id} className="border-t border-slate-200">
                      <td className="p-2">
                        <Link href={`/sat/${f.id}`} className="text-marca underline">
                          {fechaHora(f.desde)}
                        </Link>
                      </td>
                      <td className="p-2">{f.activo}</td>
                      <td className="p-2">{nombreCategoria(f.origenReal ?? f.categoria)}</td>
                      <td className="p-2">{f.hasta ? fechaHora(f.hasta) : "Abierta"}</td>
                      <td className="p-2 text-right font-semibold tabular-nums">{duracion(f.minutos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detalle.length > 100 && <p className="text-sm text-slate-600">Se muestran las 100 más largas.</p>}
          </section>
        )}
        <p className="text-sm text-slate-600">Los demás indicadores (MTTR, MTBF, cumplimiento de pautas, tiempos de respuesta) llegan con la etapa 5.</p>
      </main>
    </>
  );
}
