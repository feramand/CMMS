import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  accionActualizarPauta,
  accionAgregarActividad,
  accionLiberar,
  accionQuitarActividad,
} from "@/app/preventivo/actions";
import { Encabezado } from "@/componentes/encabezado";
import { BarraAvance, ChipPauta } from "@/componentes/pautas";
import { AvisoError, botonPrimario, botonSecundario, campo, Chip, Dato, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { actividadesPauta, ciclosPauta, especialidades, pautas, usuarios } from "@/db/schema";
import { fechaCorta, intervaloTexto, listarPautas } from "@/lib/consultas-pautas";
import { exigirPerfil } from "@/lib/dal";
import { porcentajesGenerales } from "@/lib/pautas-core";
import { fechaHora } from "@/lib/tiempo";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

const ESTADO = {
  PROGRAMADA: { nombre: "Programada", tono: "gris" },
  LIBERADA: { nombre: "Liberada", tono: "ambar" },
  EJECUTADA: { nombre: "Ejecutada", tono: "verde" },
  INCUMPLIDA: { nombre: "Incumplida", tono: "rojo" },
} as const;

export default async function DetallePauta({ params, searchParams }: Props) {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const id = Number((await params).id);
  const { error } = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const [p] = await listarPautas(eq(pautas.id, id));
  if (!p) notFound();
  const [[propia], actividades, historial, listaEsp, generales] = await Promise.all([
    db.select({ lib: pautas.pctLiberacion, lim: pautas.pctLimite, incluye: pautas.incluyeInferiores, frecuencia: pautas.frecuencia }).from(pautas).where(eq(pautas.id, id)),
    db.select().from(actividadesPauta).where(and(eq(actividadesPauta.pautaId, id), eq(actividadesPauta.activa, true))).orderBy(asc(actividadesPauta.orden)),
    db
      .select({ ciclo: ciclosPauta, quien: usuarios.nombre })
      .from(ciclosPauta)
      .leftJoin(usuarios, eq(usuarios.id, ciclosPauta.ejecutadoPor))
      .where(eq(ciclosPauta.pautaId, id))
      .orderBy(desc(ciclosPauta.id))
      .limit(30),
    db.select().from(especialidades).where(eq(especialidades.activa, true)).orderBy(asc(especialidades.nombre)),
    porcentajesGenerales(db),
  ]);
  const esGiros = p.tipo === "GIROS";
  const n = (x: number | null) => (x === null ? "—" : x.toLocaleString("es-CL"));
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{p.nombre}</h1>
            <p className="text-slate-600">
              <Link href={`/admin/activos/${p.activoId}`} className="text-marca underline">
                {p.activo}
              </Link>{" "}
              · {p.especialidad} · {intervaloTexto(p.tipo, p.intervalo, p.unidad)}
            </p>
          </div>
          <Link href="/admin/preventivo" className="text-marca underline">
            Volver a planificación
          </Link>
        </div>
        <AvisoError mensaje={error} />

        {p.ciclo && p.resumen && (
          <section className={`${tarjeta} flex flex-col gap-3`}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold">Ciclo actual</h2>
              <ChipPauta p={p} />
            </div>
            <BarraAvance avance={p.resumen.avance} liberada={p.ciclo.estado === "LIBERADA"} />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Dato etiqueta="Base">{p.resumen.base}</Dato>
              <Dato etiqueta="Se libera">{p.resumen.liberacion}</Dato>
              <Dato etiqueta="Objetivo">{p.resumen.objetivo}</Dato>
              <Dato etiqueta="Incumplida si llega a">{p.resumen.limite}</Dato>
              {esGiros && <Dato etiqueta="Contador actual">{n(p.giros)} {p.unidad}</Dato>}
              {p.ciclo.liberadoEn && <Dato etiqueta="Liberada el">{fechaHora(p.ciclo.liberadoEn)}</Dato>}
              {p.ciclo.responsable && <Dato etiqueta="La ejecuta">{p.ciclo.responsable}</Dato>}
              {p.ciclo.variante && <Dato etiqueta="Vuelta que toca">{p.ciclo.variante}</Dato>}
            </div>
            {p.incluidaEn ? (
              <Link href={`/pauta/${p.incluidaEn.cicloId}`} className="text-marca underline">
                Sus tareas se ejecutan dentro de {p.incluidaEn.nombre}, que ya está liberada.
              </Link>
            ) : p.ciclo.estado === "PROGRAMADA" && p.activa ? (
              <form action={accionLiberar}>
                <input type="hidden" name="cicloId" value={p.ciclo.id} />
                <input type="hidden" name="pautaId" value={id} />
                <input type="hidden" name="origen" value="detalle" />
                <button type="submit" className={botonSecundario}>
                  Liberar ahora, antes de tiempo
                </button>
              </form>
            ) : (
              p.ciclo.estado === "LIBERADA" && (
                <Link href={`/pauta/${p.ciclo.id}`} className="text-marca underline">
                  Abrir checklist
                </Link>
              )
            )}
          </section>
        )}

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Cartilla · {actividades.length} actividades</h2>
          {actividades.length === 0 && <p className="text-slate-600">Sin actividades: la pauta se finaliza sin checklist.</p>}
          <ol className="flex flex-col gap-1">
            {actividades.map((a, i) => (
              <li key={a.id} className="flex items-center justify-between gap-2 border-t border-slate-200 pt-1">
                <span>
                  {i + 1}. {a.variante && <Chip tono="gris">Solo vuelta {a.variante}</Chip>} {a.codigo ? `${a.codigo} · ` : ""}
                  <span className="whitespace-pre-line">{a.descripcion}</span>{" "}
                  <span className="text-sm text-slate-600">
                    ·{" "}
                    {a.operador
                      ? `Operador${a.especialidadId ? ` / ${listaEsp.find((e) => e.id === a.especialidadId)?.nombre}` : ""}`
                      : (listaEsp.find((e) => e.id === (a.especialidadId ?? p.especialidadId))?.nombre ?? p.especialidad)}
                    {[a.zona, a.subsistema, a.componente].filter(Boolean).length > 0 ? ` · ${[a.zona, a.subsistema, a.componente].filter(Boolean).join(" › ")}` : ""}
                    {a.detencion ? ` · detención: ${a.detencion === "SI" ? "sí" : a.detencion === "NO" ? "no" : "parcial"}` : ""}
                    {a.minutos !== null ? ` · ${a.minutos} min` : ""}
                  </span>
                </span>
                <form action={accionQuitarActividad}>
                  <input type="hidden" name="pautaId" value={id} />
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" aria-label={`Quitar ${a.descripcion}`} className="h-11 rounded-lg px-3 text-sm font-semibold text-red-800">
                    Quitar
                  </button>
                </form>
              </li>
            ))}
          </ol>
          <form action={accionAgregarActividad} className="flex flex-wrap gap-2">
            <input type="hidden" name="pautaId" value={id} />
            <input name="descripcion" required aria-label="Nueva actividad" placeholder="Nueva actividad" className={`${campo} max-w-md`} />
            <select name="grupo" aria-label="Quién la hace" defaultValue="" className={`${campo} max-w-56`}>
              <option value="">{p.especialidad} (responsable)</option>
              <option value="OPERADOR">Operador</option>
              {listaEsp
                .filter((e) => e.id !== p.especialidadId)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
            </select>
            <select name="variante" aria-label="En qué vuelta va" defaultValue="" className={`${campo} max-w-48`}>
              <option value="">En todas las vueltas</option>
              <option value="A">Solo vuelta A</option>
              <option value="B">Solo vuelta B</option>
            </select>
            <button type="submit" className={botonPrimario}>
              Agregar actividad
            </button>
          </form>
          <p className="text-sm text-slate-600">
            Una sola cartilla reúne las actividades de todos: al liberarse, cada grupo ve y marca solo las suyas, y la
            cartilla se finaliza cuando todos terminan. Los cambios valen desde la próxima liberación.
          </p>
          <p className="text-sm text-slate-600">
            Si la detención no alcanza para toda la cartilla, se divide en dos vueltas: una vez se hacen las tareas A y
            a la siguiente las B. Las tareas «en todas las vueltas» se hacen siempre. Si una vuelta queda incumplida,
            se repite la misma.
          </p>
        </section>

        <details className={tarjeta} open={Boolean(error)}>
          <summary className="cursor-pointer text-lg font-semibold text-marca">Editar pauta</summary>
          <form action={accionActualizarPauta} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={id} />
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Nombre
              <input name="nombre" required defaultValue={p.nombre} className={campo} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Intervalo en {esGiros ? p.unidad : "días"}
              <input name="intervalo" required inputMode="numeric" defaultValue={p.intervalo} className={campo} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Especialidad
              <select name="especialidadId" defaultValue={p.especialidadId} className={campo}>
                {listaEsp.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Estado
              <select name="activa" defaultValue={p.activa ? "si" : "no"} className={campo}>
                <option value="si">Activa</option>
                <option value="no">Inactiva (no se libera)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Liberación propia (%)
              <input name="pctLiberacion" inputMode="numeric" defaultValue={propia?.lib ?? ""} placeholder={`General: ${generales.liberacion}`} className={campo} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Incumplida propia (%)
              <input name="pctLimite" inputMode="numeric" defaultValue={propia?.lim ?? ""} placeholder={`General: ${generales.limite}`} className={campo} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">
              Cartillas de menor intervalo de esta máquina
              <select name="incluyeInferiores" defaultValue={propia?.incluye ? "si" : "no"} className={campo}>
                <option value="si">Incluirlas: al liberarse, esta cartilla trae también sus tareas</option>
                <option value="no">No incluirlas: cada cartilla se ejecuta por separado</option>
              </select>
            </label>
            <p className="text-sm text-slate-600 sm:col-span-2">
              Deja los dos porcentajes vacíos para usar los generales. Si cambias el intervalo o los porcentajes, el
              ciclo actual se recalcula desde su misma base.
            </p>
            <button type="submit" className={`${botonPrimario} sm:col-span-2`}>
              Guardar cambios
            </button>
          </form>
        </details>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Historial de ciclos · {historial.length}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-base">
              <thead className="text-sm text-slate-600">
                <tr>
                  <th className="p-2 font-semibold">Base</th>
                  <th className="p-2 font-semibold">Objetivo</th>
                  <th className="p-2 font-semibold">Vuelta</th>
                  <th className="p-2 font-semibold">Estado</th>
                  <th className="p-2 font-semibold">Cerrada</th>
                  <th className="p-2 font-semibold">Ejecutó</th>
                  {esGiros && <th className="p-2 font-semibold">Contador real</th>}
                </tr>
              </thead>
              <tbody>
                {historial.map(({ ciclo: c, quien }) => (
                  <tr key={c.id} className="border-t border-slate-200">
                    <td className="p-2">{esGiros ? n(c.baseGiros) : fechaCorta(c.baseFecha)}</td>
                    <td className="p-2">{esGiros ? n(c.objetivoGiros) : fechaCorta(c.objetivoFecha)}</td>
                    <td className="p-2">{c.variante ?? "—"}</td>
                    <td className="p-2">
                      <Chip tono={ESTADO[c.estado].tono}>{ESTADO[c.estado].nombre}</Chip>
                    </td>
                    <td className="p-2">
                      {c.estado === "EJECUTADA" ? (
                        <Link href={`/pauta/${c.id}`} className="text-marca underline">
                          {fechaHora(c.cerradoEn)}
                        </Link>
                      ) : (
                        fechaHora(c.cerradoEn)
                      )}
                    </td>
                    <td className="p-2">{quien ?? "—"}</td>
                    {esGiros && <td className="p-2">{n(c.girosReales)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
