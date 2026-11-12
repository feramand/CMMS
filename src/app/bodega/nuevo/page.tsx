import Link from "next/link";
import { Encabezado } from "@/componentes/encabezado";
import { FormularioRepuesto } from "@/componentes/formulario-repuesto";
import { AvisoError, tarjeta } from "@/componentes/ui";
import { listarActivosVigentes } from "@/lib/consultas";
import { exigirPerfil } from "@/lib/dal";
import { accionCrearRepuesto } from "../actions";

export default async function NuevoRepuesto({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const usuario = await exigirPerfil("BODEGUERO", "ADMINISTRADOR", "ABASTECIMIENTO");
  const { error } = await searchParams;
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Nuevo repuesto</h1>
          <Link href="/bodega" className="text-marca underline">
            Volver
          </Link>
        </div>
        <AvisoError mensaje={error} />
        <section className={tarjeta}>
          <FormularioRepuesto accion={accionCrearRepuesto} maquinas={await listarActivosVigentes()} />
        </section>
        <p className="text-sm text-slate-600">
          Las existencias y el costo no se escriben aquí: se registran con una entrada en la ficha del repuesto.
        </p>
      </main>
    </>
  );
}
