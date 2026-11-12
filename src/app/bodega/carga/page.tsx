import { FormularioCarga } from "@/app/admin/carga/formulario";
import { MenuBodega } from "@/componentes/bodega";
import { Encabezado } from "@/componentes/encabezado";
import { botonSecundario, tarjeta } from "@/componentes/ui";
import { exigirPerfil } from "@/lib/dal";
import { accionCargarRepuestos } from "../actions";

export default async function CargaRepuestos() {
  const usuario = await exigirPerfil("BODEGUERO", "ADMINISTRADOR");
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Carga de repuestos desde Excel</h1>
        <MenuBodega actual="/bodega/carga" opera />
        <section className={`${tarjeta} flex flex-col gap-3`}>
          <p className="text-slate-700">
            Sirve para traer el catálogo y las existencias desde Maintscape. Una fila por repuesto y almacén: si un repuesto está
            en la bodega y en un pañol, se repite su código en dos filas. Las columnas amarillas son obligatorias.
          </p>
          <ul className="list-disc pl-5 text-sm text-slate-700">
            <li>Si el código ya existe, se actualizan sus datos.</li>
            <li>La existencia inicial entra una sola vez por repuesto y almacén. Después, las diferencias se corrigen con un ajuste o un inventario.</li>
            <li>Los almacenes deben llamarse igual que en el sistema: Bodega central, Pañol mecánico, Pañol eléctrico.</li>
            <li>Si alguna fila tiene un error, no se carga nada y se indica qué corregir.</li>
          </ul>
          <a href="/bodega/plantilla" download className={botonSecundario}>
            Descargar plantilla de repuestos
          </a>
          <FormularioCarga accion={accionCargarRepuestos} etiqueta="Planilla de repuestos (.xlsx)" />
        </section>
      </main>
    </>
  );
}
