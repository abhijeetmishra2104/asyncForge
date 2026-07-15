import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL || "postgresql://dummy:dummy@localhost:5432/dummy";

const pool = new Pool({ 
  connectionString,
  max: 20, // Increase max connections in the pool (default is 10)
  connectionTimeoutMillis: 10000, // Allow 10 seconds for Neon to wake up and connect
  idleTimeoutMillis: 30000,
});
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });