import { and, desc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { ActivarAvisos } from "@/componentes/activar-avisos";
import { Encabezado } from "@/componentes/encabezado";
import { tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { notificaciones } from "@/db/schema";
import { exigirSesion } from "@/lib/dal";
import { rutaInicio } from "@/lib/perfiles";
import { clavePublicaPush } from "@/lib/push";
import { fechaHora } from "@/lib/tiempo";

export default async function Avisos() {
  const usuario = await exigirSesion();
  const lista = await db
    .select()
    .from(notificaciones)
    .where(eq(notificaciones.usuarioId, usuario.id))
    .orderBy(desc(notificaciones.creadaEn))
    .limit(50);
  // Al abrir la pantalla, los avisos quedan como leídos.
  await db
    .update(notificaciones)
    .set({ leidaEn: new Date() })
    .where(and(eq(notificaciones.usuarioId, usuario.id), isNull(notificaciones.leidaEn)));
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Avisos</h1>
          <Link href={rutaInicio(usuario.perfil)} className="text-marca underline">
            Volver
          </Link>
        </div>
        <ActivarAvisos clavePublica={clavePublicaPush()} />
        {lista.length === 0 && <p className="text-slate-600">No tienes avisos.</p>}
        {lista.map((n) => (
          <Link
            key={n.id}
            href={n.enlace ?? rutaInicio(usuario.perfil)}
            className={`${tarjeta} flex flex-col gap-1 ${n.leidaEn ? "" : "border-2 border-marca"}`}
          >
            <span className={`text-base ${n.leidaEn ? "" : "font-semibold"}`}>{n.mensaje}</span>
            <span className="text-sm text-slate-600">{fechaHora(n.creadaEn)}</span>
          </Link>
        ))}
      </main>
    </>
  );
}
