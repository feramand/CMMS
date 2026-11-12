import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { accionReportar } from "@/app/trabajos/actions";
import { Encabezado } from "@/componentes/encabezado";
import { CampoFotos } from "@/componentes/fotos";
import { AvisoError, campo } from "@/componentes/ui";
import { db } from "@/db";
import { solicitudes, type Categoria } from "@/db/schema";
import { listarActivosVigentes } from "@/lib/consultas";
import { exigirPerfil } from "@/lib/dal";
import { puedeEntrarAdmin, rutaInicio } from "@/lib/perfiles";

const OPCIONES: { valor: Categoria; nombre: string }[] = [
  { valor: "MECANICA", nombre: "Mecánica" },
  { valor: "ELECTRICA", nombre: "Eléctrica" },
  { valor: "INDETERMINADA", nombre: "No sé" },
  { valor: "SAC", nombre: "Apoyo crítico (SAC)" },
];

export default async function Reportar({ searchParams }: { searchParams: Promise<{ error?: string; activo?: string }> }) {
  const usuario = await exigirPerfil("OPERADOR", "TECNICO", "JEFE_PLANIFICADOR", "ADMINISTRADOR");
  const { error, activo: pedido } = await searchParams;
  const [lista, [ultima]] = await Promise.all([
    listarActivosVigentes(),
    db
      .select({ activoId: solicitudes.activoId })
      .from(solicitudes)
      .where(eq(solicitudes.creadaPor, usuario.id))
      .orderBy(desc(solicitudes.creadaEn))
      .limit(1),
  ]);
  // Primero la máquina cuyo QR se escaneó; si no viene de un QR, la última que usó esta persona.
  const primera = lista.some((a) => a.id === Number(pedido)) ? Number(pedido) : ultima?.activoId;
  const ordenada = [...lista].sort((a, b) => Number(b.id === primera) - Number(a.id === primera));
  const opciones = puedeEntrarAdmin(usuario.perfil)
    ? [...OPCIONES, { valor: "SERVICIOS_GENERALES" as Categoria, nombre: "Servicios generales" }]
    : OPCIONES;
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Reportar falla</h1>
          <Link href={rutaInicio(usuario.perfil)} className="text-marca underline">
            Volver
          </Link>
        </div>
        <AvisoError mensaje={error} />
        {lista.length === 0 ? (
          <p className="text-slate-600">Todavía no hay máquinas cargadas. Pide al administrador que las registre.</p>
        ) : (
          <form action={accionReportar} className="flex flex-1 flex-col gap-4">
            <label className="flex flex-col gap-1 text-base font-semibold">
              1. Máquina
              <select name="activoId" required className={`${campo} h-14 text-lg`}>
                {ordenada.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre} · {a.planta}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-base font-semibold">2. Tipo de falla</legend>
              <div className="grid grid-cols-2 gap-2">
                {opciones.map((o) => (
                  <label
                    key={o.valor}
                    className="flex h-20 cursor-pointer items-center justify-center rounded-xl border border-slate-400 bg-white px-2 text-center text-lg font-semibold has-checked:border-4 has-checked:border-marca has-checked:bg-blue-100"
                  >
                    <input type="radio" name="categoria" value={o.valor} required className="sr-only" />
                    {o.nombre}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-base font-semibold">3. ¿La máquina está detenida?</legend>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["si", "Sí, detenida"],
                  ["no", "No, sigue funcionando"],
                ].map(([valor, nombre]) => (
                  <label
                    key={valor}
                    className="flex h-16 cursor-pointer items-center justify-center rounded-xl border border-slate-400 bg-white px-2 text-center text-lg font-semibold has-checked:border-4 has-checked:border-marca has-checked:bg-blue-100"
                  >
                    <input type="radio" name="maquinaDetenida" value={valor} defaultChecked={valor === "si"} className="sr-only" />
                    {nombre}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex flex-col gap-1 text-base font-semibold">
              Comentario (opcional)
              <textarea name="comentario" rows={2} className="rounded-lg border border-slate-400 bg-white p-3 text-lg" />
            </label>
            <CampoFotos />
            <div className="flex-1" />
            <button type="submit" className="h-16 rounded-xl bg-amber-700 text-2xl font-bold text-white">
              Enviar
            </button>
          </form>
        )}
      </main>
    </>
  );
}
