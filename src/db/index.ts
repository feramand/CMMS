import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { cmmsPool?: Pool };

export const pool =
  globalForDb.cmmsPool ??
  new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") globalForDb.cmmsPool = pool;

export const db = drizzle(pool, { schema });
export type DB = typeof db;
