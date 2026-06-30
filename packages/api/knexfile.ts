import type { Knex } from 'knex';
import * as dotenv from 'dotenv';
dotenv.config();

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations: {
      extension: 'ts',
      directory: './src/db/migrations',
    },
    seeds: {
      extension: 'ts',
      directory: './src/db/seeds',
    },
  },
  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    pool: { min: 2, max: 10 },
    migrations: {
      extension: 'ts',
      directory: './src/db/migrations',
    },
    seeds: {
      extension: 'ts',
      directory: './src/db/seeds',
    },
  },
};

module.exports = config[process.env.NODE_ENV ?? 'development'];
