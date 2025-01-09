import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";
import { Wait } from "testcontainers";

config({ path: ".env" });

let container: StartedPostgreSqlContainer;
let client: postgres.Sql;
export let db: ReturnType<typeof drizzle>;

export async function setupTestDatabase() {
  console.log("Setting up test database...");
  container = await new PostgreSqlContainer()
    .withDatabase(process.env.POSTGRES_DB!)
    .withUsername(process.env.POSTGRES_USER!)
    .withPassword(process.env.POSTGRES_PASSWORD!)
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections"))
    .withWaitStrategy(Wait.forListeningPorts())
    .start();

  console.log("Test database started");

  const connectionString = container.getConnectionUri();

  client = postgres(connectionString, {
    prepare: false,
  });

  db = drizzle(client, { schema });

  // Run migrations
  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("Migrations complete");

  return db;
}

export async function teardownTestDatabase() {
  await client?.end();
  await container?.stop();
}
