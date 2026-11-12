// Árbol de sistemas y subsistemas: funciones puras, sin base de datos.

export type Nodo = { id: number; padreId: number | null; nombre: string };
export type NodoPlano<T extends Nodo = Nodo> = T & {
  /** 1 = sistema, 2 = subsistema, 3 = componente. */
  nivel: number;
  /** Nombre completo desde la raíz, por ejemplo "Marcador › Cabezal de succión". */
  ruta: string;
};

/** Sistema › subsistema › componente. */
export const MAX_NIVELES = 3;
export const NOMBRE_NIVEL = ["Sistema", "Subsistema", "Componente"] as const;

export const mismoNombre = (a: string, b: string) =>
  a.trim().localeCompare(b.trim(), "es", { sensitivity: "base" }) === 0;

/**
 * Ordena los nodos en profundidad (cada padre seguido de sus hijos), con los hermanos por
 * orden alfabético. Un nodo cuyo padre no está en la lista se muestra como raíz.
 */
export function aplanar<T extends Nodo>(nodos: T[]): NodoPlano<T>[] {
  const ids = new Set(nodos.map((n) => n.id));
  const hijos = new Map<number | null, T[]>();
  for (const n of nodos) {
    const padre = n.padreId !== null && ids.has(n.padreId) ? n.padreId : null;
    hijos.set(padre, [...(hijos.get(padre) ?? []), n]);
  }
  const salida: NodoPlano<T>[] = [];
  const recorrer = (padre: number | null, nivel: number, prefijo: string) => {
    const lista = [...(hijos.get(padre) ?? [])].sort((a, b) =>
      a.nombre.localeCompare(b.nombre, "es", { numeric: true, sensitivity: "base" }),
    );
    for (const n of lista) {
      const ruta = prefijo ? `${prefijo} › ${n.nombre}` : n.nombre;
      salida.push({ ...n, nivel, ruta });
      recorrer(n.id, nivel + 1, ruta);
    }
  };
  recorrer(null, 1, "");
  return salida;
}

/** IDs del nodo y de todo lo que cuelga de él. */
export function conDescendientes(nodos: Nodo[], id: number): number[] {
  const salida = [id];
  for (let i = 0; i < salida.length; i++) {
    for (const n of nodos) if (n.padreId === salida[i]) salida.push(n.id);
  }
  return salida;
}
