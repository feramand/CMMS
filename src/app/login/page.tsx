import Image from "next/image";
import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/dal";
import { rutaInicio } from "@/lib/perfiles";
import { FormularioIngreso } from "./formulario";

export default async function PaginaIngreso({ searchParams }: { searchParams: Promise<{ volver?: string }> }) {
  const usuario = await usuarioActual();
  const { volver } = await searchParams;
  const destino = typeof volver === "string" && /^\/activo\/\d+$/.test(volver) ? volver : undefined;
  if (usuario) redirect(destino ?? rutaInicio(usuario.perfil));
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-2 rounded-xl bg-white p-4">
        <h1 className="sr-only">Print Garage</h1>
        <Image
          src="/logo-print-garage.png"
          alt="Print Garage"
          width={1343}
          height={584}
          preload
          className="h-auto w-full max-w-64"
        />
        <p className="text-slate-600">Gestión de activos y mantenimiento</p>
      </div>
      <FormularioIngreso volver={destino} />
    </main>
  );
}
