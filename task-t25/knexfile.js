require('dotenv').config();

module.exports = {
  development: {
    client: 'pg',
    connection: process.env.DB_CONNECTION_STRING,
    migrations: {
      directory: '../task-t07/migrations',
    },
    seeds: {
      directory: '../task-t07/seeds',
    },
  },
};
