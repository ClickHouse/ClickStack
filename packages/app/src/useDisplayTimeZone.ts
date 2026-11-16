import { useMemo } from 'react';
import { isRawSqlChartConfig } from '@hyperdx/common-utils/dist/guards';
import { hasMacro } from '@hyperdx/common-utils/dist/macros';
import { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/types';

import { getLocalTimeZone, resolveTimeZonePreference } from './timeZone';
import { useTimeZoneOverride } from './timeZoneOverride';
import { useUserPreferences } from './useUserPreferences';

/**
 * IANA time zone that times are shown and typed in, or undefined for the
 * local zone. The page's override wins over the user's setting.
 */
export function useDisplayTimeZone(): string | undefined {
  const {
    userPreferences: { timeZone },
  } = useUserPreferences();

  const override = useTimeZoneOverride()?.timeZone;

  return useMemo(
    () => resolveTimeZonePreference(override ?? timeZone),
    [override, timeZone],
  );
}

/**
 * Adds the display time zone to a raw SQL config that reads `${__timezone}`.
 * Other configs are returned as is, so a zone change doesn't refetch them.
 */
export function useWithDisplayTimeZone<T extends ChartConfigWithOptDateRange>(
  config: T,
): T {
  const timeZone = useDisplayTimeZone() ?? getLocalTimeZone();
  return useMemo(() => {
    try {
      return isRawSqlChartConfig(config) &&
        hasMacro(config.sqlTemplate, 'timezone')
        ? { ...config, timeZone }
        : config;
    } catch {
      // A half-typed macro; rendering reports it.
      return config;
    }
  }, [config, timeZone]);
}
