import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArbolLectura } from "@/componentes/arbol-sistemas";
import { Encabezado } from "@/componentes/encabezado";
import { FichaTecnica } from "@/componentes/ficha-tecnica";
import { ChipOt, ChipSat, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { activos, ordenesTrabajo, plantas, sectores, solicitudes, tiposMaquina } from "@/db/schema";
import { aplanar } from "@/lib/arbol";
import { nombreCategoria } from "@/lib/categorias";
import { listarOts, listarSolicitudes } from "@/lib/consultas";
import { exigirSesion } from "@/lib/dal";
import { puedeEntrarAdmin } from "@/lib/perfiles";
import { fechaHora } from "@/lib/tiempo";

// Ficha de la máquina a la que lleva su código QR. La ve cualquier persona con sesión;
// el historial de trabajos no se muestra a los operadores.
export default async function FichaPorQr({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await exigirSesion();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [a] = await db
    .select({ activo: activos, planta: plantas.nombre, tipo: tiposMaquina.nombre })
    .from(activos)
    .innerJoin(plantas, eq(plantas.id, activos.plantaId))
    .leftJoin(tiposMaquina, eq(tiposMaquina.id, activos.tipoMaquinaId))
    .where(eq(activos.id, id));
  if (!a) notFound();
  const m = a.activo;
  const veHistorial = usuario.perfil !== "OPERADOR";
  const puedeReportar = usuario.perfil !== "BODEGUERO" && usuario.perfil !== "ABASTECIMIENTO";
  const gestiona = usuario.perfil === "ADMINISTRADOR" || usuario.perfil === "JEFE_PLANIFICADOR";
  const [nodos, sats, ots] = await Promise.all([
    db.select().from(sectores).where(eq(sectores.activoId, id)),
    veHistorial ? listarSolicitudes(eq(solicitudes.activoId, id), 20) : [],
    veHistorial ? listarOts(eq(ordenesTrabajo.activoId, id), 20) : [],
  ]);
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
        <div>
          <h1 className="text-2xl font-bold">{m.nombre}</h1>
          <p className="text-slate-600">
            {a.planta}
            {m.seccion ? ` · ${m.seccion}` : ""}
          </p>
        </div>
        {puedeReportar && m.activo && (
          <Link
            href={`/reportar?activo=${id}`}
            className="flex h-16 items-center justify-center rounded-xl bg-amber-700 text-xl font-bold text-white"
          >
            Reportar falla en esta máquina
          </Link>
        )}
        {gestiona && (
          <Link href={`/admin/activos/${id}`} className="text-marca underline">
            Abrir la ficha completa para editar
          </Link>
        )}

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Ficha técnica</h2>
          <FichaTecnica m={m} tipo={a.tipo} />
        </section>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Sistemas de la máquina</h2>
          <ArbolLectura nodos={aplanar(nodos.filter((n) => n.activo))} />
        </section>

        {veHistorial && (
          <>
            <section className={`${tarjeta} flex flex-col gap-2`}>
              <h2 className="text-lg font-bold">Últimas solicitudes de atención · {sats.length}</h2>
              {sats.length === 0 && <p className="text-slate-600">Sin solicitudes.</p>}
              {sats.map((s) => (
                <Link key={s.id} href={`/sat/${s.id}`} className="flex flex-col gap-1 border-t border-slate-200 pt-2">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {fechaHora(s.creadaEn)} · {nombreCategoria(s.origenReal ?? s.categoria)}
                    </span>
                    <ChipSat estado={s.estado} />
                  </span>
                  <span className="text-slate-700">
                    {s.sector ? `${s.sector}: ` : ""}
                    {s.solucion ?? (s.folioOt ? `Pasó a la OT ${s.folioOt}` : "Sin solución registrada todavía")}
                    {s.responsable ? ` · ${s.responsable}` : ""}
                  </span>
                </Link>
              ))}
            </section>

            <section className={`${tarjeta} flex flex-col gap-2`}>
              <h2 className="text-lg font-bold">Últimas órdenes de trabajo · {ots.length}</h2>
              {ots.length === 0 && <p className="text-slate-600">Sin órdenes de trabajo.</p>}
              {ots.map((o) => (
                <Link key={o.id} href={`/ot/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
                  <span className="font-semibold">OT {o.folio}</span>
                  <span className="flex-1 text-slate-700">{o.descripcion}</span>
                  <ChipOt estado={o.estado} />
                </Link>
              ))}
            </section>
          </>
        )}
        {!puedeEntrarAdmin(usuario.perfil) && (
          <Link href="/inicio" className="text-center text-marca underline">
            Ir a mi inicio
          </Link>
        )}
      </main>
    </>
  );
}
