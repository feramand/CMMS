// Fotos adjuntas: validación, guardado en disco y registro en la base de datos.
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DB } from "@/db";
import { adjuntos } from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import { ErrorDeNegocio } from "./usuarios-core";

export const MAX_FOTOS = 3;
export const MAX_BYTES = 10 * 1024 * 1024;

export type Foto = { nombre: string; bytes: Uint8Array };
export type Destino = { solicitudId: number } | { otId: number } | { repuestoId: number };

/** Tipo de imagen según sus primeros bytes; el nombre y el tipo que declara el navegador no son de fiar. */
export function tipoDeImagen(b: Uint8Array): { tipo: string; extension: string } | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { tipo: "image/jpeg", extension: "jpg" };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 8 && png.every((v, i) => b[i] === v)) return { tipo: "image/png", extension: "png" };
  const ascii = (desde: number, texto: string) =>
    b.length >= desde + texto.length && [...texto].every((c, i) => b[desde + i] === c.charCodeAt(0));
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return { tipo: "image/webp", extension: "webp" };
  return null;
}

export function carpetaAdjuntos(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.ADJUNTOS_DIR || "./datos/adjuntos");
}

/** Ruta en disco de un adjunto; rechaza cualquier nombre que no sea el que genera el sistema. */
export function rutaAdjunto(archivo: string, carpeta = carpetaAdjuntos()): string {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(archivo)) throw new ErrorDeNegocio("Adjunto no válido.");
  // La carpeta se define en la instalación; no forma parte del código a empaquetar.
  return path.join(/* turbopackIgnore: true */ carpeta, archivo);
}

/**
 * Guarda hasta MAX_FOTOS imágenes. Valida todas antes de escribir ninguna;
 * si el registro en la base falla, borra los archivos ya escritos.
 */
export async function guardarFotos(
  db: DB,
  actor: UsuarioSesion,
  destino: Destino,
  fotos: Foto[],
  carpeta = carpetaAdjuntos(),
): Promise<number> {
  const validas = fotos.filter((f) => f.bytes.length > 0);
  if (validas.length === 0) return 0;
  if (validas.length > MAX_FOTOS) throw new ErrorDeNegocio(`Puedes adjuntar hasta ${MAX_FOTOS} fotos.`);
  const preparadas = validas.map((f) => {
    if (f.bytes.length > MAX_BYTES) {
      throw new ErrorDeNegocio(`La foto "${f.nombre}" pesa más de ${MAX_BYTES / 1024 / 1024} MB.`);
    }
    const tipo = tipoDeImagen(f.bytes);
    if (!tipo) throw new ErrorDeNegocio(`"${f.nombre}" no es una foto JPG, PNG o WebP.`);
    return { bytes: f.bytes, tipo: tipo.tipo, archivo: `${randomUUID()}.${tipo.extension}` };
  });
  await mkdir(carpeta, { recursive: true });
  const escritos: string[] = [];
  try {
    for (const p of preparadas) {
      const ruta = rutaAdjunto(p.archivo, carpeta);
      await writeFile(ruta, p.bytes, { flag: "wx" });
      escritos.push(ruta);
    }
    await db.insert(adjuntos).values(
      preparadas.map((p) => ({
        ...destino,
        archivo: p.archivo,
        tipo: p.tipo,
        bytes: p.bytes.length,
        subidoPor: actor.id,
      })),
    );
  } catch (e) {
    await Promise.all(escritos.map((r) => unlink(r).catch(() => undefined)));
    throw e;
  }
  return preparadas.length;
}

/** Convierte los archivos de un formulario en fotos; ignora los campos vacíos. */
export async function fotosDeFormulario(formData: FormData, campo = "fotos"): Promise<Foto[]> {
  const archivos = formData.getAll(campo).filter((v): v is File => v instanceof File && v.size > 0);
  if (archivos.length > MAX_FOTOS) throw new ErrorDeNegocio(`Puedes adjuntar hasta ${MAX_FOTOS} fotos.`);
  for (const a of archivos) {
    if (a.size > MAX_BYTES) throw new ErrorDeNegocio(`La foto "${a.name}" pesa más de ${MAX_BYTES / 1024 / 1024} MB.`);
  }
  const fotos = await Promise.all(
    archivos.map(async (a) => ({ nombre: a.name, bytes: new Uint8Array(await a.arrayBuffer()) })),
  );
  // Se valida antes de ejecutar la acción principal, para no dejar un registro a medias.
  for (const f of fotos) {
    if (!tipoDeImagen(f.bytes)) throw new ErrorDeNegocio(`"${f.nombre}" no es una foto JPG, PNG o WebP.`);
  }
  return fotos;
}
