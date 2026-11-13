import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MenuBodega } from "@/componentes/bodega";
import { Encabezado } from "@/componentes/encabezado";
import { FormularioRepuesto } from "@/componentes/formulario-repuesto";
import { AvisoError, botonPrimario, campo, Chip, Dato, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { activos, movimientos, repuestosActivo } from "@/db/schema";
import { operaBodega, TIPOS_MOVIMIENTO } from "@/lib/bodega-core";
import { listarActivosVigentes, listarTecnicos } from "@/lib/consultas";
import { listarAlmacenes, listarExistencias, listarMovimientos } from "@/lib/consultas-bodega";
import { listarCuentas } from "@/lib/consultas-compras";
import { exigirPerfil } from "@/lib/dal";
import { cant, pesos } from "@/lib/formato";
import { fechaHora } from "@/lib/tiempo";
import { accionEditarRepuesto, accionMovimiento } from "../../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; aviso?: string }> };

export default async function FichaRepuesto({ params, searchParams }: Props) {
  const usuario = await exigirPerfil("BODEGUERO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "ABASTECIMIENTO");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const { error, aviso } = await searchParams;
  const [[r], almacenes, movs, asociadas, maquinas, tecnicos, cuentas] = await Promise.all([
    listarExistencias({ ids: [id], inactivos: true }),
    listarAlmacenes(),
    listarMovimientos(eq(movimientos.repuestoId, id), 100),
    db
      .select({ id: activos.id, nombre: activos.nombre })
      .from(repuestosActivo)
      .innerJoin(activos, eq(activos.id, repuestosActivo.activoId))
      .where(eq(repuestosActivo.repuestoId, id)),
    listarActivosVigentes(),
    listarTecnicos(),
    listarCuentas(),
  ]);
  if (!r) notFound();
  const opera = operaBodega(usuario);
  const editaCatalogo = opera || usuario.perfil === "ABASTECIMIENTO";
  const bajo = r.stockMinimo > 0 && r.total < r.stockMinimo;
  const selectAlmacen = (nombre: string, etiqueta: string) => (
    <label className="flex flex-col gap-1 text-sm font-semibold">
      {etiqueta}
      <select name={nombre} required className={campo}>
        {almacenes.map((a) => (
          <option key={a.id} value={a.id}>
            {a.nombre} (hay {cant(r.porAlmacen[a.id]?.cantidad ?? 0)})
          </option>
        ))}
      </select>
    </label>
  );
  const cantidad = (etiqueta = `Cantidad (${r.unidad})`) => (
    <label className="flex flex-col gap-1 text-sm font-semibold">
      {etiqueta}
      <input name="cantidad" required inputMode="decimal" className={campo} />
    </label>
  );
  const nota = (etiqueta = "Nota (opcional)", obligatoria = false) => (
    <label className="flex flex-col gap-1 text-sm font-semibold">
      {etiqueta}
      <input name="nota" required={obligatoria} className={campo} />
    </label>
  );
  const folio = (
    <label className="flex flex-col gap-1 text-sm font-semibold">
      Folio de la OT (opcional)
      <input name="folio" inputMode="numeric" placeholder="260001" className={campo} />
    </label>
  );
  const formulario = (tipo: string, titulo: string, ayuda: string, campos: React.ReactNode) => (
    <details className={tarjeta}>
      <summary className="cursor-pointer text-lg font-bold">{titulo}</summary>
      <p className="mt-2 text-sm text-slate-600">{ayuda}</p>
      <form action={accionMovimiento} className="mt-3 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="repuestoId" value={r.id} />
        <input type="hidden" name="tipo" value={tipo} />
        {campos}
        <button type="submit" className={`${botonPrimario} sm:col-span-2`}>
          Registrar
        </button>
      </form>
    </details>
  );
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">{r.codigo}</h1>
            {!r.activo && <Chip tono="gris">Dado de baja</Chip>}
            {bajo && <Chip tono="rojo">Bajo el stock mínimo</Chip>}
          </div>
          <Link href="/bodega" className="text-marca underline">
            Volver a existencias
          </Link>
        </div>
        <MenuBodega actual="" opera={opera} />
        <AvisoError mensaje={error} />
        {aviso === "ok" && (
          <p role="status" className="rounded-lg bg-green-100 px-4 py-3 text-green-900">
            Movimiento registrado.
          </p>
        )}
        <section className={`${tarjeta} flex flex-col gap-4`}>
          <p className="text-xl font-semibold">{r.descripcion}</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Dato etiqueta="Código de parte del fabricante">{r.codigoFabricante ?? "—"}</Dato>
            <Dato etiqueta="Marca">{r.marca ?? "—"}</Dato>
            <Dato etiqueta="Cuenta contable">{cuentas.find((c) => c.id === r.cuentaId)?.codigo ?? "—"}</Dato>
            <Dato etiqueta="Familia">{r.familia ?? "—"}</Dato>
            <Dato etiqueta="Total en existencia">
              {cant(r.total)} {r.unidad}
            </Dato>
            <Dato etiqueta="Stock mínimo / máximo">
              {r.stockMinimo ? cant(r.stockMinimo) : "—"} / {r.stockMaximo === null ? "—" : cant(r.stockMaximo)}
            </Dato>
            <Dato etiqueta="Costo medio">{pesos(r.costoMedio)}</Dato>
            <Dato etiqueta="Valor en existencia">{pesos(r.total * r.costoMedio)}</Dato>
            <div className="col-span-2">
              <Dato etiqueta="Máquinas en las que se usa">{asociadas.length ? asociadas.map((a) => a.nombre).join(", ") : "—"}</Dato>
            </div>
          </div>
          <table className="w-full text-left text-base">
            <thead className="text-sm text-slate-600">
              <tr>
                <th className="py-1">Almacén</th>
                <th className="py-1 text-right">Existencia</th>
                <th className="py-1 pl-4">Ubicación</th>
              </tr>
            </thead>
            <tbody>
              {almacenes.map((a) => (
                <tr key={a.id} className="border-t border-slate-200">
                  <td className="py-2">{a.nombre}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{cant(r.porAlmacen[a.id]?.cantidad ?? 0)}</td>
                  <td className="py-2 pl-4">
                    {opera ? (
                      <form action={accionMovimiento} className="flex gap-2">
                        <input type="hidden" name="repuestoId" value={r.id} />
                        <input type="hidden" name="tipo" value="UBICACION" />
                        <input type="hidden" name="almacenId" value={a.id} />
                        <input name="ubicacion" defaultValue={r.porAlmacen[a.id]?.ubicacion ?? ""} placeholder="Estante, casillero…" className="h-10 w-full rounded-lg border border-slate-400 px-2" />
                        <button type="submit" className="h-10 rounded-lg border border-marca px-3 text-sm font-semibold text-marca">
                          Guardar
                        </button>
                      </form>
                    ) : (
                      (r.porAlmacen[a.id]?.ubicacion ?? "—")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {opera && r.activo && (
          <div className="grid items-start gap-3 lg:grid-cols-2">
            {formulario(
              "ENTRADA",
              "Entrada",
              "Mercadería que llega. Con el costo, el sistema recalcula el costo medio; sin costo, entra al costo vigente.",
              <>
                {selectAlmacen("almacenId", "Almacén que recibe")}
                {cantidad()}
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Costo unitario en pesos (opcional)
                  <input name="costo" inputMode="decimal" className={campo} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Documento (guía, factura…)
                  <input name="documento" className={campo} />
                </label>
                {nota()}
              </>,
            )}
            {formulario(
              "SALIDA",
              "Entrega en mesón",
              "Entrega sin solicitud previa. Si indicas la OT, el costo se carga a esa orden.",
              <>
                {selectAlmacen("almacenId", "Sale de")}
                {cantidad()}
                {folio}
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Quién recibe (opcional)
                  <select name="recibeId" defaultValue="" className={campo}>
                    <option value="">—</option>
                    {tecnicos.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                {nota()}
              </>,
            )}
            {formulario(
              "TRASLADO",
              "Traslado",
              "Mueve existencias entre la bodega y los pañoles. No cambia el total ni el costo.",
              <>
                {selectAlmacen("almacenId", "Desde")}
                {selectAlmacen("destinoId", "Hacia")}
                {cantidad()}
                {nota()}
              </>,
            )}
            {formulario(
              "DEVOLUCION",
              "Devolución",
              "Repuesto que vuelve sin usar. Si indicas la OT, se descuenta de su costo.",
              <>
                {selectAlmacen("almacenId", "Vuelve a")}
                {cantidad()}
                {folio}
                {nota()}
              </>,
            )}
            {formulario(
              "AJUSTE",
              "Ajuste",
              "Corrige una diferencia. Escribe la cantidad que realmente hay y el motivo; queda registrada la diferencia.",
              <>
                {selectAlmacen("almacenId", "Almacén")}
                {cantidad(`Cantidad real (${r.unidad})`)}
                {nota("Motivo", true)}
              </>,
            )}
          </div>
        )}

        <section className={`${tarjeta} flex flex-col gap-2`}>
          <h2 className="text-lg font-bold">Movimientos · últimos {movs.length}</h2>
          {movs.length === 0 && <p className="text-slate-600">Sin movimientos.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-base">
              <tbody>
                {movs.map((m) => (
                  <tr key={m.id} className="border-t border-slate-200 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{fechaHora(m.fecha)}</td>
                    <td className="py-2 pr-3 font-semibold">{TIPOS_MOVIMIENTO[m.tipo]}</td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums">
                      {m.tipo === "TRASLADO" ? cant(m.cantidad) : `${m.cantidad > 0 ? "+" : "−"}${cant(Math.abs(m.cantidad))}`}
                    </td>
                    <td className="py-2 pr-3">
                      {m.almacen}
                      {m.destino ? ` → ${m.destino}` : ""}
                    </td>
                    <td className="py-2 pr-3 text-sm text-slate-700">
                      {[m.folio ? `OT ${m.folio}` : null, m.activo, m.recibe ? `recibe ${m.recibe}` : null, m.documento, m.nota, `costo ${pesos(m.costoUnitario)}`, `por ${m.usuario}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {editaCatalogo && (
          <details className={tarjeta}>
            <summary className="cursor-pointer text-lg font-bold">Editar datos del repuesto</summary>
            <div className="mt-3">
              <FormularioRepuesto accion={accionEditarRepuesto} repuesto={r} maquinas={maquinas} asociadas={asociadas.map((a) => a.id)} cuentas={cuentas} />
            </div>
          </details>
        )}
      </main>
    </>
  );
}
