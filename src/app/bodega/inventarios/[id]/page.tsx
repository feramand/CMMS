import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SugerenciasRepuestos } from "@/componentes/bodega";
import { BotonImprimir } from "@/componentes/boton-imprimir";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, botonSecundario, campo, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { almacenes, existencias, lineasToma, repuestos, tomasInventario } from "@/db/schema";
import { operaBodega } from "@/lib/bodega-core";
import { listarExistencias } from "@/lib/consultas-bodega";
import { exigirPerfil } from "@/lib/dal";
import { cant, pesos } from "@/lib/formato";
import { fechaHora } from "@/lib/tiempo";
import { accionAnularToma, accionGuardarConteo } from "../../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; aviso?: string }> };

export default async function Inventario({ params, searchParams }: Props) {
  const usuario = await exigirPerfil("BODEGUERO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "ABASTECIMIENTO");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const { error, aviso } = await searchParams;
  const [t] = await db
    .select({ toma: tomasInventario, almacen: almacenes.nombre })
    .from(tomasInventario)
    .innerJoin(almacenes, eq(almacenes.id, tomasInventario.almacenId))
    .where(eq(tomasInventario.id, id));
  if (!t) notFound();
  const abierta = t.toma.estado === "ABIERTA";
  const opera = operaBodega(usuario) && abierta;
  const [lineas, ubicaciones, catalogo] = await Promise.all([
    db
      .select({ repuestoId: repuestos.id, codigo: repuestos.codigo, descripcion: repuestos.descripcion, unidad: repuestos.unidad, costo: repuestos.costoMedio, sistema: lineasToma.sistema, contada: lineasToma.contada })
      .from(lineasToma)
      .innerJoin(repuestos, eq(repuestos.id, lineasToma.repuestoId))
      .where(eq(lineasToma.tomaId, id))
      .orderBy(asc(repuestos.codigo)),
    db.select().from(existencias).where(eq(existencias.almacenId, t.toma.almacenId)),
    opera ? listarExistencias() : [],
  ]);
  const ubicacion = (repuestoId: number) => ubicaciones.find((u) => u.repuestoId === repuestoId)?.ubicacion ?? "";
  const contadas = lineas.filter((l) => l.contada !== null);
  const conDiferencia = contadas.filter((l) => l.contada !== l.sistema);
  const valorDiferencia = conDiferencia.reduce((s, l) => s + ((l.contada as number) - l.sistema) * l.costo, 0);
  return (
    <>
      <div className="print:hidden">
        <Encabezado usuario={usuario} />
      </div>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">
            Inventario N.º {id} · {t.almacen}
          </h1>
          <div className="flex items-center gap-3 print:hidden">
            <BotonImprimir texto="Imprimir hoja de conteo" className="text-marca underline" />
            <Link href="/bodega/inventarios" className="text-marca underline">
              Volver
            </Link>
          </div>
        </div>
        <p className="text-slate-700">
          Abierto {fechaHora(t.toma.creadaEn)}
          {t.toma.estado === "CERRADA" ? ` · cerrado ${fechaHora(t.toma.cerradaEn)}` : t.toma.estado === "ANULADA" ? " · anulado" : " · en conteo"}
        </p>
        <AvisoError mensaje={error} />
        {aviso === "guardado" && (
          <p role="status" className="rounded-lg bg-green-100 px-4 py-3 text-green-900">
            Conteo guardado.
          </p>
        )}
        {aviso && aviso !== "guardado" && (
          <p role="status" className="rounded-lg bg-green-100 px-4 py-3 text-green-900">
            Inventario cerrado. {aviso === "0" ? "No hubo diferencias." : aviso === "1" ? "Se ajustó 1 repuesto." : `Se ajustaron ${aviso} repuestos.`}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3 print:hidden">
          <div className={tarjeta}>
            <p className="text-sm text-slate-600">Contados</p>
            <p className="text-2xl font-bold">
              {contadas.length} de {lineas.length}
            </p>
          </div>
          <div className={tarjeta}>
            <p className="text-sm text-slate-600">Con diferencia</p>
            <p className="text-2xl font-bold">{conDiferencia.length}</p>
          </div>
          <div className={tarjeta}>
            <p className="text-sm text-slate-600">Valor de las diferencias</p>
            <p className={`text-2xl font-bold ${valorDiferencia < 0 ? "text-red-700" : ""}`}>
              {valorDiferencia < 0 ? "−" : ""}
              {pesos(Math.abs(valorDiferencia))}
            </p>
          </div>
        </div>
        <form action={accionGuardarConteo} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={id} />
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-base">
              <thead className="bg-slate-100 text-sm text-slate-700">
                <tr>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2">Ubicación</th>
                  <th className="px-3 py-2 text-right">Sistema</th>
                  <th className="px-3 py-2 text-right">Contado</th>
                  <th className="px-3 py-2 text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => {
                  const dif = l.contada === null ? null : Math.round((l.contada - l.sistema) * 100) / 100;
                  return (
                    <tr key={l.repuestoId} className="border-t border-slate-200">
                      <td className="px-3 py-2 font-semibold">{l.codigo}</td>
                      <td className="px-3 py-2">{l.descripcion}</td>
                      <td className="px-3 py-2 text-sm">{ubicacion(l.repuestoId)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {cant(l.sistema)} <span className="text-xs text-slate-500">{l.unidad}</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {opera ? (
                          <input
                            name={`c_${l.repuestoId}`}
                            inputMode="decimal"
                            defaultValue={l.contada === null ? "" : String(l.contada).replace(".", ",")}
                            aria-label={`Contado de ${l.codigo}`}
                            className="h-11 w-28 rounded-lg border border-slate-400 px-2 text-right print:border-slate-300"
                          />
                        ) : l.contada === null ? (
                          "—"
                        ) : (
                          cant(l.contada)
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${dif ? (dif < 0 ? "text-red-700" : "text-green-700") : ""}`}>
                        {dif === null ? "" : dif === 0 ? "0" : `${dif > 0 ? "+" : "−"}${cant(Math.abs(dif))}`}
                      </td>
                    </tr>
                  );
                })}
                {lineas.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-600">
                      El sistema no registra repuestos en este almacén. Agrega abajo lo que encuentres.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {opera && (
            <>
              <section className={`${tarjeta} grid items-end gap-3 sm:grid-cols-[1fr_auto] print:hidden`}>
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Agregar un repuesto que no está en la lista
                  <input name="repuesto" list="catalogo" autoComplete="off" placeholder="Código o descripción" className={campo} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Contado
                  <input name="contadaNueva" inputMode="decimal" className={`${campo} sm:w-32`} />
                </label>
                <SugerenciasRepuestos id="catalogo" repuestos={catalogo} />
              </section>
              <div className="grid gap-3 sm:grid-cols-2 print:hidden">
                <button type="submit" className={botonSecundario}>
                  Guardar conteo y seguir
                </button>
                <button type="submit" name="cerrar" value="si" className={botonPrimario}>
                  Guardar y cerrar inventario (ajusta diferencias)
                </button>
              </div>
            </>
          )}
        </form>
        {opera && (
          <form action={accionAnularToma} className="print:hidden">
            <input type="hidden" name="id" value={id} />
            <button type="submit" className="text-red-700 underline">
              Anular este inventario sin ajustar nada
            </button>
          </form>
        )}
      </main>
    </>
  );
}
