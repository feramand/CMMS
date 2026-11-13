import { asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Encabezado } from "@/componentes/encabezado";
import { ArbolEditable } from "@/componentes/arbol-sistemas";
import { FichaTecnica } from "@/componentes/ficha-tecnica";
import { AvisoError, botonPrimario, botonSecundario, campo, ChipOt, ChipSat, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { activos, competencias, lecturasContador, ordenesTrabajo, pautas, plantas, sectores, solicitudes, solicitudesRepuesto, tiposMaquina, usuarios } from "@/db/schema";
import { aplanar } from "@/lib/arbol";
import { nombreCategoria } from "@/lib/categorias";
import { NIVELES } from "@/lib/competencias-core";
import { listarOts, listarSolicitudes } from "@/lib/consultas";
import { exigirPerfil } from "@/lib/dal";
import { fallasRecurrentes } from "@/lib/indicadores";
import { duracion, fechaHora, minutosEntre } from "@/lib/tiempo";
import { accionRegistrarLectura } from "@/app/preventivo/actions";
import { BarraAvance, ChipPauta } from "@/componentes/pautas";
import { intervaloTexto, listarPautas } from "@/lib/consultas-pautas";
import { accionAplicarPlantilla } from "../../tipos/actions";
import { accionActualizarActivo } from "../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function FichaActivo({ params, searchParams }: Props) {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const id = Number((await params).id);
  const { error } = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const [a] = await db
    .select({ activo: activos, planta: plantas.nombre, tipo: tiposMaquina.nombre })
    .from(activos)
    .innerJoin(plantas, eq(plantas.id, activos.plantaId))
    .leftJoin(tiposMaquina, eq(tiposMaquina.id, activos.tipoMaquinaId))
    .where(eq(activos.id, id));
  if (!a) notFound();
  const m = a.activo;
  const competentes = await db
    .select({ nombre: usuarios.nombre, nivel: competencias.nivel })
    .from(competencias)
    .innerJoin(usuarios, eq(usuarios.id, competencias.usuarioId))
    .where(eq(competencias.activoId, id))
    .orderBy(asc(usuarios.nombre));
  const [listaPautas, lecturas, listaPlantas, listaTipos, todosLosSistemas, sats, ots, repuestos] = await Promise.all([
    listarPautas(eq(pautas.activoId, id)),
    db.select().from(lecturasContador).where(eq(lecturasContador.activoId, id)).orderBy(desc(lecturasContador.leidaEn), desc(lecturasContador.id)).limit(5),
    db.select().from(plantas).orderBy(asc(plantas.nombre)),
    db.select().from(tiposMaquina).orderBy(asc(tiposMaquina.nombre)),
    db.select().from(sectores).where(eq(sectores.activoId, id)),
    listarSolicitudes(eq(solicitudes.activoId, id), 50),
    listarOts(eq(ordenesTrabajo.activoId, id), 50),
    db.select().from(solicitudesRepuesto).where(eq(solicitudesRepuesto.activoId, id)),
  ]);
  const recurrentes = fallasRecurrentes(sats);
  const sistemas = aplanar(todosLosSistemas.filter((n) => n.activo));

  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{m.nombre}</h1>
            <p className="text-slate-600">
              {a.planta}
              {m.seccion ? ` · ${m.seccion}` : ""}
              {a.tipo ? ` · ${a.tipo}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/admin/activos/${id}/qr`} className={botonSecundario}>
              Código QR
            </Link>
            <Link href="/admin/activos" className="text-marca underline">
              Volver a activos
            </Link>
          </div>
        </div>
        <AvisoError mensaje={error} />

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Ficha técnica</h2>
          <FichaTecnica m={m} tipo={a.tipo} />
          <p className="text-sm text-slate-600">
            «Último MP» (fecha y cartilla) se llena solo al finalizar una pauta preventiva.
          </p>
        </section>

        <details className={tarjeta} open={Boolean(error)}>
          <summary className="cursor-pointer text-lg font-semibold text-marca">Editar ficha y estado del equipo</summary>
          <form action={accionActualizarActivo} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input type="hidden" name="id" value={id} />
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Estado del equipo
              <select name="estadoOperativo" defaultValue={m.estadoOperativo} className={campo}>
                <option value="ACTIVO">Activo</option>
                <option value="FUERA_DE_SERVICIO">Fuera de servicio</option>
                <option value="DESINSTALADO">Desinstalado</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Planta
              <select name="plantaId" defaultValue={m.plantaId} className={campo}>
                {listaPlantas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Tipo de máquina
              <select name="tipoMaquinaId" defaultValue={m.tipoMaquinaId ?? ""} className={campo}>
                <option value="">Sin indicar</option>
                {listaTipos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Condición de llegada
              <select name="condicionLlegada" defaultValue={m.condicionLlegada ?? ""} className={campo}>
                <option value="">Sin indicar</option>
                <option value="NUEVA">Nueva</option>
                <option value="USADA">Usada</option>
              </select>
            </label>
            {(
              [
                ["nombre", "Nombre de la máquina", m.nombre],
                ["fabricante", "Fabricante", m.fabricante],
                ["modelo", "Modelo", m.modelo],
                ["numeroSerie", "Número de serie", m.numeroSerie],
                ["formato", "Formato de trabajo", m.formato],
                ["paisOrigen", "País de origen", m.paisOrigen],
                ["anioFabricacion", "Año de fabricación", m.anioFabricacion],
                ["anioLlegada", "Año de llegada", m.anioLlegada],
                ["anioInstalacion", "Año de instalación", m.anioInstalacion],
                ["seccion", "Ubicación o sección", m.seccion],
                ["garantia", "Garantía", m.garantia],
                ["codigoMetrics", "Código en Metrics", m.codigoMetrics],
                ["unidadContador", "Qué cuenta el contador (giros, libros…)", m.unidadContador],
              ] as const
            ).map(([nombre, etiqueta, valor]) => (
              <label key={nombre} className="flex flex-col gap-1 text-sm font-semibold">
                {etiqueta}
                <input name={nombre} defaultValue={valor ?? ""} required={nombre === "nombre"} className={campo} />
              </label>
            ))}
            <button type="submit" className={`${botonPrimario} sm:col-span-2 lg:col-span-3`}>
              Guardar cambios
            </button>
          </form>
        </details>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Árbol de sistemas · {sistemas.length}</h2>
            {m.tipoMaquinaId !== null && (
              <form action={accionAplicarPlantilla}>
                <input type="hidden" name="activoId" value={id} />
                <button type="submit" className={botonSecundario}>
                  Aplicar plantilla del tipo
                </button>
              </form>
            )}
          </div>
          <p className="text-slate-700">
            {m.tipoMaquinaId !== null ? (
              <>
                Parte de la plantilla de{" "}
                <Link href={`/admin/tipos/${m.tipoMaquinaId}`} className="text-marca underline">
                  {a.tipo}
                </Link>{" "}
                y se ajusta aquí solo para esta máquina. «Aplicar plantilla» agrega lo que falte, sin borrar nada.
              </>
            ) : (
              "Esta máquina no tiene tipo: elígelo en «Editar ficha» para traer su plantilla, o arma el árbol aquí."
            )}{" "}
            Toca un sistema para agregarle subsistemas, cambiarle el nombre o quitarlo. Los que tienen historial
            no se borran: dejan de aparecer en las listas.
          </p>
          <ArbolEditable nodos={sistemas} ambito="activo" duenoId={id} />
        </section>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Pautas preventivas · {listaPautas.length}</h2>
            <Link href="/admin/preventivo" className="text-marca underline">
              Crear o planificar pautas
            </Link>
          </div>
          {listaPautas.length === 0 && <p className="text-slate-600">Esta máquina no tiene pautas.</p>}
          {listaPautas.map((p) => (
            <div key={p.id} className="flex flex-col gap-1 border-t border-slate-200 pt-2">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/admin/preventivo/${p.id}`} className="text-marca underline">
                  {p.nombre} · {intervaloTexto(p.tipo, p.intervalo, p.unidad)}
                </Link>
                <ChipPauta p={p} />
              </div>
              {p.ciclo && p.resumen && p.activa && <BarraAvance avance={p.resumen.avance} liberada={p.ciclo.estado === "LIBERADA"} />}
            </div>
          ))}
        </section>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Contador de {m.unidadContador}</h2>
          <form action={accionRegistrarLectura} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="activoId" value={id} />
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Lectura manual del contador ({m.unidadContador} acumulados)
              <input name="giros" inputMode="numeric" required placeholder={m.girosAcumulados?.toLocaleString("es-CL") ?? "0"} className={`${campo} max-w-xs`} />
            </label>
            <button type="submit" className={botonPrimario}>
              Registrar lectura
            </button>
          </form>
          <p className="text-sm text-slate-600">
            Con Metrics conectado las lecturas llegan solas. El contador solo avanza: no se acepta una lectura menor que la última.
          </p>
          {lecturas.length > 0 && (
            <ul className="flex flex-col gap-1 text-slate-700">
              {lecturas.map((l) => (
                <li key={l.id}>
                  {fechaHora(l.leidaEn)} · {l.giros.toLocaleString("es-CL")} {m.unidadContador} · {l.origen === "METRICS" ? "Metrics" : "manual"}
                </li>
              ))}
            </ul>
          )}
        </section>

        {recurrentes.length > 0 && (
          <section className={`${tarjeta} border-amber-400 bg-amber-50`}>
            <h2 className="text-lg font-bold">Fallas recurrentes (últimos 30 días)</h2>
            <p>{recurrentes.map((r) => `${r.sector}: ${r.veces} veces`).join(" · ")}</p>
          </section>
        )}

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Solicitudes de atención · {sats.length}</h2>
          {sats.length === 0 ? (
            <p className="text-slate-600">Sin solicitudes.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-base">
                <thead className="text-sm text-slate-600">
                  <tr>
                    <th className="p-2 font-semibold">Fecha</th>
                    <th className="p-2 font-semibold">Tipo de falla</th>
                    <th className="p-2 font-semibold">Sistema</th>
                    <th className="p-2 font-semibold">Solución</th>
                    <th className="p-2 font-semibold">Técnico</th>
                    <th className="p-2 font-semibold">Reparación</th>
                    <th className="p-2 font-semibold">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {sats.map((s) => (
                    <tr key={s.id} className="border-t border-slate-200">
                      <td className="p-2">
                        <Link href={`/sat/${s.id}`} className="text-marca underline">
                          {fechaHora(s.creadaEn)}
                        </Link>
                      </td>
                      <td className="p-2">{nombreCategoria(s.origenReal ?? s.categoria)}</td>
                      <td className="p-2">{s.sector ?? "—"}</td>
                      <td className="p-2">{s.solucion ?? (s.folioOt ? `OT ${s.folioOt}` : "—")}</td>
                      <td className="p-2">{s.responsable ?? "—"}</td>
                      <td className="p-2">{duracion(minutosEntre(s.tomadaEn, s.cerradaEn))}</td>
                      <td className="p-2">
                        <ChipSat estado={s.estado} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Órdenes de trabajo · {ots.length}</h2>
          {ots.length === 0 ? (
            <p className="text-slate-600">Sin órdenes de trabajo.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {ots.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
                  <Link href={`/ot/${o.id}`} className="text-marca underline">
                    OT {o.folio}
                  </Link>
                  <span className="flex-1">{o.descripcion}</span>
                  {o.rcaCausa && <span className="text-sm text-slate-600">Causa: {o.rcaCausa}</span>}
                  <ChipOt estado={o.estado} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${tarjeta} flex flex-col gap-2`}>
          <h2 className="text-lg font-bold">Técnicos con competencia en esta máquina · {competentes.length}</h2>
          {competentes.length === 0 ? (
            <p className="text-slate-600">Nadie tiene competencia registrada.</p>
          ) : (
            <p>{competentes.map((c) => `${c.nombre} (${NIVELES.find((n) => n.valor === c.nivel)?.nombre.toLowerCase()})`).join(" · ")}</p>
          )}
          <Link href="/admin/competencias" className="text-marca underline">
            Ver la matriz de competencias
          </Link>
        </section>

        <section className={`${tarjeta} flex flex-col gap-2`}>
          <h2 className="text-lg font-bold">Repuestos solicitados · {repuestos.length}</h2>
          {repuestos.length === 0 && <p className="text-slate-600">Sin repuestos solicitados.</p>}
          {repuestos.map((r) => (
            <span key={r.id}>
              {r.cantidad} × {r.descripcion}
              {r.codigoFabricante ? ` (${r.codigoFabricante})` : ""} · {r.estado.toLowerCase()} · {fechaHora(r.creadaEn)}
            </span>
          ))}
        </section>
      </main>
    </>
  );
}
