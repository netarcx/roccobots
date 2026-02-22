FROM oven/bun:debian

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock tsconfig.json .eslintrc.json /app/
RUN bun install --frozen-lockfile --production

COPY src/ /app/src

EXPOSE 3000

CMD ["bun", "./src/index.ts"]
