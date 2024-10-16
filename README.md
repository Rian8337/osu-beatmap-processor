# osu! beatmap processor

A dedicated backend for processing and caching osu! beatmaps.

## How to setup

To setup the server, you need:

-   [Node.js](https://nodejs.org/en) v18 or later
-   [PostgreSQL](https://www.postgresql.org/) v14 or later

Create an environment variable file (`.env`) in the root directory of the repository and fill it with the following variables:

```env
POSTGRES_HOSTNAME= # Hostname of PostgreSQL database
POSTGRES_PORT= # Port of PostgreSQL service
POSTGRES_DB_NAME= # The database name
POSTGRES_USERNAME= # PostgreSQL username
POSTGRES_PASSWORD= # PostgreSQL password
EXPRESS_PORT= # Port for Express server
OSU_API_KEY= # osu! APIv1 key
```

### Setup Node.js dependencies

Begin by installing dependencies:

```
npm i
```

The project can be transpiled by running `npm run build-linux` in Unix and `npm run build-windows` in Windows.

### Setup PostgreSQL in Linux

Begin by installing packages:

```she
sudo apt update && apt upgrade
sudo apt install postgresql postgresql-contrib
```

After that, set the password of the default `postgres` user:

```she
sudo passwd postgres
```

You can then enable the PostgreSQL service and access the PostgreSQL terminal:

```she
sudo service postgresql start
sudo -u postgres psql
```

Create the database if it does not exist:

```sql
CREATE DATABASE <database_name_in_env_file>;
```

You can then import the SQL script in the root directory of this repository (make sure the `postgres` user can read the file):

```she
sudo -u postgres psql -U postgres -d <database_name_in_env_file> -f tables.sql
```
