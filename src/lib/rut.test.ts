import { describe, expect, it } from "vitest";
import { digitoVerificador, normalizarRut } from "./rut";

describe("digitoVerificador", () => {
  it("calcula dígitos numéricos, cero y K", () => {
    expect(digitoVerificador(11111111)).toBe("1");
    expect(digitoVerificador(12345678)).toBe("5");
    expect(digitoVerificador(30686957)).toBe("4");
    // 6 × 2 = 12; 12 mod 11 = 1; 11 − 1 = 10 → K
    expect(digitoVerificador(6)).toBe("K");
    // 4 × (2+3+4+5+6+7+2+3) = 128; 128 mod 11 = 7; 11 − 7 = 4
    expect(digitoVerificador(44444444)).toBe("4");
    // 4 × 2 + 1 × 3 = 11; 11 mod 11 = 0; 11 − 0 = 11 → 0
    expect(digitoVerificador(14)).toBe("0");
  });
});

describe("normalizarRut", () => {
  it("acepta puntos, guion, espacios y k minúscula", () => {
    expect(normalizarRut("12.345.678-5")).toBe("12345678-5");
    expect(normalizarRut("123456785")).toBe("12345678-5");
    expect(normalizarRut(" 12345678-5 ")).toBe("12345678-5");
    expect(normalizarRut("6-k")).toBe("6-K");
  });
  it("quita ceros a la izquierda", () => {
    expect(normalizarRut("012345678-5")).toBeNull(); // 9 dígitos de cuerpo: fuera de rango
    expect(normalizarRut("06-K")).toBe("6-K");
  });
  it("rechaza dígito verificador incorrecto y texto que no es RUT", () => {
    expect(normalizarRut("12345678-9")).toBeNull();
    expect(normalizarRut("jperez")).toBeNull();
    expect(normalizarRut("")).toBeNull();
    expect(normalizarRut("0-0")).toBeNull();
  });
});
