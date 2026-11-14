#!/usr/bin/env bash
# Boots an all-in-one image and proves it actually runs.
#
# Default (full) mode — for the noauth/Local image, which accepts OTLP without
# an API key: boot, wait for /api/health, push one OTLP log through the bundled
# collector, and assert it lands in ClickHouse. End-to-end ingest of the
# artefact we ship.
#
# --health-only mode — for the auth all-in-one image, which gates ingestion
# behind an INGESTION_API_KEY bootstrap so the collector never opens a keyless
# OTLP receiver (see docker/hyperdx/entry.local.base.sh). A keyless OTLP canary
# cannot work there, so instead: boot, wait for /api/health, and assert
# ClickHouse is up inside the container. The OTLP port is not mapped in this mode.
#
# --promql-mcp mode — for the auth all-in-one image with PromQL on: boot with an
# INGESTION_API_KEY, push one OTLP gauge through the bundled collector's
# Prometheus remote-write into default.metrics_ts, register a user, add a
# PromQL source, and query the gauge over MCP with clickstack_promql and a saved
# PromQL tile. Needs jq.
set -euo pipefail

IMAGE="${1:?usage: smoke-all-in-one.sh <image-ref> [--health-only|--promql-mcp]}"
MODE="${2:-full}"

HEALTH_ONLY=0
PROMQL_MCP=0
case "$MODE" in
  --health-only) HEALTH_ONLY=1 ;;
  --promql-mcp) PROMQL_MCP=1 ;;
  full) ;;
  *)
    echo "::error::unknown mode '$MODE' (expected --health-only, --promql-mcp or nothing)"
    exit 2
    ;;
esac

NAME="hdx-smoke-$$"
APP_PORT="${SMOKE_APP_PORT:-18080}"
OTLP_PORT="${SMOKE_OTLP_PORT:-14318}"

COOKIES="$(mktemp)"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -f "$COOKIES"
}
trap cleanup EXIT

# Pull with a small retry so a transient registry hiccup can't flake the release
# gate (docker run would otherwise pull implicitly, with no retry). Skip the pull
# when the image is already in the local daemon — the PR build loads its image
# with `load: true` and never pushes it, so a `docker pull` would hit the
# registry and fail for a tag that only exists locally.
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "using locally-loaded image $IMAGE (skipping pull)"
else
  for attempt in 1 2 3; do
    docker pull "$IMAGE" && break
    if [ "$attempt" = 3 ]; then
      echo "::error::failed to pull $IMAGE after 3 attempts"; exit 1
    fi
    echo "pull failed (attempt $attempt/3), retrying in 5s..."; sleep 5
  done
fi

INGESTION_KEY="smoke-ingestion-key-$$"
if [ "$HEALTH_ONLY" = 1 ]; then
  docker run -d --name "$NAME" -p "$APP_PORT:8080" "$IMAGE"
elif [ "$PROMQL_MCP" = 1 ]; then
  docker run -d --name "$NAME" -p "$APP_PORT:8080" -p "$OTLP_PORT:4318" \
    -e ENABLE_PROMQL=true -e INGESTION_API_KEY="$INGESTION_KEY" "$IMAGE"
else
  docker run -d --name "$NAME" -p "$APP_PORT:8080" -p "$OTLP_PORT:4318" "$IMAGE"
fi

echo "waiting for app health..."
for i in $(seq 1 90); do
  # Fail fast if the container exited (bad entrypoint, port clash, missing env)
  # instead of polling a dead container for the full timeout.
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != "true" ]; then
    echo "::error::container exited during startup"; docker logs "$NAME" --tail 200; exit 1
  fi
  curl -fsS "http://localhost:$APP_PORT/api/health" >/dev/null 2>&1 && break
  if [ "$i" = 90 ]; then
    echo "::error::app never became healthy"; docker logs "$NAME" --tail 100; exit 1
  fi
  sleep 2
done
echo "app healthy"

