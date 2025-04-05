import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
    out: "./drizzle",
    schema: "./src/database/schema.ts",
    dialect: "postgresql",
    dbCredentials: {
        user: process.env.POSTGRES_USERNAME!,
        host: process.env.POSTGRES_HOSTNAME!,
        database: process.env.POSTGRES_NAME!,
        password: process.env.POSTGRES_PASSWORD,
        port: parseInt(process.env.POSTGRES_PORT ?? "") || undefined,
    },
});
