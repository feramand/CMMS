// Datos iniciales. Se puede ejecutar varias veces: no duplica ni pisa lo existente.
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { normalizarRut } from "../lib/rut";
import * as schema from "./schema";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta la variable DATABASE_URL");
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  await db
    .insert(schema.plantas)
    .values([{ nombre: "Planta 1" }, { nombre: "Planta 2" }])
    .onConflictDoNothing();

  await db
    .insert(schema.especialidades)
    .values([
      { codigo: "MEC", nombre: "Mecánica" },
      { codigo: "ELE", nombre: "Electricidad" },
      { codigo: "SSGG", nombre: "Servicios generales" },
      { codigo: "SAC", nombre: "Sistemas de Apoyo Crítico" },
    ])
    .onConflictDoNothing();

  // Tipos de máquina de partida. Se pueden crear más y armar la plantilla de sistemas de cada uno.
  await db
    .insert(schema.tiposMaquina)
    .values(
      [
        "Prensa Offset Plana",
        "Prensa Offset Rotativa",
        "Prensa Digital",
        "Encuadernadora Perfect Binder",
        "Encuadernadora Espiral",
        "Encuadernadora Doble Cero",
        "Encuadernadora Tapa Dura",
        "Encuadernadora de Alambre",
        "Perforadora",
        "Guillotina Frontal",
        "Guillotina Trilateral",
        "Armadora de Tapas",
        "Embolsadora",
      ].map((nombre) => ({ nombre })),
    )
    .onConflictDoNothing();

  await db
    .insert(schema.turnos)
    .values([
      { nombre: "Mañana", horaInicio: "07:00", horaFin: "14:00" },
      { nombre: "Tarde", horaInicio: "14:00", horaFin: "22:00" },
      { nombre: "Noche", horaInicio: "22:00", horaFin: "07:00" },
    ])
    .onConflictDoNothing();

  await db
    .insert(schema.parametros)
    .values([
      { clave: "pauta_pct_liberacion", valor: "80", descripcion: "Porcentaje del intervalo en que se libera una pauta" },
      { clave: "pauta_pct_limite", valor: "120", descripcion: "Porcentaje del intervalo en que una pauta queda incumplida" },
      { clave: "turno_horas_apagado", valor: "12", descripcion: "Horas tras las cuales el turno se desactiva solo" },
      { clave: "giros_lecturas_por_dia", valor: "2", descripcion: "Lecturas de giros esperadas por día desde Metrics" },
    ])
    .onConflictDoNothing();

  // Primer administrador: solo se crea si se entregan sus datos y aún no existe.
  const { ADMIN_RUT, ADMIN_NOMBRE, ADMIN_CLAVE } = process.env;
  if (ADMIN_RUT && ADMIN_NOMBRE && ADMIN_CLAVE) {
    const rut = normalizarRut(ADMIN_RUT);
    if (!rut) throw new Error("ADMIN_RUT no es un RUT válido");
    if (ADMIN_CLAVE.length < 8) throw new Error("ADMIN_CLAVE debe tener al menos 8 caracteres");
    await db
      .insert(schema.usuarios)
      .values({
        nombre: ADMIN_NOMBRE,
        perfil: "ADMINISTRADOR",
        identificador: rut,
        claveHash: await bcrypt.hash(ADMIN_CLAVE, 10),
      })
      .onConflictDoNothing();
  }

  await pool.end();
  console.log("Datos iniciales cargados.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
