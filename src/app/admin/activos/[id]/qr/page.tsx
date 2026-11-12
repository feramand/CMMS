import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotonImprimir } from "@/componentes/boton-imprimir";
import { botonPrimario } from "@/componentes/ui";
import { db } from "@/db";
import { activos, plantas } from "@/db/schema";
import { exigirPerfil } from "@/lib/dal";
import { qrSvg, urlDeActivo } from "@/lib/qr";

// Etiqueta para imprimir y pegar en la máquina. Al imprimir solo sale la etiqueta.
export default async function EtiquetaQr({ params }: { params: Promise<{ id: string }> }) {
  await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [a] = await db
    .select({ nombre: activos.nombre, codigo: activos.codigo, planta: plantas.nombre })
    .from(activos)
    .innerJoin(plantas, eq(plantas.id, activos.plantaId))
    .where(eq(activos.id, id));
  if (!a) notFound();
  const url = await urlDeActivo(id);
  const svg = await qrSvg(url);
  const local = !process.env.URL_PUBLICA && /localhost|127\.0\.0\.1/.test(url);
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center gap-4 p-4">
      <div className="flex w-full flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-bold">Código QR de la máquina</h1>
        <Link href={`/admin/activos/${id}`} className="text-marca underline">
          Volver a la ficha
        </Link>
      </div>
      <div className="flex w-80 flex-col items-center gap-1 rounded-xl border-2 border-slate-900 bg-white p-4 text-center">
        <p className="text-sm font-bold tracking-widest">PRINT GARAGE</p>
        <div
          role="img"
          aria-label={`Código QR de ${a.nombre}`}
          className="w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <p className="text-xl font-bold leading-tight">{a.nombre}</p>
        <p className="text-base">
          {a.codigo} · {a.planta}
        </p>
        <p className="text-sm text-slate-700">Escanea para ver la ficha y el historial</p>
      </div>
      <div className="flex w-full flex-col items-center gap-2 print:hidden">
        <BotonImprimir className={botonPrimario} />
        <p className="text-center text-sm text-slate-600">
          El código lleva a <span className="break-all font-semibold">{url}</span>. Pide iniciar sesión antes de
          mostrar la ficha.
        </p>
        {local && (
          <p role="alert" className="rounded-lg bg-amber-100 px-4 py-3 text-base text-amber-900">
            Esta dirección solo funciona en este computador. No imprimas etiquetas definitivas hasta que el
            sistema tenga su dirección final.
          </p>
        )}
      </div>
    </main>
  );
}
