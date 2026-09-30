require('dotenv').config();
    const knex = require('knex');

    const db = knex({
      client: 'pg',
      connection: process.env.DB_CONNECTION_STRING,
    });

    module.exports = db;