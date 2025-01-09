import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as dotenv from "dotenv";

dotenv.config();

async function runMigrations() {
  const sql = postgres(process.env.POSTGRES_URL!, { max: 1 });
  const db = drizzle(sql);
  
  await migrate(db, { migrationsFolder: "drizzle" });
  
  await sql.end();
}

runMigrations().catch(console.error); 