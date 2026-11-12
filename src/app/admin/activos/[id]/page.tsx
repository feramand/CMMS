import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, campo, ChipOt, ChipSat, Dato, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { activos, ordenesTrabajo, plantas, sectores, solicitudes, solicitudesRepuesto } from "@/db/schema";
import { nombreCategoria } from "@/lib/categorias";
import { listarOts, listarSolicitudes } from "@/lib/consultas";
import { exigirPerfil } from "@/lib/dal";
import { fallasRecurrentes } from "@/lib/indicadores";
import { duracion, fechaHora, minutosEntre } from "@/lib/tiempo";
import { accionAgregarSector } from "../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function FichaActivo({ params, searchParams }: Props) {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const id = Number((await params).id);
  const { error } = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const [a] = await db
    .select({ activo: activos, planta: plantas.nombre })
    .from(activos)
    .innerJoin(plantas, eq(plantas.id, activos.plantaId))
    .where(eq(activos.id, id));
  if (!a) notFound();
  const m = a.activo;
  const [listaSectores, sats, ots, repuestos] = await Promise.all([
    db.select().from(sectores).where(eq(sectores.activoId, id)).orderBy(asc(sectores.nombre)),
    listarSolicitudes(eq(solicitudes.activoId, id), 50),
    listarOts(eq(ordenesTrabajo.activoId, id), 50),
    db.select().from(solicitudesRepuesto).where(eq(solicitudesRepuesto.activoId, id)),
  ]);
  const recurrentes = fallasRecurrentes(sats);
  const v = (x: string | number | null) => x ?? "—";

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
              {m.tipo ? ` · ${m.tipo}` : ""}
            </p>
          </div>
          <Link href="/admin/activos" className="text-marca underline">
            Volver a activos
          </Link>
        </div>
        <AvisoError mensaje={error} />

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Ficha técnica</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <Dato etiqueta="ID del activo">{m.codigo}</Dato>
            <Dato etiqueta="Fabricante">{v(m.fabricante)}</Dato>
            <Dato etiqueta="Modelo">{v(m.modelo)}</Dato>
            <Dato etiqueta="Número de serie">{v(m.numeroSerie)}</Dato>
            <Dato etiqueta="Formato de trabajo">{v(m.formato)}</Dato>
            <Dato etiqueta="País de origen">{v(m.paisOrigen)}</Dato>
            <Dato etiqueta="Año de fabricación">{v(m.anioFabricacion)}</Dato>
            <Dato etiqueta="Año de llegada">{v(m.anioLlegada)}</Dato>
            <Dato etiqueta="Año de instalación">{v(m.anioInstalacion)}</Dato>
            <Dato etiqueta="Condición de llegada">
              {m.condicionLlegada === "NUEVA" ? "Nueva" : m.condicionLlegada === "USADA" ? "Usada" : "—"}
            </Dato>
            <Dato etiqueta="Garantía">{v(m.garantia)}</Dato>
            <Dato etiqueta="Código en Metrics">{v(m.codigoMetrics)}</Dato>
            <Dato etiqueta="Giros acumulados">
              {m.girosAcumulados === null ? "—" : m.girosAcumulados.toLocaleString("es-CL")}
            </Dato>
            <Dato etiqueta="Última preventiva">{v(m.ultimaPreventiva)}</Dato>
          </div>
        </section>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Sectores o componentes · {listaSectores.length}</h2>
          <p className="text-slate-700">{listaSectores.map((s) => s.nombre).join(" · ") || "Sin sectores cargados."}</p>
          <form action={accionAgregarSector} className="flex flex-wrap gap-2">
            <input type="hidden" name="activoId" value={id} />
            <input name="nombre" required aria-label="Nuevo sector" placeholder="Nuevo sector" className={`${campo} max-w-xs`} />
            <button type="submit" className={botonPrimario}>
              Agregar sector
            </button>
          </form>
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
                    <th className="p-2 font-semibold">Sector</th>
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
