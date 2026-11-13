import { asc, desc } from "drizzle-orm";
import { accionDesactivarCodigo, accionGuardarCodigo } from "@/app/preventivo/actions";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, campo, Chip, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { activos, codigosFallaMetrics, eventosIntegracion } from "@/db/schema";
import { nombreBd } from "@/lib/categorias";
import { exigirPerfil } from "@/lib/dal";
import { CATEGORIAS_METRICS } from "@/lib/metrics-core";
import { fechaHora } from "@/lib/tiempo";

const TONO = { PROCESADO: "verde", IGNORADO: "gris", ERROR: "rojo" } as const;
const NOMBRE = { PROCESADO: "Procesado", IGNORADO: "Ignorado", ERROR: "Error" } as const;

export default async function IntegracionMetrics({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const { error } = await searchParams;
  const [codigos, eventos, maquinas] = await Promise.all([
    db.select().from(codigosFallaMetrics).orderBy(asc(codigosFallaMetrics.codigo)),
    db.select().from(eventosIntegracion).orderBy(desc(eventosIntegracion.id)).limit(50),
    db.select({ nombre: activos.nombre, codigo: activos.codigoMetrics, estado: activos.estadoOperativo }).from(activos).orderBy(asc(activos.nombre)),
  ]);
  const sinCodigo = maquinas.filter((m) => !m.codigo && m.estado !== "DESINSTALADO");
  const configurada = Boolean(process.env.METRICS_API_KEY);
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Integración con Metrics</h1>
        <AvisoError mensaje={error} />
        <p role="status" className={`rounded-lg px-4 py-3 ${configurada ? "bg-green-100 text-green-900" : "bg-amber-100 text-amber-900"}`}>
          {configurada
            ? "La clave del conector está configurada: el sistema acepta lecturas de giros y detenciones."
            : "Falta la clave del conector (METRICS_API_KEY). Hasta que TI la configure, el sistema no recibe datos de Metrics; los giros se ingresan a mano en la ficha de cada máquina."}
        </p>
        {sinCodigo.length > 0 && (
          <p className="rounded-lg bg-amber-100 px-4 py-3 text-amber-900">
            {sinCodigo.length} {sinCodigo.length === 1 ? "máquina no tiene" : "máquinas no tienen"} código de Metrics y no
            recibirán datos: {sinCodigo.map((m) => m.nombre).join(", ")}. Se completa en «Editar ficha» de cada máquina.
          </p>
        )}

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Códigos de Breakdown Downtime que generan solicitud · {codigos.filter((c) => c.activo).length}</h2>
          <p className="text-slate-700">
            Aquí se asignan los códigos de Metrics que corresponden a Breakdown Downtime (BD): fallas reales del
            equipo. Solo las detenciones con uno de estos códigos crean una solicitud de atención, y solo ellas
            entran al MTTR y al MTBF. Cualquier otro Delay (ajustes operacionales, esperas de material, planchas,
            pruebas o aprobaciones, «Parada No Informada») se ignora. Usa «BD General» para la falla que el
            operador no sabe clasificar: la ven mecánicos y eléctricos, y el técnico indica el origen real al cerrar.
          </p>
          <form action={accionGuardarCodigo} className="grid gap-2 sm:grid-cols-[1fr_2fr_1fr_auto] sm:items-end">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Código en Metrics
              <input name="codigo" required className={campo} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Descripción
              <input name="descripcion" className={campo} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Tipo de BD
              <select name="categoria" required className={campo}>
                {CATEGORIAS_METRICS.map((c) => (
                  <option key={c} value={c}>
                    {nombreBd(c)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={botonPrimario}>
              Guardar
            </button>
          </form>
          <p className="text-sm text-slate-600">Guardar un código que ya existe lo actualiza y lo reactiva.</p>
          {codigos.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-base">
                <thead className="text-sm text-slate-600">
                  <tr>
                    <th className="p-2 font-semibold">Código</th>
                    <th className="p-2 font-semibold">Descripción</th>
                    <th className="p-2 font-semibold">Tipo de BD</th>
                    <th className="p-2 font-semibold">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {codigos.map((c) => (
                    <tr key={c.codigo} className="border-t border-slate-200">
                      <td className="p-2 font-semibold">{c.codigo}</td>
                      <td className="p-2">{c.descripcion ?? "—"}</td>
                      <td className="p-2">{nombreBd(c.categoria)}</td>
                      <td className="p-2">
                        {c.activo ? (
                          <form action={accionDesactivarCodigo}>
                            <input type="hidden" name="codigo" value={c.codigo} />
                            <button type="submit" className="h-11 text-sm font-semibold text-red-800 underline">
                              Dejar de usar
                            </button>
                          </form>
                        ) : (
                          <Chip tono="gris">No se usa</Chip>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Últimos mensajes recibidos · {eventos.length}</h2>
          {eventos.length === 0 && <p className="text-slate-600">Todavía no llega ningún mensaje de Metrics.</p>}
          <ul className="flex flex-col gap-2">
            {eventos.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2">
                <Chip tono={TONO[e.resultado]}>{NOMBRE[e.resultado]}</Chip>
                <span className="text-sm text-slate-600">
                  {fechaHora(e.recibidoEn)} · {e.tipo === "GIROS" ? "Giros" : "Detención"}
                </span>
                <span className="basis-full">{e.detalle}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
