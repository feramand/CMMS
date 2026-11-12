import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { accionSolicitarRepuesto } from "@/app/trabajos/actions";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, campo, tarjeta } from "@/componentes/ui";
import { ordenesTrabajo, solicitudes } from "@/db/schema";
import { listarOts, listarSolicitudes } from "@/lib/consultas";
import { exigirPerfil } from "@/lib/dal";

type Props = { searchParams: Promise<{ sat?: string; ot?: string; error?: string }> };

export default async function SolicitarRepuesto({ searchParams }: Props) {
  const usuario = await exigirPerfil("TECNICO", "JEFE_PLANIFICADOR", "ADMINISTRADOR");
  const { sat, ot, error } = await searchParams;
  const otId = Number(ot) || null;
  const solicitudId = Number(sat) || null;
  const [orden] = otId ? await listarOts(eq(ordenesTrabajo.id, otId), 1) : [];
  const [solicitud] = !otId && solicitudId ? await listarSolicitudes(eq(solicitudes.id, solicitudId), 1) : [];
  if (!orden && !solicitud) notFound();
  const vuelta = orden ? `/ot/${orden.id}` : `/sat/${solicitud!.id}`;
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Solicitar repuesto</h1>
          <Link href={vuelta} className="text-marca underline">
            Volver
          </Link>
        </div>
        <AvisoError mensaje={error} />
        <section className={`${tarjeta} flex flex-col`}>
          <span className="text-sm text-slate-600">Para</span>
          <span className="text-lg font-semibold">
            {orden ? `${orden.activo} · OT ${orden.folio}` : `${solicitud!.activo} · solicitud en atención`}
          </span>
        </section>
        <form action={accionSolicitarRepuesto} className="flex flex-1 flex-col gap-4">
          {orden ? (
            <input type="hidden" name="otId" value={orden.id} />
          ) : (
            <input type="hidden" name="solicitudId" value={solicitud!.id} />
          )}
          <label className="flex flex-col gap-1 text-base font-semibold">
            Descripción
            <input name="descripcion" required className={`${campo} h-14 text-lg`} />
          </label>
          <label className="flex flex-col gap-1 text-base font-semibold">
            Código de fabricante (si lo conoces)
            <input name="codigoFabricante" autoCapitalize="characters" className={`${campo} h-14 text-lg`} />
          </label>
          <label className="flex flex-col gap-1 text-base font-semibold">
            Cantidad
            <input
              name="cantidad"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              defaultValue={1}
              required
              className={`${campo} h-14 text-lg`}
            />
          </label>
          <p className="text-sm text-slate-600">La máquina se toma del trabajo que estás atendiendo.</p>
          <div className="flex-1" />
          <button type="submit" className="h-16 rounded-xl bg-marca text-xl font-bold text-white">
            Enviar a bodega
          </button>
        </form>
      </main>
    </>
  );
}
