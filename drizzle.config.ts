import type { Config } from "drizzle-kit";
import * as dotenv from "dotenv";
dotenv.config();

const config: Config = {
  schema: "./test/drizzle/schema.ts",
  out: "./drizzle",
  driver: 'pglite',
  dbCredentials: {
    url: process.env.POSTGRES_URL!,
  },
  dialect: 'postgresql',
};

export default config;
