import { Pool } from "pg";
import { config } from "dotenv";

config();

/**
 * The pool of connections to the database.
 */
export const pool = new Pool({
    user: process.env.POSTGRES_USERNAME,
    host: process.env.POSTGRES_HOSTNAME,
    database: process.env.POSTGRES_DB_NAME,
    password: process.env.POSTGRES_PASSWORD,
    port: parseInt(process.env.POSTGRES_PORT ?? "5432"),
});
