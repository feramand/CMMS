import { and, eq, exists, gte, ilike, inArray, lt, or, type SQL } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Encabezado } from "@/componentes/encabezado";
import { botonPrimario, campo, ChipOt, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { activos, apoyos, ordenesTrabajo } from "@/db/schema";
import { listarOts } from "@/lib/consultas";
import { exigirSesion } from "@/lib/dal";
import { DIAS_EDICION_INFORME, limiteEdicionInforme, puedeEditarInforme } from "@/lib/ot-core";
import { rutaInicio } from "@/lib/perfiles";
import { fechaHora } from "@/lib/tiempo";

const TIPO = { CORRECTIVA: "Correctiva", PROGRAMADA: "Programada", PREVENTIVA: "Preventiva", MEJORA: "Mejora" };
const VER = [
  ["todas", "Todas"],
  ["abiertas", "Abiertas"],
  ["terminadas", "Terminadas"],
  ["sin-informe", "Terminadas sin informe"],
] as const;
const fechaValida = (t?: string) => (t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : "");

type Props = { searchParams: Promise<{ ver?: string; q?: string; desde?: string; hasta?: string }> };

// Todas las órdenes de trabajo de un técnico (como responsable o como apoyo), abiertas y terminadas.
// Pensada para el computador: desde aquí completa sus informes y los imprime.
export default async function MisOt({ searchParams }: Props) {
  const usuario = await exigirSesion();
  if (usuario.perfil === "JEFE_PLANIFICADOR" || usuario.perfil === "ADMINISTRADOR") redirect("/admin/ot");
  if (usuario.perfil !== "TECNICO") redirect(rutaInicio(usuario.perfil));
  const p = await searchParams;
  const ver = VER.some(([v]) => v === p.ver) ? p.ver! : "todas";
  const q = p.q?.trim() ?? "";
  const desde = fechaValida(p.desde);
  const hasta = fechaValida(p.hasta);
  const filtros: (SQL | undefined)[] = [
    or(
      eq(ordenesTrabajo.responsableId, usuario.id),
      exists(db.select({ id: apoyos.usuarioId }).from(apoyos).where(and(eq(apoyos.otId, ordenesTrabajo.id), eq(apoyos.usuarioId, usuario.id)))),
    ),
  ];
  if (ver === "abiertas") filtros.push(inArray(ordenesTrabajo.estado, ["CREADA", "ASIGNADA", "EN_CURSO", "ESPERA_REPUESTOS"]));
  if (ver === "terminadas" || ver === "sin-informe") filtros.push(eq(ordenesTrabajo.estado, "FINALIZADA"));
  if (q) {
    const patron = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    filtros.push(or(ilike(ordenesTrabajo.folio, patron), ilike(ordenesTrabajo.descripcion, patron), ilike(activos.nombre, patron)));
  }
  if (desde) filtros.push(gte(ordenesTrabajo.creadaEn, new Date(`${desde}T00:00:00-03:00`)));
  if (hasta) filtros.push(lt(ordenesTrabajo.creadaEn, new Date(new Date(`${hasta}T00:00:00-03:00`).getTime() + 24 * 60 * 60 * 1000)));
  const todas = await listarOts(and(...filtros), 500);
  const conInforme = (o: (typeof todas)[number]) => Boolean(o.rcaCausa || o.rcaSolucion || o.rcaAcciones || o.rcaObservaciones);
  const ots = ver === "sin-informe" ? todas.filter((o) => !conInforme(o)) : todas;
  const ahora = new Date();
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Mis órdenes de trabajo · {ots.length}</h1>
          <Link href="/inicio" className="text-marca underline">
            Volver al inicio
          </Link>
        </div>
        <p className="text-slate-600">
          Tus órdenes como responsable o como apoyo. El informe de una orden terminada se puede completar o corregir hasta{" "}
          {DIAS_EDICION_INFORME} días después del cierre; después solo lo edita el jefe o el administrador.
        </p>
        <form className={`${tarjeta} grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_10rem_10rem_auto]`}>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Buscar (folio, máquina o descripción)
            <input name="q" defaultValue={q} className={campo} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Mostrar
            <select name="ver" defaultValue={ver} className={campo}>
              {VER.map(([valor, nombre]) => (
                <option key={valor} value={valor}>
                  {nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Creadas desde
            <input type="date" name="desde" defaultValue={desde} className={campo} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Hasta
            <input type="date" name="hasta" defaultValue={hasta} className={campo} />
          </label>
          <button className={botonPrimario}>Filtrar</button>
        </form>
        {ots.length === 0 ? (
          <p className="text-slate-600">No hay órdenes de trabajo con ese filtro.</p>
        ) : (
          <div className={`${tarjeta} overflow-x-auto p-0`}>
            <table className="w-full min-w-[880px] text-left text-base">
              <thead className="text-sm text-slate-600">
                <tr>
                  <th className="p-3 font-semibold">Folio</th>
                  <th className="p-3 font-semibold">Máquina</th>
                  <th className="p-3 font-semibold">Trabajo</th>
                  <th className="p-3 font-semibold">Tipo</th>
                  <th className="p-3 font-semibold">Estado</th>
                  <th className="p-3 font-semibold">Término</th>
                  <th className="p-3 font-semibold">Informe</th>
                  <th className="p-3 font-semibold">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ots.map((o) => {
                  const limite = limiteEdicionInforme(o);
                  const edita = puedeEditarInforme(usuario, o, ahora);
                  return (
                    <tr key={o.id} className="border-t border-slate-200 align-top">
                      <td className="p-3 font-semibold">
                        <Link href={`/ot/${o.id}`} className="text-marca underline">
                          {o.folio}
                        </Link>
                      </td>
                      <td className="p-3">{o.activo}</td>
                      <td className="p-3">
                        {o.descripcion}
                        {o.responsableId !== usuario.id && <span className="block text-sm text-slate-600">Participaste como apoyo</span>}
                      </td>
                      <td className="p-3">{TIPO[o.tipo]}</td>
                      <td className="p-3">
                        <ChipOt estado={o.estado} />
                      </td>
                      <td className="p-3 whitespace-nowrap">{o.terminoEn ? fechaHora(o.terminoEn) : "—"}</td>
                      <td className="p-3">
                        <span className={conInforme(o) ? "font-semibold text-green-800" : "font-semibold text-amber-800"}>
                          {conInforme(o) ? "Con informe" : "Sin informe"}
                        </span>
                        {limite && (
                          <span className="block text-sm text-slate-600">
                            {edita ? `Editable hasta el ${fechaHora(limite)}` : o.responsableId === usuario.id ? "Plazo de edición vencido" : ""}
                          </span>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <Link href={`/ot/${o.id}/informe`} className="text-marca underline">
                          Imprimir
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
