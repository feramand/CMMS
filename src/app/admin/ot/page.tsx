import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { accionCrearOt } from "@/app/trabajos/actions";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, campo, ChipOt, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { especialidades } from "@/db/schema";
import { listarActivos, listarOts, listarTecnicos } from "@/lib/consultas";
import { exigirPerfil } from "@/lib/dal";
import { fechaHora } from "@/lib/tiempo";

export default async function Ordenes({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const { error } = await searchParams;
  const [lista, listaActivos, tecnicos, esp] = await Promise.all([
    listarOts(),
    listarActivos(),
    listarTecnicos(),
    db.select().from(especialidades).where(eq(especialidades.activa, true)).orderBy(asc(especialidades.nombre)),
  ]);
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Órdenes de trabajo · {lista.length}</h1>
        <AvisoError mensaje={error} />
        <details className={tarjeta} open={Boolean(error)}>
          <summary className="cursor-pointer text-lg font-semibold text-marca">Nueva orden de trabajo</summary>
          <form action={accionCrearOt} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Máquina
              <select name="activoId" required className={campo}>
                {listaActivos.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre} · {a.planta}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Tipo de intervención
              <select name="tipo" defaultValue="PROGRAMADA" className={campo}>
                <option value="PROGRAMADA">Programada</option>
                <option value="CORRECTIVA">Correctiva</option>
                <option value="MEJORA">Mejora</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Especialidad
              <select name="especialidadId" required className={campo}>
                {esp.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Prioridad
              <select name="prioridad" defaultValue="MEDIA" className={campo}>
                <option value="ALTA">Alta</option>
                <option value="MEDIA">Media</option>
                <option value="BAJA">Baja</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Responsable (opcional)
              <select name="responsableId" defaultValue="" className={campo}>
                <option value="">Sin asignar</option>
                {tecnicos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre} · {t.especialidad}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Proveedor externo (opcional)
              <input name="proveedorExterno" className={campo} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Fecha programada (opcional)
              <input type="date" name="fechaProgramada" className={campo} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">
              Descripción del trabajo
              <textarea name="descripcion" required rows={2} className="rounded-lg border border-slate-400 bg-white p-2 text-base font-normal" />
            </label>
            <button type="submit" className={`${botonPrimario} sm:col-span-2 lg:col-span-3`}>
              Crear orden de trabajo
            </button>
          </form>
        </details>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[820px] text-left text-base">
            <thead className="text-sm text-slate-600">
              <tr>
                <th className="p-3 font-semibold">Folio</th>
                <th className="p-3 font-semibold">Máquina</th>
                <th className="p-3 font-semibold">Descripción</th>
                <th className="p-3 font-semibold">Especialidad</th>
                <th className="p-3 font-semibold">Responsable</th>
                <th className="p-3 font-semibold">Creada</th>
                <th className="p-3 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-3 text-slate-600">
                    Todavía no hay órdenes de trabajo.
                  </td>
                </tr>
              )}
              {lista.map((o) => (
                <tr key={o.id} className="border-t border-slate-200">
                  <td className="p-3 font-semibold">
                    <Link href={`/ot/${o.id}`} className="text-marca underline">
                      {o.folio}
                    </Link>
                  </td>
                  <td className="p-3">{o.activo}</td>
                  <td className="p-3">{o.descripcion}</td>
                  <td className="p-3">{o.especialidad}</td>
                  <td className="p-3">{o.responsable ?? o.proveedorExterno ?? "Sin asignar"}</td>
                  <td className="p-3">{fechaHora(o.creadaEn)}</td>
                  <td className="p-3">
                    <ChipOt estado={o.estado} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
