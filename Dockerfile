FROM node:20-bookworm-slim AS dependencies

WORKDIR /app

# Cai cong cu can thiet cho argon2 / node-gyp
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

ENV npm_config_nodedir=/usr/local

COPY package*.json ./

RUN npm ci --omit=dev


FROM node:20-bookworm-slim

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

ARG APP_REVISION=unknown
ENV APP_REVISION=$APP_REVISION

EXPOSE 8090

CMD ["npm", "start"]
