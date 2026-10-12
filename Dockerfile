# syntax=docker/dockerfile:1

# ---- 1. Build the web app (React + Vite) into server/dist ----
FROM node:24-alpine AS web
WORKDIR /src
COPY package.json package-lock.json ./
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY web web
RUN mkdir -p server/dist && npm run build -w web

# ---- 2. Build the Go server with the site embedded ----
FROM golang:1.26-alpine AS server
WORKDIR /src/server
COPY server/go.mod ./
COPY server/*.go ./
COPY --from=web /src/server/dist ./dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/pieceful .

# ---- 3. Minimal runtime: a single static binary, non-root ----
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /out/pieceful /pieceful
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["/pieceful", "-healthcheck"]
ENTRYPOINT ["/pieceful"]
