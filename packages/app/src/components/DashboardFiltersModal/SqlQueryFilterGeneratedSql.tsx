import { SQLPreview } from '@/components/ChartSQLPreview';
import { QueryPreviewAccordion } from '@/components/DBEditTimeChartForm/QueryPreviewAccordion';
import {
  SqlQueryFilterPreviewOptions,
  useSqlQueryFilterGeneratedSql,
} from '@/hooks/useSqlQueryFilterGeneratedSql';

/** The previewed SQL with variables and macros filled in. */
export const SqlQueryFilterGeneratedSql = (
  props: SqlQueryFilterPreviewOptions,
) => {
  const { data: sql } = useSqlQueryFilterGeneratedSql(props);

  if (sql == null) {
    return null;
  }

  return (
    <div data-testid="filter-sql-generated-sql">
      {/* Flush with the form's other fields */}
      <QueryPreviewAccordion
        value="generated-sql"
        label="Generated SQL"
        variant="noPadding"
      >
        <SQLPreview
          data={sql}
          enableCopy
          copyButtonSize="xs"
          enableLineWrapping
        />
      </QueryPreviewAccordion>
    </div>
  );
};
