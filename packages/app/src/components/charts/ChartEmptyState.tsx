import { Loader } from '@mantine/core';

export default function ChartEmptyState({
  isLoading = false,
}: {
  isLoading?: boolean;
}) {
  return (
    <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
      {isLoading && <Loader size="xs" mr="xs" />}
      {isLoading ? 'Loading Chart Data...' : 'No data found within time range.'}
    </div>
  );
}
