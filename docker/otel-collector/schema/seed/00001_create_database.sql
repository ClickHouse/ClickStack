-- +goose Up
-- +goose NO TRANSACTION
-- The engine macro is empty unless HYPERDX_OTEL_EXPORTER_CLICKHOUSE_REPLICATED
-- applies, then it is " ENGINE = Replicated(...)" (see processSchemaDir).
CREATE DATABASE IF NOT EXISTS ${DATABASE}${DATABASE_ENGINE};
