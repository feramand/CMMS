import { and, asc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { accionFinalizarPauta, accionMarcarActividad, accionOtDesdePauta } from "@/app/preventivo/actions";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonSecundario, campo, Chip, Dato, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import {
  actividadesCiclo,
  activos,
  ciclosPauta,
  especialidades,
  fichasTecnico,
  ordenesTrabajo,
  pautas,
  solicitudesRepuesto,
  usuarios,
} from "@/db/schema";
import { resumenCiclo } from "@/lib/consultas-pautas";
import { exigirPerfil } from "@/lib/dal";
import { rutaInicio } from "@/lib/perfiles";
import { MOTIVOS_NO_REALIZADA, type MotivoNoRealizada } from "@/lib/pautas-core";
import { duracion, fechaHora, partesEnChile } from "@/lib/tiempo";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; aviso?: string; g?: string; d?: string }> };

const AVISOS: Record<string, string> = {
  finalizada: "Pauta finalizada. El ciclo siguiente quedó programado.",
  ot: "Orden de trabajo creada. El jefe o planificador la asignará.",
  repuesto: "Solicitud de repuesto enviada a bodega.",
};

// Ejecución de una pauta: checklist, acciones derivadas y cierre. Pensada para el celular.
export default async function EjecutarPauta({ params, searchParams }: Props) {
  const usuario = await exigirPerfil("TECNICO", "OPERADOR", "JEFE_PLANIFICADOR", "ADMINISTRADOR");
  const id = Number((await params).id);
  const { error, aviso, g: filtroGrupo, d: filtroDetencion } = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const [f] = await db
    .select({ ciclo: ciclosPauta, pauta: pautas, activo: activos.nombre, giros: activos.girosAcumulados, unidad: activos.unidadContador, especialidad: especialidades.nombre })
    .from(ciclosPauta)
    .innerJoin(pautas, eq(pautas.id, ciclosPauta.pautaId))
    .innerJoin(activos, eq(activos.id, pautas.activoId))
    .innerJoin(especialidades, eq(especialidades.id, pautas.especialidadId))
    .where(eq(ciclosPauta.id, id));
  if (!f) notFound();
  const { ciclo: c, pauta } = f;
  const [hermanas, checklist, [ficha], [ejecutor], repuestos, ots, listaEsp, marcadores] = await Promise.all([
    db
      .select({ cicloId: ciclosPauta.id, nombre: pautas.nombre })
      .from(ciclosPauta)
      .innerJoin(pautas, eq(pautas.id, ciclosPauta.pautaId))
      .where(and(eq(pautas.activoId, pauta.activoId), eq(pautas.activa, true), eq(ciclosPauta.estado, "LIBERADA"), isNull(ciclosPauta.incluidoEnCicloId)))
      .orderBy(asc(pautas.nombre)),
    db.select().from(actividadesCiclo).where(eq(actividadesCiclo.cicloId, id)).orderBy(asc(actividadesCiclo.orden), asc(actividadesCiclo.id)),
    db.select({ esp: fichasTecnico.especialidadId }).from(fichasTecnico).where(eq(fichasTecnico.usuarioId, usuario.id)),
    c.ejecutadoPor ? db.select({ nombre: usuarios.nombre }).from(usuarios).where(eq(usuarios.id, c.ejecutadoPor)) : [],
    db.select().from(solicitudesRepuesto).where(eq(solicitudesRepuesto.cicloId, id)),
    db.select({ id: ordenesTrabajo.id, folio: ordenesTrabajo.folio, descripcion: ordenesTrabajo.descripcion }).from(ordenesTrabajo).where(eq(ordenesTrabajo.cicloId, id)),
    db.select({ id: especialidades.id, nombre: especialidades.nombre }).from(especialidades),
    db
      .select({ id: actividadesCiclo.id, nombre: usuarios.nombre })
      .from(actividadesCiclo)
      .innerJoin(usuarios, eq(usuarios.id, actividadesCiclo.marcadaPor))
      .where(eq(actividadesCiclo.cicloId, id)),
  ]);
  const [mayor] = c.incluidoEnCicloId
    ? await db
        .select({ cicloId: ciclosPauta.id, nombre: pautas.nombre })
        .from(ciclosPauta)
        .innerJoin(pautas, eq(pautas.id, ciclosPauta.pautaId))
        .where(and(eq(ciclosPauta.id, c.incluidoEnCicloId), eq(ciclosPauta.estado, "LIBERADA")))
    : [];
  const resumen = resumenCiclo(pauta.tipo, c, f.giros, partesEnChile(new Date()).fecha, f.unidad);
  const gestiona = usuario.perfil === "ADMINISTRADOR" || usuario.perfil === "JEFE_PLANIFICADOR";
  const esOperador = usuario.perfil === "OPERADOR";
  // Cada grupo marca solo sus actividades: los operadores las de operador, cada técnico las de su especialidad.
  const esMia = (a: (typeof checklist)[number]) => gestiona || (a.operador && esOperador) || (!esOperador && a.especialidadId !== null && a.especialidadId === ficha?.esp);
  const participa = gestiona || checklist.some(esMia) || (checklist.length === 0 && !esOperador && ficha?.esp === pauta.especialidadId);
  const puede = c.estado === "LIBERADA" && participa && !mayor;
  const hechas = checklist.filter((a) => a.estado !== "PENDIENTE").length;
  const pendientes = checklist.length - hechas;
  const nombreGrupo = (a: (typeof checklist)[number]) => {
    const esp = listaEsp.find((e) => e.id === a.especialidadId)?.nombre;
    return a.operador ? (esp ? `Operador / ${esp}` : "Operador") : (esp ?? "—");
  };
  const grupos = [...new Set(checklist.map(nombreGrupo))].sort((a, b) => Number(!a.startsWith("Operador")) - Number(!b.startsWith("Operador")) || a.localeCompare(b, "es"));
  const DETENCION = { SI: "Máquina detenida", NO: "Máquina en marcha", PARCIAL: "Detención parcial" } as const;
  const detenciones = (["SI", "PARCIAL", "NO"] as const).filter((d) => checklist.some((a) => a.detencion === d));
  // Filtros: por encargado y por detención. La pauta se cambia con la fila de botones de arriba.
  const visibles = checklist.filter(
    (a) => (!filtroGrupo || nombreGrupo(a) === filtroGrupo) && (!filtroDetencion || a.detencion === filtroDetencion),
  );
  const minutos = (lista: typeof checklist) => lista.reduce((t, a) => t + (a.minutos ?? 0), 0);
  const enlace = (cambios: { g?: string | null; d?: string | null }) => {
    const q = new URLSearchParams();
    const g = cambios.g === undefined ? filtroGrupo : cambios.g;
    const d = cambios.d === undefined ? filtroDetencion : cambios.d;
    if (g) q.set("g", g);
    if (d) q.set("d", d);
    return `/pauta/${id}${q.size ? `?${q}` : ""}`;
  };
  const boton = (activo: boolean) =>
    `flex h-11 items-center rounded-full border px-4 text-base ${activo ? "border-marca bg-marca font-semibold text-white" : "border-slate-400 bg-white text-slate-900"}`;
  const esGiros = pauta.tipo === "GIROS";
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">
              {pauta.nombre}
              {c.variante ? ` · vuelta ${c.variante}` : ""}
            </h1>
            <p className="text-slate-600">
              {f.activo} · {f.especialidad}
            </p>
          </div>
          <Link href={rutaInicio(usuario.perfil) === "/admin" ? `/admin/preventivo/${pauta.id}` : "/inicio"} className="text-marca underline">
            Volver
          </Link>
        </div>
        <AvisoError mensaje={error} />
        {aviso && AVISOS[aviso] && (
          <p role="status" className="rounded-lg bg-green-100 px-4 py-3 text-base text-green-900">
            {AVISOS[aviso]}
          </p>
        )}

        <section className={`${tarjeta} grid grid-cols-2 gap-3`}>
          <Dato etiqueta="Estado">
            {c.estado === "LIBERADA" ? (
              resumen.pasoObjetivo ? <Chip tono="rojo">Próxima a vencer</Chip> : <Chip tono="ambar">Liberada</Chip>
            ) : c.estado === "EJECUTADA" ? (
              <Chip tono="verde">Ejecutada</Chip>
            ) : c.estado === "INCUMPLIDA" ? (
              <Chip tono="rojo">Incumplida</Chip>
            ) : (
              <Chip tono="gris">Programada</Chip>
            )}
          </Dato>
          {/* El operador ve el estado y sus tareas; los intervalos son de quien planifica y ejecuta. */}
          {!esOperador && (
            <>
              <Dato etiqueta="Avance del intervalo">{resumen.avance} %</Dato>
              <Dato etiqueta="Objetivo">{resumen.objetivo}</Dato>
              <Dato etiqueta="Límite">{resumen.limite}</Dato>
            </>
          )}
          {esGiros && !esOperador && <Dato etiqueta="Contador actual">{f.giros === null ? "—" : `${f.giros.toLocaleString("es-CL")} ${f.unidad}`}</Dato>}
          {c.estado === "EJECUTADA" && (
            <>
              <Dato etiqueta="Resultado">
                {checklist.every((a) => a.estado === "HECHA")
                  ? "Realizada"
                  : checklist.some((a) => a.estado === "HECHA")
                    ? "Realizada parcial"
                    : "No realizada"}
              </Dato>
              <Dato etiqueta="Cerró">{ejecutor?.nombre ?? "—"}</Dato>
              <Dato etiqueta="Finalizada">{fechaHora(c.cerradoEn)}</Dato>
              {esGiros && <Dato etiqueta="Contador al ejecutar">{c.girosReales?.toLocaleString("es-CL") ?? "—"}</Dato>}
            </>
          )}
        </section>
        {mayor && (
          <Link href={`/pauta/${mayor.cicloId}`} className={`${tarjeta} border-blue-300 bg-blue-50 text-lg`}>
            Esta cartilla está incluida en <span className="font-semibold">{mayor.nombre}</span>, que ya está liberada. Sus
            tareas se marcan desde ahí.
          </Link>
        )}
        {c.estado === "PROGRAMADA" && <p className="text-slate-700">Esta pauta todavía no está liberada: se libera en {resumen.liberacion}.</p>}
        {c.estado === "LIBERADA" && !puede && <p className="text-slate-700">No tienes actividades en esta cartilla. Especialidad responsable: {f.especialidad}.</p>}

        {c.estado !== "PROGRAMADA" && (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-bold">
              Tareas · {hechas} de {checklist.length}
              {minutos(checklist) > 0 ? ` · ${duracion(minutos(checklist))} estimados` : ""}
            </h2>
            {checklist.length === 0 && <p className="text-slate-600">Esta pauta no tiene tareas.</p>}
            {hermanas.length > 1 && (
              <nav aria-label="Pauta" className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-sm font-semibold text-slate-600">Pauta</span>
                {hermanas.map((h) => (
                  <Link key={h.cicloId} href={`/pauta/${h.cicloId}`} aria-current={h.cicloId === id ? "page" : undefined} className={boton(h.cicloId === id)}>
                    {h.nombre.replace(/^Pauta\s+/i, "")}
                  </Link>
                ))}
              </nav>
            )}
            {grupos.length > 1 && (
              <nav aria-label="Encargado" className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-sm font-semibold text-slate-600">Encargado</span>
                <Link href={enlace({ g: null })} className={boton(!filtroGrupo)}>
                  Todos
                </Link>
                {grupos.map((g) => (
                  <Link key={g} href={enlace({ g })} aria-current={filtroGrupo === g ? "true" : undefined} className={boton(filtroGrupo === g)}>
                    {g}
                  </Link>
                ))}
              </nav>
            )}
            {detenciones.length > 1 && (
              <nav aria-label="Detención" className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-sm font-semibold text-slate-600">Detención</span>
                <Link href={enlace({ d: null })} className={boton(!filtroDetencion)}>
                  Todas
                </Link>
                {detenciones.map((d) => (
                  <Link key={d} href={enlace({ d })} aria-current={filtroDetencion === d ? "true" : undefined} className={boton(filtroDetencion === d)}>
                    {DETENCION[d]}
                  </Link>
                ))}
              </nav>
            )}
            {(filtroGrupo || filtroDetencion) && (
              <p className="text-sm text-slate-600">
                Mostrando {visibles.length} de {checklist.length} tareas
                {minutos(visibles) > 0 ? ` · ${duracion(minutos(visibles))} estimados` : ""}.
              </p>
            )}
            {visibles.map((a) => (
              <div key={a.id} className={`${tarjeta} flex flex-col gap-2`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
                  {a.codigo && <span className="font-semibold">{a.codigo}</span>}
                  <span>{[a.zona, a.subsistema, a.componente].filter(Boolean).join(" › ")}</span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="whitespace-pre-line text-lg">{a.descripcion}</span>
                  {a.estado === "HECHA" && <Chip tono="verde">Hecha</Chip>}
                  {a.estado === "NO_REALIZADA" && <Chip tono="rojo">No realizada</Chip>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Chip tono="azul">{nombreGrupo(a)}</Chip>
                  {a.pautaOrigen && <Chip tono="gris">{a.pautaOrigen}</Chip>}
                  {a.tipoTarea && <Chip tono="gris">{a.tipoTarea}</Chip>}
                  {a.detencion && <Chip tono={a.detencion === "NO" ? "verde" : "ambar"}>{DETENCION[a.detencion as keyof typeof DETENCION] ?? a.detencion}</Chip>}
                  {a.minutos !== null && <Chip tono="gris">{a.minutos} min</Chip>}
                </div>
                {a.insumos && (
                  <details>
                    <summary className="cursor-pointer py-1 text-marca">Insumos</summary>
                    <p className="text-slate-700">{a.insumos}</p>
                  </details>
                )}
                {a.estado === "NO_REALIZADA" && (
                  <span className="text-slate-700">
                    Motivo: {MOTIVOS_NO_REALIZADA[a.motivo as MotivoNoRealizada] ?? "Otro"}
                    {a.nota ? ` · ${a.nota}` : ""}
                  </span>
                )}
                {a.estado !== "PENDIENTE" && (
                  <span className="text-sm text-slate-600">
                    {marcadores.find((m) => m.id === a.id)?.nombre ?? "—"} · {fechaHora(a.marcadaEn)}
                  </span>
                )}
                {puede && esMia(a) && (
                  <form action={accionMarcarActividad} className="flex flex-col gap-2">
                    <input type="hidden" name="cicloId" value={id} />
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="vuelta" value={enlace({})} />
                    {a.estado === "PENDIENTE" ? (
                      <>
                        <button name="estado" value="HECHA" className="h-14 rounded-lg bg-green-700 text-lg font-semibold text-white">
                          Hecha
                        </button>
                        <details>
                          <summary className="cursor-pointer py-2 text-marca">No se pudo realizar</summary>
                          <div className="flex flex-col gap-2">
                            <select name="motivo" aria-label={`Motivo de ${a.codigo ?? a.descripcion}`} defaultValue="EN_PRODUCCION" className={campo}>
                              {Object.entries(MOTIVOS_NO_REALIZADA).map(([valor, nombre]) => (
                                <option key={valor} value={valor}>
                                  {nombre}
                                </option>
                              ))}
                            </select>
                            <input name="nota" aria-label="Detalle del motivo" placeholder="Detalle (obligatorio si eliges Otro)" className={campo} />
                            <button name="estado" value="NO_REALIZADA" className="h-12 rounded-lg border-2 border-slate-500 text-base font-semibold">
                              Marcar como no realizada
                            </button>
                          </div>
                        </details>
                      </>
                    ) : (
                      <button name="estado" value="PENDIENTE" className="self-start py-2 text-marca underline">
                        Deshacer
                      </button>
                    )}
                  </form>
                )}
              </div>
            ))}
          </section>
        )}

        {(repuestos.length > 0 || ots.length > 0) && (
          <section className={`${tarjeta} flex flex-col gap-1`}>
            <h2 className="text-lg font-bold">Derivado de esta pauta</h2>
            {repuestos.map((r) => (
              <span key={r.id}>
                Repuesto: {r.cantidad} × {r.descripcion} · {r.estado.toLowerCase()}
              </span>
            ))}
            {ots.map((o) => (
              <Link key={o.id} href={`/ot/${o.id}`} className="text-marca underline">
                OT {o.folio}: {o.descripcion}
              </Link>
            ))}
          </section>
        )}

        {puede && (
          <>
            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-bold">Si encontraste algo</h2>
              {!esOperador && (
                <Link href={`/repuesto?pauta=${id}`} className={`${botonSecundario} h-14 text-lg`}>
                  Solicitar repuesto
                </Link>
              )}
              <Link href={`/reportar?activo=${pauta.activoId}`} className={`${botonSecundario} h-14 text-lg`}>
                Reportar falla
              </Link>
              <details className={tarjeta} hidden={esOperador}>
                <summary className="cursor-pointer text-lg font-semibold text-marca">Dejar una orden de trabajo (reparación futura)</summary>
                <form action={accionOtDesdePauta} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="cicloId" value={id} />
                  <label className="flex flex-col gap-1 text-base font-semibold">
                    ¿Qué hay que hacer?
                    <textarea name="descripcion" required rows={2} className="rounded-lg border border-slate-400 bg-white p-3 text-lg font-normal" />
                  </label>
                  <label className="flex flex-col gap-1 text-base font-semibold">
                    Prioridad
                    <select name="prioridad" defaultValue="MEDIA" className={campo}>
                      <option value="BAJA">Baja</option>
                      <option value="MEDIA">Media</option>
                      <option value="ALTA">Alta</option>
                    </select>
                  </label>
                  <button type="submit" className="h-14 rounded-lg bg-marca text-lg font-semibold text-white">
                    Crear orden de trabajo
                  </button>
                </form>
              </details>
            </section>

            {pendientes > 0 ? (
              <p className={`${tarjeta} text-slate-700`}>
                La cartilla se finaliza cuando todos los grupos terminan su parte.{" "}
                {pendientes === 1 ? "Falta 1 actividad" : `Faltan ${pendientes} actividades`} por marcar.
              </p>
            ) : (
            <form action={accionFinalizarPauta} className={`${tarjeta} flex flex-col gap-3`}>
              <input type="hidden" name="cicloId" value={id} />
              {esGiros && !esOperador && (
                <label className="flex flex-col gap-1 text-base font-semibold">
                  Contador actual de la máquina ({f.unidad})
                  <input name="giros" inputMode="numeric" defaultValue={f.giros ?? ""} required className={`${campo} h-14 text-lg`} />
                </label>
              )}
              <label className="flex flex-col gap-1 text-base font-semibold">
                Observaciones (opcional)
                <textarea name="observaciones" rows={2} className="rounded-lg border border-slate-400 bg-white p-3 text-lg font-normal" />
              </label>
              <button type="submit" className="h-16 rounded-xl bg-green-700 text-2xl font-bold text-white">
                Finalizar pauta
              </button>
            </form>
            )}
          </>
        )}
        {c.observaciones && (
          <section className={tarjeta}>
            <Dato etiqueta="Observaciones">{c.observaciones}</Dato>
          </section>
        )}
      </main>
    </>
  );
}
