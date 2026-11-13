import {
  collectRefinementIssues,
  validateDashboardVariableReferences,
} from '@hyperdx/common-utils/dist/dashboardValidation';
import { DashboardFilter } from '@hyperdx/common-utils/dist/types';

/**
 * Rejects data source and connection variable references (`$name` in source
 * and connection fields) that name no variable of the right type, or a data
 * source variable offering kinds the field cannot use. Takes internal-shape
 * tiles and filters, as they will be stored, so a partial update can be
 * checked against the stored remainder. Returns an error message, or null.
 */
export function getVariableReferenceError(
  tiles: { config: object }[] = [],
  filters: DashboardFilter[] = [],
): string | null {
  const issues = collectRefinementIssues(ctx =>
    validateDashboardVariableReferences(tiles, filters, ctx),
  );
  return issues.length > 0
    ? issues.map(issue => issue.message).join('; ')
    : null;
}
