-- +goose Up
-- The engines macro adds Replicated inner table engines when the seed is
-- replicated. It must follow SETTINGS: placed before it, ClickHouse ignores
-- allow_experimental_time_series_table and the CREATE fails.
CREATE TABLE IF NOT EXISTS ${DATABASE}.metrics_ts
ENGINE = TimeSeries
SETTINGS allow_experimental_time_series_table = 1${TIMESERIES_ENGINES};
