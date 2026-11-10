import { describe, expect, it } from "vitest";
import {
  puedeEntrarAdmin,
  puedeRestablecerClave,
  rutaInicio,
  usaPin,
  usaUsuarioMetrics,
} from "./perfiles";

describe("perfiles", () => {
  it("PIN solo para técnico, operador y bodeguero", () => {
    expect(["TECNICO", "OPERADOR", "BODEGUERO"].every((p) => usaPin(p as never))).toBe(true);
    expect(
      ["ADMINISTRADOR", "JEFE_PLANIFICADOR", "ABASTECIMIENTO"].some((p) => usaPin(p as never)),
    ).toBe(false);
  });
  it("solo el operador se identifica con usuario de Metrics", () => {
    expect(usaUsuarioMetrics("OPERADOR")).toBe(true);
    expect(usaUsuarioMetrics("TECNICO")).toBe(false);
    expect(usaUsuarioMetrics("BODEGUERO")).toBe(false);
  });
  it("cada perfil llega a su interfaz", () => {
    expect(rutaInicio("TECNICO")).toBe("/inicio");
    expect(rutaInicio("OPERADOR")).toBe("/inicio");
    expect(rutaInicio("BODEGUERO")).toBe("/inicio");
    expect(rutaInicio("JEFE_PLANIFICADOR")).toBe("/admin");
    expect(rutaInicio("ABASTECIMIENTO")).toBe("/admin");
    expect(puedeEntrarAdmin("OPERADOR")).toBe(false);
  });
  it("jefe y planificador restablecen solo a técnicos y operadores", () => {
    expect(puedeRestablecerClave("JEFE_PLANIFICADOR", "TECNICO")).toBe(true);
    expect(puedeRestablecerClave("JEFE_PLANIFICADOR", "OPERADOR")).toBe(true);
    expect(puedeRestablecerClave("JEFE_PLANIFICADOR", "BODEGUERO")).toBe(false);
    expect(puedeRestablecerClave("JEFE_PLANIFICADOR", "ADMINISTRADOR")).toBe(false);
    expect(puedeRestablecerClave("ADMINISTRADOR", "ADMINISTRADOR")).toBe(true);
    expect(puedeRestablecerClave("TECNICO", "OPERADOR")).toBe(false);
  });
});
