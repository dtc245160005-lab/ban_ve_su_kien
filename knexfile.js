require('dotenv').config();

module.exports = {
  development: {
    client: 'pg',
    connection: process.env.DB_CONNECTION_STRING,
    migrations: {
      directory: './migrations',
    },
    seeds: {
      directory: './seeds',
    },
  },
};
