FROM oven/bun:alpine

WORKDIR /app

RUN apk add --no-cache openssl ca-certificates

COPY package.json bun.lock tsconfig.json .eslintrc.json /app/
RUN bun install --frozen-lockfile

COPY src/ /app/src

EXPOSE 3000

CMD ["bun", "./src/index.ts"]