if [ "$HEALTH_ONLY" = 1 ]; then
  echo "waiting for ClickHouse..."
  for i in $(seq 1 45); do
    ok="$(docker exec "$NAME" clickhouse-client --query "SELECT 1" 2>/dev/null || echo 0)"
    if [ "${ok:-0}" = 1 ]; then
      echo "health-only smoke passed: app healthy + clickhouse up"
      exit 0
    fi
    if [ "$i" = 45 ]; then
      echo "::error::clickhouse never came up"; docker logs "$NAME" --tail 200; exit 1
    fi
    sleep 2
  done
fi

if [ "$PROMQL_MCP" = 1 ]; then
  API="http://localhost:$APP_PORT/api"
  CANARY="smoke-promql-$(date +%s)-$$"
  # To stderr: fail also runs inside $(mcp ...), which captures stdout.
  fail() {
    echo "::error::$1" >&2; docker logs "$NAME" --tail 200 >&2; exit 1
  }

  # Registering also provisions the team's default "Local ClickHouse" connection.
  curl -fsS -c "$COOKIES" -X POST "$API/register/password" \
    -H 'Content-Type: application/json' \
    -d '{"email":"smoke@example.com","password":"Smoke-Password-1!","confirmPassword":"Smoke-Password-1!"}' \
    >/dev/null || fail "registration failed"
  curl -sS -b "$COOKIES" -c "$COOKIES" -o /dev/null -X POST "$API/login/password" \
    -H 'Content-Type: application/json' \
    -d '{"email":"smoke@example.com","password":"Smoke-Password-1!"}'
  ACCESS_KEY="$(curl -fsS -b "$COOKIES" "$API/me" | jq -r '.accessKey // empty')"
  [ -n "$ACCESS_KEY" ] || fail "no access key after login"
  CONNECTION_ID="$(curl -fsS -b "$COOKIES" "$API/connections" | jq -r '.[0].id // empty')"
  [ -n "$CONNECTION_ID" ] || fail "no default connection"
  SOURCE_ID="$(curl -fsS -b "$COOKIES" -X POST "$API/sources" \
    -H 'Content-Type: application/json' \
    -d "{\"kind\":\"promql\",\"name\":\"PromQL\",\"connection\":\"$CONNECTION_ID\",\"from\":{\"databaseName\":\"default\",\"tableName\":\"metrics_ts\"},\"timestampValueExpression\":\"timestamp\"}" \
    | jq -r '.id // empty')"
  [ -n "$SOURCE_ID" ] || fail "could not create a PromQL source"

  # The collector picks up INGESTION_API_KEY over OpAMP and batches its
  # remote-write, so keep sending a fresh sample until one is in the table.
  echo "sending OTLP gauge until it reaches default.metrics_ts..."
  for i in $(seq 1 60); do
    PAYLOAD="{\"resourceMetrics\":[{\"resource\":{\"attributes\":[{\"key\":\"service.name\",\"value\":{\"stringValue\":\"ci-smoke\"}}]},\"scopeMetrics\":[{\"metrics\":[{\"name\":\"smoke_promql_gauge\",\"gauge\":{\"dataPoints\":[{\"timeUnixNano\":\"$(date +%s)000000000\",\"asDouble\":1,\"attributes\":[{\"key\":\"canary\",\"value\":{\"stringValue\":\"$CANARY\"}}]}]}}]}]}]}"
    curl -fsS -X POST "http://localhost:$OTLP_PORT/v1/metrics" \
      -H 'Content-Type: application/json' -H "Authorization: $INGESTION_KEY" \
      -d "$PAYLOAD" >/dev/null 2>&1 || true
    n="$(docker exec "$NAME" clickhouse-client --allow_experimental_time_series_table=1 --query \
      "SELECT count() FROM timeSeriesTags(default, metrics_ts) WHERE metric_name = 'smoke_promql_gauge' AND tags['canary'] = '$CANARY'" 2>/dev/null || echo 0)"
    n="${n//[!0-9]/}"
    [ "${n:-0}" -ge 1 ] && break
    [ "$i" = 60 ] && fail "the gauge never reached default.metrics_ts"
    sleep 2
  done
  echo "gauge remote-written: collector -> clickhouse metrics_ts"

  # Prints a tool's result text; fails on an MCP or tool error.
  mcp() {
    local response text
    response="$(curl -fsS "$API/mcp" \
      -H "Authorization: Bearer $ACCESS_KEY" \
      -H 'Content-Type: application/json' \
      -H 'Accept: application/json, text/event-stream' \
      -d "$(jq -nc --arg tool "$1" --argjson args "$2" \
        '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:$tool,arguments:$args}}')")" \
      || fail "$1: request failed"
    # Streamable HTTP answers with one SSE event or a JSON body.
    response="$(printf '%s\n' "$response" | sed -n 's/^data: //p' | grep . || printf '%s' "$response")"
    text="$(jq -r '.result.content[0].text // .error.message' <<<"$response")"
    [ "$(jq -r '.result.isError // false' <<<"$response")" = false ] || fail "$1: $text"
    printf '%s' "$text"
  }

  SELECTOR="smoke_promql_gauge{canary=\"$CANARY\"}"
  rows="$(mcp clickstack_promql "$(jq -nc --arg s "$SOURCE_ID" --arg e "$SELECTOR" \
    '{sourceId:$s,expression:$e}')" | jq '.result.data | length')"
  [ "${rows:-0}" -ge 1 ] || fail "clickstack_promql returned no rows"
  echo "clickstack_promql returned $rows rows"

  DASHBOARD_ID="$(mcp clickstack_save_dashboard "$(jq -nc --arg s "$SOURCE_ID" --arg e "$SELECTOR" \
    '{name:"PromQL smoke",tiles:[{name:"Gauge",config:{configType:"promql",displayType:"line",sourceId:$s,expressions:[{expression:$e}]}}]}')" \
    | jq -r '.id')"
  tile="$(mcp clickstack_query_tiles "$(jq -nc --arg d "$DASHBOARD_ID" '{dashboardId:$d}')" \
    | jq -c '.tiles[0]')"
  [ "$(jq -r '.status == "ok" and .hasData == true' <<<"$tile")" = true ] \
    || fail "PromQL tile did not return data: $tile"
  echo "promql-mcp smoke passed: OTLP -> metrics_ts -> clickstack_promql and a PromQL tile over MCP"
  exit 0
