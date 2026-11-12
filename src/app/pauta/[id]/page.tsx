import { asc, eq } from "drizzle-orm";
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
import { fechaHora, partesEnChile } from "@/lib/tiempo";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; aviso?: string }> };

const AVISOS: Record<string, string> = {
  finalizada: "Pauta finalizada. El ciclo siguiente quedó programado.",
  ot: "Orden de trabajo creada. El jefe o planificador la asignará.",
  repuesto: "Solicitud de repuesto enviada a bodega.",
};

// Ejecución de una pauta: checklist, acciones derivadas y cierre. Pensada para el celular.
export default async function EjecutarPauta({ params, searchParams }: Props) {
  const usuario = await exigirPerfil("TECNICO", "JEFE_PLANIFICADOR", "ADMINISTRADOR");
  const id = Number((await params).id);
  const { error, aviso } = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const [f] = await db
    .select({ ciclo: ciclosPauta, pauta: pautas, activo: activos.nombre, giros: activos.girosAcumulados, especialidad: especialidades.nombre })
    .from(ciclosPauta)
    .innerJoin(pautas, eq(pautas.id, ciclosPauta.pautaId))
    .innerJoin(activos, eq(activos.id, pautas.activoId))
    .innerJoin(especialidades, eq(especialidades.id, pautas.especialidadId))
    .where(eq(ciclosPauta.id, id));
  if (!f) notFound();
  const { ciclo: c, pauta } = f;
  const [checklist, [ficha], [ejecutor], repuestos, ots] = await Promise.all([
    db.select().from(actividadesCiclo).where(eq(actividadesCiclo.cicloId, id)).orderBy(asc(actividadesCiclo.orden), asc(actividadesCiclo.id)),
    db.select({ esp: fichasTecnico.especialidadId }).from(fichasTecnico).where(eq(fichasTecnico.usuarioId, usuario.id)),
    c.ejecutadoPor ? db.select({ nombre: usuarios.nombre }).from(usuarios).where(eq(usuarios.id, c.ejecutadoPor)) : [],
    db.select().from(solicitudesRepuesto).where(eq(solicitudesRepuesto.cicloId, id)),
    db.select({ id: ordenesTrabajo.id, folio: ordenesTrabajo.folio, descripcion: ordenesTrabajo.descripcion }).from(ordenesTrabajo).where(eq(ordenesTrabajo.cicloId, id)),
  ]);
  const resumen = resumenCiclo(pauta.tipo, c, f.giros, partesEnChile(new Date()).fecha);
  const puede = c.estado === "LIBERADA" && (usuario.perfil !== "TECNICO" || ficha?.esp === pauta.especialidadId);
  const hechas = checklist.filter((a) => a.estado !== "PENDIENTE").length;
  const esGiros = pauta.tipo === "GIROS";
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">{pauta.nombre}</h1>
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
          <Dato etiqueta="Avance del intervalo">{resumen.avance} %</Dato>
          <Dato etiqueta="Objetivo">{resumen.objetivo}</Dato>
          <Dato etiqueta="Límite">{resumen.limite}</Dato>
          {esGiros && <Dato etiqueta="Giros actuales">{f.giros === null ? "—" : f.giros.toLocaleString("es-CL")}</Dato>}
          {c.estado === "EJECUTADA" && (
            <>
              <Dato etiqueta="Ejecutó">{ejecutor?.nombre ?? "—"}</Dato>
              <Dato etiqueta="Finalizada">{fechaHora(c.cerradoEn)}</Dato>
              {esGiros && <Dato etiqueta="Giros al ejecutar">{c.girosReales?.toLocaleString("es-CL") ?? "—"}</Dato>}
            </>
          )}
        </section>
        {c.estado === "PROGRAMADA" && <p className="text-slate-700">Esta pauta todavía no está liberada: se libera en {resumen.liberacion}.</p>}
        {c.estado === "LIBERADA" && !puede && <p className="text-slate-700">Esta pauta la ejecuta la especialidad {f.especialidad}.</p>}

        {c.estado !== "PROGRAMADA" && (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-bold">
              Checklist · {hechas} de {checklist.length}
            </h2>
            {checklist.length === 0 && <p className="text-slate-600">Esta pauta no tiene actividades.</p>}
            {checklist.map((a, i) => (
              <div key={a.id} className={`${tarjeta} flex flex-col gap-2`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-lg">
                    {i + 1}. {a.descripcion}
                  </span>
                  {a.estado === "HECHA" && <Chip tono="verde">Hecha</Chip>}
                  {a.estado === "NO_REALIZADA" && <Chip tono="rojo">No realizada</Chip>}
                </div>
                {a.nota && <span className="text-slate-700">Nota: {a.nota}</span>}
                {puede && (
                  <form action={accionMarcarActividad} className="flex flex-col gap-2">
                    <input type="hidden" name="cicloId" value={id} />
                    <input type="hidden" name="id" value={a.id} />
                    {a.estado === "PENDIENTE" ? (
                      <>
                        <button name="estado" value="HECHA" className="h-14 rounded-lg bg-green-700 text-lg font-semibold text-white">
                          Hecha
                        </button>
                        <details>
                          <summary className="cursor-pointer py-2 text-marca">No se pudo realizar</summary>
                          <div className="flex flex-col gap-2">
                            <input name="nota" aria-label={`Motivo de ${a.descripcion}`} placeholder="¿Por qué no se realizó?" className={campo} />
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
              <Link href={`/repuesto?pauta=${id}`} className={`${botonSecundario} h-14 text-lg`}>
                Solicitar repuesto
              </Link>
              <Link href={`/reportar?activo=${pauta.activoId}`} className={`${botonSecundario} h-14 text-lg`}>
                Reportar falla
              </Link>
              <details className={tarjeta}>
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

            <form action={accionFinalizarPauta} className={`${tarjeta} flex flex-col gap-3`}>
              <input type="hidden" name="cicloId" value={id} />
              {esGiros && (
                <label className="flex flex-col gap-1 text-base font-semibold">
                  Giros actuales de la máquina
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
