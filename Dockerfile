FROM golang:1.27-alpine AS build
RUN apk add --no-cache build-base
WORKDIR /src
COPY go.mod go.sum* ./
RUN if [ -f go.sum ]; then go mod download; else go mod download; fi
COPY local ./local
RUN CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/expenseflow ./local

FROM alpine:3.24
RUN addgroup -S expenseflow && adduser -S -G expenseflow expenseflow \
    && mkdir -p /app/data/backups /app/web /app/db/migrations \
    && chown -R expenseflow:expenseflow /app
WORKDIR /app
COPY --from=build /out/expenseflow /app/expenseflow
COPY web /app/web
COPY db /app/db
USER expenseflow
EXPOSE 8787
ENV EXPENSEFLOW_ADDR=0.0.0.0:8787 \
    EXPENSEFLOW_DB=/app/data/expenseflow.db \
    EXPENSEFLOW_WEB_DIR=/app/web \
    EXPENSEFLOW_MIGRATIONS=/app/db/migrations \
    EXPENSEFLOW_BACKUP_DIR=/app/data/backups
VOLUME ["/app/data"]
ENTRYPOINT ["/app/expenseflow"]
