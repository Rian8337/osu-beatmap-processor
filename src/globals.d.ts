/* eslint-disable @typescript-eslint/no-unused-vars */

namespace NodeJS {
    interface ProcessEnv {
        /**
         * The hostname of the PostgreSQL server.
         */
        readonly POSTGRES_HOSTNAME?: string;

        /**
         * The port of the PostgreSQL server.
         */
        readonly POSTGRES_PORT?: string;

        /**
         * The name of the PostgreSQL database.
         */
        readonly POSTGRES_DB_NAME?: string;

        /**
         * The username to authenticate with the PostgreSQL server.
         */
        readonly POSTGRES_USERNAME?: string;

        /**
         * The password to authenticate with the PostgreSQL server.
         */
        readonly POSTGRES_PASSWORD?: string;

        /**
         * The port the Express server will listen to.
         */
        readonly EXPRESS_PORT?: string;

        /**
         * The API key for the osu! APIv1.
         */
        readonly OSU_API_KEY?: string;

        /**
         * The internal server key.
         */
        readonly INTERNAL_SERVER_KEY?: string;
    }
}
