import { Pool } from "pg";
import { config } from "dotenv";

config();

/**
 * The pool of connections to the database.
 */
export const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT!),
});
