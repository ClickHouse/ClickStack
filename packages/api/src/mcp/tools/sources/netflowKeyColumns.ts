import type { TNetflowSource } from '@hyperdx/common-utils/dist/types';

/** The flow column mappings that list_sources and describe_source report for a NetFlow source. */
export function getNetflowKeyColumns(source: TNetflowSource) {
  return {
    bytes: source.bytesExpression,
    packets: source.packetsExpression,
    samplingRate: source.samplingRateExpression,
    srcAddr: source.srcAddrExpression,
    dstAddr: source.dstAddrExpression,
    srcPort: source.srcPortExpression,
    dstPort: source.dstPortExpression,
    protocol: source.protocolExpression,
    exporter: source.exporterExpression,
    inIf: source.inIfExpression,
    outIf: source.outIfExpression,
  };
}
