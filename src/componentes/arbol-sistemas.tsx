import {
  accionAgregarSistema,
  accionEliminarSistema,
  accionRenombrarSistema,
} from "@/app/admin/tipos/actions";
import { MAX_NIVELES, NOMBRE_NIVEL, type NodoPlano } from "@/lib/arbol";
import { botonPrimario, campo } from "./ui";

const SANGRIA = ["", "ml-6", "ml-12"];
const botonChico = "h-11 rounded-lg px-3 text-sm font-semibold";

/** Árbol de solo lectura: sistema, subsistema y componente con sangría. */
export function ArbolLectura({ nodos }: { nodos: NodoPlano[] }) {
  if (nodos.length === 0) return <p className="text-slate-600">Sin sistemas cargados.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {nodos.map((n) => (
        <li key={n.id} className={`${SANGRIA[n.nivel - 1] ?? "ml-12"} ${n.nivel === 1 ? "font-semibold" : "text-slate-700"}`}>
          {n.nivel > 1 ? "└ " : ""}
          {n.nombre}
        </li>
      ))}
    </ul>
  );
}

/**
 * Árbol editable. Sirve para la plantilla de un tipo de máquina (ambito "tipo") y para el
 * árbol propio de una máquina (ambito "activo").
 */
export function ArbolEditable({
  nodos,
  ambito,
  duenoId,
}: {
  nodos: NodoPlano[];
  ambito: "tipo" | "activo";
  duenoId: number;
}) {
  const ocultos = (
    <>
      <input type="hidden" name="ambito" value={ambito} />
      <input type="hidden" name="duenoId" value={duenoId} />
    </>
  );
  return (
    <div className="flex flex-col gap-3">
      {nodos.length === 0 && <p className="text-slate-600">Todavía no hay sistemas. Agrega el primero abajo.</p>}
      <ul className="flex flex-col gap-1">
        {nodos.map((n) => {
          const hijo = NOMBRE_NIVEL[n.nivel]?.toLowerCase();
          return (
            <li key={n.id} className={SANGRIA[n.nivel - 1] ?? "ml-12"}>
              <details className="rounded-lg border border-slate-200 bg-slate-50">
                <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2">
                  <span className={n.nivel === 1 ? "font-semibold" : ""}>{n.nombre}</span>
                  <span className="text-sm text-slate-600">· {NOMBRE_NIVEL[n.nivel - 1]}</span>
                </summary>
                <div className="flex flex-col gap-2 border-t border-slate-200 p-3">
                  {n.nivel < MAX_NIVELES && (
                    <form action={accionAgregarSistema} className="flex flex-wrap gap-2">
                      {ocultos}
                      <input type="hidden" name="padreId" value={n.id} />
                      <input
                        name="nombre"
                        required
                        maxLength={80}
                        aria-label={`Nuevo ${hijo} de ${n.nombre}`}
                        placeholder={`Nuevo ${hijo}`}
                        className={`${campo} max-w-xs`}
                      />
                      <button type="submit" className={`${botonChico} bg-marca text-white`}>
                        Agregar {hijo}
                      </button>
                    </form>
                  )}
                  <form action={accionRenombrarSistema} className="flex flex-wrap gap-2">
                    {ocultos}
                    <input type="hidden" name="id" value={n.id} />
                    <input
                      name="nombre"
                      required
                      maxLength={80}
                      defaultValue={n.nombre}
                      aria-label={`Nombre de ${n.nombre}`}
                      className={`${campo} max-w-xs`}
                    />
                    <button type="submit" className={`${botonChico} border-2 border-marca bg-white text-marca`}>
                      Cambiar nombre
                    </button>
                  </form>
                  <form action={accionEliminarSistema}>
                    {ocultos}
                    <input type="hidden" name="id" value={n.id} />
                    <button type="submit" className={`${botonChico} border-2 border-red-700 bg-white text-red-800`}>
                      Quitar{n.nivel < MAX_NIVELES ? " con todo lo que contiene" : ""}
                    </button>
                  </form>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      <form action={accionAgregarSistema} className="flex flex-wrap gap-2">
        {ocultos}
        <input name="nombre" required maxLength={80} aria-label="Nuevo sistema" placeholder="Nuevo sistema" className={`${campo} max-w-xs`} />
        <button type="submit" className={botonPrimario}>
          Agregar sistema
        </button>
      </form>
    </div>
  );
}
