import { and, eq, inArray } from "drizzle-orm";
import { MenuCompras } from "@/componentes/compras";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, botonSecundario, campo, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { activos, usuarios } from "@/db/schema";
import { cargosDe, gestionaCompras, rolDe, ROLES_AUTORIZACION } from "@/lib/compras-core";
import { listarCentros, listarCuentas } from "@/lib/consultas-compras";
import { exigirPerfil } from "@/lib/dal";
import { partesEnChile } from "@/lib/tiempo";
import { accionCentroDeMaquina, accionFijarAutorizador, accionGuardarCatalogo } from "../actions";

type Item = { id: number; codigo: string; nombre: string; activo: boolean };

function Catalogo({ tipo, titulo, ayuda, items, edita }: { tipo: string; titulo: string; ayuda: string; items: Item[]; edita: boolean }) {
  return (
    <section className={`${tarjeta} flex flex-col gap-3`}>
      <h2 className="text-lg font-bold">
        {titulo} · {items.length}
      </h2>
      <p className="text-sm text-slate-600">{ayuda}</p>
      {items.map((i) => (
        <form key={i.id} action={accionGuardarCatalogo} className="grid grid-cols-[7rem_1fr_auto_auto] items-center gap-2">
          <input type="hidden" name="tipo" value={tipo} />
          <input type="hidden" name="id" value={i.id} />
          <input name="codigo" defaultValue={i.codigo} disabled={!edita} aria-label="Código" className={campo} />
          <input name="nombre" defaultValue={i.nombre} disabled={!edita} aria-label="Nombre" className={campo} />
          <select name="activo" defaultValue={i.activo ? "si" : "no"} disabled={!edita} aria-label="Estado" className={campo}>
            <option value="si">Vigente</option>
            <option value="no">De baja</option>
          </select>
          {edita && <button className="h-12 rounded-lg border border-marca px-3 font-semibold text-marca">Guardar</button>}
        </form>
      ))}
      {edita && (
        <form action={accionGuardarCatalogo} className="grid grid-cols-[7rem_1fr_auto] items-end gap-2 border-t border-slate-200 pt-3">
          <input type="hidden" name="tipo" value={tipo} />
          <input name="codigo" required placeholder="Código" aria-label="Código nuevo" className={campo} />
          <input name="nombre" required placeholder="Nombre" aria-label="Nombre nuevo" className={campo} />
          <button className={botonPrimario}>Agregar</button>
        </form>
      )}
    </section>
  );
}

export default async function Contabilidad({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const usuario = await exigirPerfil("ABASTECIMIENTO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "BODEGUERO");
  const { error } = await searchParams;
  const [cuentas, centros, maquinas, candidatos] = await Promise.all([
    listarCuentas(),
    listarCentros(),
    db.select({ id: activos.id, nombre: activos.nombre, codigo: activos.codigo, centroCostoId: activos.centroCostoId }).from(activos).orderBy(activos.nombre),
    db
      .select({ id: usuarios.id, nombre: usuarios.nombre, perfil: usuarios.perfil, puedeAutorizarOc: usuarios.puedeAutorizarOc, cargoOc: usuarios.cargoOc })
      .from(usuarios)
      .where(and(eq(usuarios.activo, true), inArray(usuarios.perfil, ["JEFE_PLANIFICADOR", "ADMINISTRADOR"])))
      .orderBy(usuarios.nombre),
  ]);
  const edita = gestionaCompras(usuario);
  const hoy = partesEnChile(new Date()).fecha;
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Contabilidad</h1>
        <MenuCompras actual="/compras/contabilidad" />
        <AvisoError mensaje={error} />
        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Archivo Excel para contabilidad (Fin700)</h2>
          <p className="text-sm text-slate-600">
            Todos los movimientos de bodega del período, valorizados en pesos, con su cuenta contable y su centro de costo.
          </p>
          <form action="/compras/exportar" className="grid items-end gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Desde
              <input type="date" name="desde" required defaultValue={`${hoy.slice(0, 8)}01`} className={campo} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Hasta
              <input type="date" name="hasta" required defaultValue={hoy} className={campo} />
            </label>
            <button type="submit" className={botonSecundario}>
              Descargar Excel
            </button>
          </form>
        </section>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Catalogo tipo="cuenta" titulo="Cuentas contables" ayuda="Se asignan a cada repuesto en su ficha de bodega y a cada orden de compra." items={cuentas} edita={edita} />
          <Catalogo tipo="centro" titulo="Centros de costo" ayuda="Se asignan a cada máquina (abajo), a las solicitudes de compra y a cada orden de compra." items={centros} edita={edita} />
        </div>
        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Centro de costo de cada máquina</h2>
          <p className="text-sm text-slate-600">Los repuestos entregados a una orden de trabajo se imputan al centro de costo de su máquina.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {maquinas.map((m) => (
              <form key={m.id} action={accionCentroDeMaquina} className="grid grid-cols-[1fr_auto] items-end gap-2">
                <input type="hidden" name="activoId" value={m.id} />
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  {m.nombre} · {m.codigo}
                  <select name="centroCostoId" defaultValue={m.centroCostoId ?? ""} disabled={!edita} className={campo}>
                    <option value="">Sin centro de costo</option>
                    {centros
                      .filter((c) => c.activo || c.id === m.centroCostoId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.codigo} · {c.nombre}
                        </option>
                      ))}
                  </select>
                </label>
                {edita && <button className="h-12 rounded-lg border border-marca px-3 font-semibold text-marca">Guardar</button>}
              </form>
            ))}
          </div>
        </section>
        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Quiénes autorizan órdenes de compra</h2>
          <p className="text-sm text-slate-600">
            Cada orden necesita dos firmas: jefe de mantenimiento y gerente de producción. La del gerente general es opcional.
            El cargo con el que firma cada persona lo define el administrador.
          </p>
          {candidatos.map((c) => {
            const cargo = rolDe(c);
            return (
              <form key={c.id} action={accionFijarAutorizador} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-2">
                <input type="hidden" name="usuarioId" value={c.id} />
                <b>{c.nombre}</b>
                {usuario.perfil === "ADMINISTRADOR" ? (
                  <span className="flex items-center gap-2">
                    <select name="cargo" defaultValue={cargo ?? ""} aria-label={`Cargo de ${c.nombre}`} className={campo}>
                      <option value="">No autoriza</option>
                      {cargosDe(c.perfil).map((r) => (
                        <option key={r} value={r}>
                          {ROLES_AUTORIZACION[r]}
                        </option>
                      ))}
                    </select>
                    <button className="h-12 rounded-lg border border-marca px-3 font-semibold text-marca">Guardar</button>
                  </span>
                ) : (
                  <b className={cargo ? "text-green-700" : "text-slate-500"}>{cargo ? ROLES_AUTORIZACION[cargo] : "No autoriza"}</b>
                )}
              </form>
            );
          })}
        </section>
      </main>
    </>
  );
}
