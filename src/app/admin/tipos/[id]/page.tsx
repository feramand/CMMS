import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArbolEditable } from "@/componentes/arbol-sistemas";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonSecundario, campo, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { activos, sistemasTipo, tiposMaquina } from "@/db/schema";
import { aplanar } from "@/lib/arbol";
import { exigirPerfil } from "@/lib/dal";
import { accionEliminarTipo, accionRenombrarTipo } from "../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function TipoDeMaquina({ params, searchParams }: Props) {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const id = Number((await params).id);
  const { error } = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const [tipo] = await db.select().from(tiposMaquina).where(eq(tiposMaquina.id, id));
  if (!tipo) notFound();
  const [nodos, maquinas] = await Promise.all([
    db.select().from(sistemasTipo).where(eq(sistemasTipo.tipoId, id)),
    db
      .select({ id: activos.id, nombre: activos.nombre, codigo: activos.codigo })
      .from(activos)
      .where(eq(activos.tipoMaquinaId, id))
      .orderBy(asc(activos.nombre)),
  ]);
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{tipo.nombre}</h1>
          <Link href="/admin/tipos" className="text-marca underline">
            Volver a tipos de máquina
          </Link>
        </div>
        <AvisoError mensaje={error} />

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Plantilla de sistemas · {nodos.length}</h2>
          <p className="text-slate-700">
            Toca un sistema para agregarle subsistemas, cambiarle el nombre o quitarlo. Los cambios valen para las
            máquinas que se creen desde ahora; en las que ya existen se suman con el botón «Aplicar plantilla» de
            cada ficha.
          </p>
          <ArbolEditable nodos={aplanar(nodos)} ambito="tipo" duenoId={id} />
        </section>

        <section className={`${tarjeta} flex flex-col gap-2`}>
          <h2 className="text-lg font-bold">Máquinas de este tipo · {maquinas.length}</h2>
          {maquinas.length === 0 && <p className="text-slate-600">Ninguna máquina usa este tipo todavía.</p>}
          {maquinas.map((m) => (
            <Link key={m.id} href={`/admin/activos/${m.id}`} className="text-marca underline">
              {m.nombre} · {m.codigo}
            </Link>
          ))}
        </section>

        <details className={tarjeta}>
          <summary className="cursor-pointer text-lg font-semibold text-marca">Cambiar nombre o eliminar el tipo</summary>
          <div className="mt-3 flex flex-col gap-3">
            <form action={accionRenombrarTipo} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={id} />
              <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
                Nombre del tipo
                <input name="nombre" required maxLength={80} defaultValue={tipo.nombre} className={campo} />
              </label>
              <button type="submit" className={botonSecundario}>
                Cambiar nombre
              </button>
            </form>
            <form action={accionEliminarTipo}>
              <input type="hidden" name="id" value={id} />
              <button
                type="submit"
                disabled={maquinas.length > 0}
                className="h-12 rounded-lg border-2 border-red-700 bg-white px-4 text-base font-semibold text-red-800 disabled:opacity-50"
              >
                Eliminar este tipo y su plantilla
              </button>
              {maquinas.length > 0 && (
                <p className="mt-1 text-sm text-slate-600">No se puede eliminar mientras haya máquinas de este tipo.</p>
              )}
            </form>
          </div>
        </details>
      </main>
    </>
  );
}
