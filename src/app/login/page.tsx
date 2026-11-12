import Image from "next/image";
import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/dal";
import { rutaInicio } from "@/lib/perfiles";
import { FormularioIngreso } from "./formulario";

export default async function PaginaIngreso() {
  const usuario = await usuarioActual();
  if (usuario) redirect(rutaInicio(usuario.perfil));
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
      <FormularioIngreso />
    </main>
  );
}
