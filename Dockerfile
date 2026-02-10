FROM oven/bun:debian

WORKDIR /app
COPY package.json bun.lock tsconfig.json .eslintrc.json /app/

RUN apt-get update && apt-get install -y network-manager dbus iputils-ping net-tools openssl ca-certificates
RUN bun install
RUN bun install -g cycletls

COPY src/ /app/src
# COPY scripts/ /app/scripts

EXPOSE 3000

CMD ["bun", "./src/index.ts"]
