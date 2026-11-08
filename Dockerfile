FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN yarn build

ENV PORT=8080
ENV DATA_DIR=/tmp/sqlite-fts
EXPOSE 8080

CMD ["yarn", "start"]
