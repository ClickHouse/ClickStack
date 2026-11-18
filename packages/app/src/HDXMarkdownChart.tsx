import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { getLinkTemplateGlobals } from '@hyperdx/common-utils/dist/core/linkUrlBuilder';
import { ChartVariable } from '@hyperdx/common-utils/dist/types';
import {
  substituteVariables,
  validateVariableReferencesInTemplate,
} from '@hyperdx/common-utils/dist/variables';

import ChartContainer from './components/charts/ChartContainer';
import {
  hasVariableIssues,
  VariableIssueIndicator,
} from './components/SQLEditor/variableValidation';
import { usePageLinkContext } from './hooks/useOnClickLinkBuilder';

const HDXMarkdownChart = memo(
  ({
    config: { markdown },
    title,
    toolbarItems,
    variables: referencedVariables,
    availableVariableNames,
    dateRange,
  }: {
    title?: React.ReactNode;
    toolbarItems?: React.ReactNode[];
    config: {
      markdown?: string;
    };
    /** The variables to substitute. Limited to the ones this chart references. */
    variables?: ChartVariable[];
    /** Every variable name in scope, for flagging unknown references. */
    availableVariableNames?: string[];
    /** Enables the `$__from`, `$__url_time_range`, ... link globals. */
    dateRange?: [Date, Date];
  }) => {
    const pageLinkContext = usePageLinkContext();

    const textMacros = useMemo(() => {
      if (!dateRange) return undefined;
      const { values, fragments } = getLinkTemplateGlobals({
        ...pageLinkContext,
        dateRange,
      });
      // `$__from` is scanned as macro `from`, so drop the `__` prefix.
      return new Map(
        Object.entries({ ...values, ...fragments }).map(([name, value]) => [
          name.slice(2),
          String(value),
        ]),
      );
    }, [dateRange, pageLinkContext]);

    const content = useMemo(() => {
      if (!markdown || (referencedVariables == null && !textMacros)) {
        return markdown ?? '';
      }
      try {
        return substituteVariables(markdown, {
          variables: referencedVariables ?? [],
          inputLanguage: 'markdown',
          textMacros,
        });
      } catch {
        // An unknown `${name:format}` throws; show the markdown as written.
        return markdown;
      }
    }, [markdown, referencedVariables, textMacros]);

    const toolbar = useMemo(() => {
      const names =
        availableVariableNames ??
        referencedVariables?.map(variable => variable.name);

      // Without variables in scope nothing is substituted, so a `$word` is prose.
      if (!markdown || !names?.length) return toolbarItems;

      // Only names are checked for markdown, so the selections don't matter.
      const allVariables = names.map(name => ({ name, values: [] }));
      const issues = validateVariableReferencesInTemplate(
        markdown,
        allVariables,
        {
          subject: 'Markdown',
          language: 'markdown',
        },
      );
      if (!hasVariableIssues(issues)) return toolbarItems;

      return [
        <VariableIssueIndicator key="variable-issues" issues={issues} />,
        ...(toolbarItems ?? []),
      ];
    }, [markdown, availableVariableNames, referencedVariables, toolbarItems]);

    return (
      <ChartContainer
        title={title}
        toolbarItems={toolbar}
        disableReactiveContainer
      >
        <div className="hdx-markdown">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      </ChartContainer>
    );
  },
);

export default HDXMarkdownChart;