fi

CANARY="smoke-canary-$(date +%s)-$$"
NOW_NS="$(date +%s)000000000"
PAYLOAD="{\"resourceLogs\":[{\"resource\":{\"attributes\":[{\"key\":\"service.name\",\"value\":{\"stringValue\":\"ci-smoke\"}}]},\"scopeLogs\":[{\"logRecords\":[{\"timeUnixNano\":\"$NOW_NS\",\"severityText\":\"INFO\",\"body\":{\"stringValue\":\"$CANARY\"}}]}]}]}"

# The Node app reports /api/health before the separately-supervised collector's
# :4318 receiver is necessarily listening, so retry the POST until it's accepted
# rather than aborting on a transient connection-refused (which would false-fail
# the release gate).
echo "sending canary (collector may still be starting)..."
for i in $(seq 1 45); do
  if curl -fsS -X POST "http://localhost:$OTLP_PORT/v1/logs" \
       -H 'Content-Type: application/json' -d "$PAYLOAD" >/dev/null 2>&1; then
    echo "canary sent"
    break
  fi
  if [ "$i" = 45 ]; then
    echo "::error::collector never accepted the OTLP canary on :$OTLP_PORT"
    docker logs "$NAME" --tail 200; exit 1
  fi
  sleep 2
done

echo "waiting for canary in ClickHouse..."
for i in $(seq 1 45); do
  n="$(docker exec "$NAME" clickhouse-client --query \
    "SELECT count() FROM default.otel_logs WHERE Body LIKE '%$CANARY%'" 2>/dev/null || echo 0)"
  n="${n//[!0-9]/}"
  if [ "${n:-0}" -ge 1 ]; then
    echo "canary ingested end-to-end: collector -> clickhouse"
    exit 0
  fi
  sleep 2
done
echo "::error::canary never arrived in ClickHouse"
docker logs "$NAME" --tail 200
exit 1
