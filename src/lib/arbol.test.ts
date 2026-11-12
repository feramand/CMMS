import { describe, expect, it } from "vitest";
import { aplanar, conDescendientes, mismoNombre } from "./arbol";

const nodos = [
  { id: 1, padreId: null, nombre: "Salida" },
  { id: 2, padreId: null, nombre: "Marcador" },
  { id: 3, padreId: 2, nombre: "Mesa de alimentación" },
  { id: 4, padreId: 2, nombre: "Cabezal de succión" },
  { id: 5, padreId: 4, nombre: "Ventosas" },
  { id: 6, padreId: 99, nombre: "Huérfano" },
];

describe("árbol de sistemas", () => {
  it("ordena cada padre seguido de sus hijos, con hermanos en orden alfabético", () => {
    expect(aplanar(nodos).map((n) => [n.nivel, n.ruta])).toEqual([
      [1, "Huérfano"],
      [1, "Marcador"],
      [2, "Marcador › Cabezal de succión"],
      [3, "Marcador › Cabezal de succión › Ventosas"],
      [2, "Marcador › Mesa de alimentación"],
      [1, "Salida"],
    ]);
  });

  it("ordena los números como números", () => {
    const cuerpos = [10, 2, 1].map((n) => ({ id: n, padreId: null, nombre: `Cuerpo impresor ${n}` }));
    expect(aplanar(cuerpos).map((n) => n.id)).toEqual([1, 2, 10]);
  });

  it("reúne un nodo con todos sus descendientes", () => {
    expect(conDescendientes(nodos, 2).sort()).toEqual([2, 3, 4, 5]);
    expect(conDescendientes(nodos, 1)).toEqual([1]);
  });

  it("compara nombres sin distinguir mayúsculas, tildes ni espacios sobrantes", () => {
    expect(mismoNombre(" marcador ", "Marcador")).toBe(true);
    expect(mismoNombre("Transmision", "Transmisión")).toBe(true);
    expect(mismoNombre("Marcador", "Salida")).toBe(false);
  });
});
