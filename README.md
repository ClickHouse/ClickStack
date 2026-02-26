
<p align="center">
  <a href="https://clickhouse.com/o11y">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./clickstack.png">
      <img src="./clickstack.png" alt="ClickStack logo" width="256" height="256"/>
    </picture>
  </a>
</p>

# ClickStack

<h3>The open-source observability stack build for OpenTelemetry at scale</h3>

ClickStack is a production-grade observability platform built on ClickHouse that unifies logs, traces, metrics, and sessions into one high-performance solution designed for OpenTelemetry data at scale.

> **This is the parent repository for the ClickStack product and only contains stack-wide artifacts. Raise issues here for stack-wide issues only.** Each of the 3 components of the stack: OpenTelemetry collector, ClickHouse, and the HyperDX UI have [their own repository](#components-and-projects).

## Overview

ClickStack lets developers and SREs trace issues end-to-end without switching tools or manually correlating timestamps and IDs.

![HyperDX landing image](./hyperdx-landing.png)

At the core of ClickStack is a simple but powerful idea: all observability data should be ingested as wide, rich events. These events are stored in ClickHouse tables by data type - logs, traces, metrics, and sessions - but remain fully queryable and cross-correlatable at the database level. ClickStack is built to handle high-cardinality workloads efficiently by leveraging ClickHouse's column-oriented architecture, native JSON support, and fully parallelized execution engine. 

Full documentation for ClickStack can be found [here](https://clickhouse.com/docs/use-cases/observability/clickstack/overview).

## Components and projects

ClickStack consists of three core components, each with its own project:

 - [**HyperDX UI**](https://github.com/hyperdxio/hyperdx/) - A user-friendly interface built for observability. It supports both Lucene-style and SQL queries, interactive dashboards, alerting, trace exploration, and more—all optimized for ClickHouse as the backend.

- [**ClickHouse**](https://github.com/clickhouse/clickhouse) - The high-performance analytical database that serves as the central data store for wide events. ClickHouse powers fast search, filtering, and aggregation at scale, leveraging its columnar engine and native support for JSON.

- **OpenTelemetry collector** - A custom-built collector configured with an opinionated schema optimized for ClickHouse ingestion. It receives logs, metrics, and traces via OpenTelemetry protocols and writes them directly to ClickHouse using efficient batched inserts.

## Useful Links

* [Official website](https://clickhouse.com/o11y) has a quick high-level overview of ClickStack on the main page.
* [ClickHouse Cloud](https://clickhouse.cloud) ClickHouse as a service, with ClickStack included, built by the creators and maintainers.
* [Tutorial](https://clickhouse.com/docs/use-cases/observability/clickstack/getting-started) shows how to set up and get started with ClickStack in minutes.
* [Documentation](https://clickhouse.com/docs/use-cases/observability/clickstack/overview) provides more in-depth information.
* [YouTube channel](https://www.youtube.com/playlist?list=PL0Z2YDlm0b3jeR6u4AFsVC23dnjtT7iKY) has video content for ClickStack.
* [Slack](https://clickhouse.com/slack) and [Telegram](https://telegram.me/clickhouse_en) allow chatting with ClickStack (and ClickHouse) users in real-time. In Slack, find the maintainers in the `#olly-clickstack` group.
* [Blog](https://clickhouse.com/blog/) Clickstack-related articles are published to the Clickhouse blog, as well as announcements and reports about events.
* [Contacts](https://clickhouse.com/company/contact) can help to get your questions answered if there are any.

## How To Install

### Local deployment (for testing)

The simplest option is a single-image distribution that includes all core components of the stack bundled together:

```bash
docker run -p 8080:8080 -p 4317:4317 -p 4318:4318 docker.hyperdx.io/hyperdx/hyperdx-all-in-one
```

See our [getting started guide](https://clickhouse.com/docs/use-cases/observability/clickstack/getting-started) for more details.

### Docker Compose

All ClickStack components are distributed separately as individual Docker images. These images can be combined and deployed locally using Docker Compose.

```bash
git clone https://github.com/hyperdxio/hyperdx.git
cd hyperdx
docker compose up
```
See our [Docker Compose guide](https://clickhouse.com/docs/use-cases/observability/clickstack/deployment/docker-compose) for further details.

### Helm

See the [Helm guide](https://clickhouse.com/docs/use-cases/observability/clickstack/deployment/helm).

Helm chart repository [here](https://github.com/hyperdxio/helm-charts).

### ClickHouse Cloud

ClickStack can be deployed on Clickhouse Cloud, where users benefit from the separation of storage and compute via object storage, enabling low-cost long-term retention. Compute/compete separation allows read and write separation as well, with HyperDxUI integrated into the authentication system of Clickhouse Cloud.

See [guide](https://clickhouse.com/docs/use-cases/observability/clickstack/deployment/hyperdx-clickhouse-cloud).

### Alternative deployment options

Alternative deployment options are listed and described [here](https://clickhouse.com/docs/use-cases/observability/clickstack/deployment).

## Features

The stack includes several key features designed for debugging and root cause analysis:

- Correlate/search logs, metrics, session replays, and traces all in one place
- Schema agnostic, works on top of your existing ClickHouse schema
- Blazing-fast searches & visualizations optimized for ClickHouse
- Intuitive full-text search and property search syntax (ex. `level:err`), SQL optional.
- Analyze trends in anomalies with event deltas
- Set up alerts in just a few clicks
- Dashboard high cardinality events without a complex query language
- Native JSON string querying
- Live tail logs and traces to always get the freshest events
- OpenTelemetry (OTel) supported out of the box
- Monitor health and performance from HTTP requests to DB queries (APM)
- Event deltas for identifying anomalies and performance regressions
- Log pattern recognition

## Principles

ClickStack is designed with a set of core principles that prioritize ease of use, performance, and flexibility at every layer of the observability stack:

### Easy to set up in minutes 

ClickStack works out of the box with any ClickHouse instance and schema, requiring minimal configuration. Whether you're starting fresh or integrating with an existing setup, you can be up and running in minutes.

### User-friendly and purpose-built

The HyperDX UI supports both SQL and Lucene-style syntax, allowing users to choose the query interface that fits their workflow. Purpose-built for observability, the UI is optimized to help teams identify root causes quickly and navigate complex data without friction.

### End-to-end observability 

ClickStack provides full-stack visibility, from front-end user sessions to backend infrastructure metrics, application logs, and distributed traces. This unified view enables deep correlation and analysis across the entire system.

### Built for ClickHouse

Every layer of the stack is designed to make full use of ClickHouse's capabilities. Queries are optimized to leverage ClickHouse's analytical functions and columnar engine, ensuring fast search and aggregation over massive volumes of data.

### OpenTelemetry-native 

ClickStack is natively integrated with OpenTelemetry, ingesting all data through an OpenTelemetry collector endpoint. For advanced users, it also supports direct ingestion into ClickHouse using native file formats, custom pipelines, or third-party tools like Vector.

### Open source and fully customizable

ClickStack is fully open source and can be deployed anywhere. The schema is flexible and user-modifiable, and the UI is designed to be configurable to custom schemas without requiring changes. All components—including collectors, ClickHouse, and the UI - can be scaled independently to meet ingestion, query, or storage demands.

## Architectural overview

A full architectural diagram and deployment details can be found in [Architecture documentation](https://clickhouse.com/docs/use-cases/observability/clickstack/architecture).

## Licenses

ClickStack is fully open-source licensed. Users can find the licenses for each of the sub-projects in their respective repositories. In summary:

- [ClickHouse - Apache 2.0](https://github.com/ClickHouse/ClickHouse/blob/master/LICENSE)
- [HyperDX - MIT License](https://github.com/hyperdxio/hyperdx/blob/main/LICENSE)
- OpenTelemetry Collector - Apache 2.0
