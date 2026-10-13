import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * The database connection.
 */
export const db = drizzle(
    new Pool({
        user: process.env.POSTGRES_USERNAME,
        host: process.env.POSTGRES_HOSTNAME,
        database: process.env.POSTGRES_DB_NAME,
        password: process.env.POSTGRES_PASSWORD,
        port: parseInt(process.env.POSTGRES_PORT ?? "5432"),
    }),
);
