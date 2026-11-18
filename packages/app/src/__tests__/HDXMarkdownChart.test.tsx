import React from 'react';
import { screen } from '@testing-library/react';

import HDXMarkdownChart from '@/HDXMarkdownChart';

jest.mock('@/hooks/useOnClickLinkBuilder', () => ({
  usePageLinkContext: () => ({
    timeZone: 'UTC',
    currentFilters: [{ type: 'variable', name: 'env', values: ['prod'] }],
  }),
}));

const service = { name: 'service', values: ['api', 'web'] };

describe('HDXMarkdownChart', () => {
  it('expands link globals when given a date range', () => {
    renderWithMantine(
      <HDXMarkdownChart
        config={{
          markdown:
            '[Details](/dashboards/abc?$__url_time_range&$__all_variables)',
        }}
        dateRange={[new Date(1000), new Date(2000)]}
      />,
    );
    const text = screen.getByText(/^\[Details\]/).textContent!;
    const params = new URLSearchParams(text.slice(text.indexOf('?') + 1, -1));
    expect(params.get('from')).toBe('1000');
    expect(params.get('to')).toBe('2000');
    expect(JSON.parse(decodeURIComponent(params.get('filters')!))).toEqual([
      { type: 'variable', name: 'env', values: ['prod'] },
    ]);
  });

  it('leaves link globals as written without a date range', () => {
    renderWithMantine(<HDXMarkdownChart config={{ markdown: '$__from' }} />);
    expect(screen.getByText('$__from')).toBeInTheDocument();
  });

  it('substitutes variable references', () => {
    renderWithMantine(
      <HDXMarkdownChart
        config={{ markdown: '# Services: $service' }}
        variables={[service]}
      />,
    );
    expect(screen.getByText('# Services: api, web')).toBeInTheDocument();
  });

  it('renders the markdown as written without variables', () => {
    renderWithMantine(
      <HDXMarkdownChart config={{ markdown: '# Services: $service' }} />,
    );
    expect(screen.getByText('# Services: $service')).toBeInTheDocument();
  });

  it('renders the markdown as written when a format is unknown', () => {
    renderWithMantine(
      <HDXMarkdownChart
        config={{ markdown: '${service:nope}' }}
        variables={[service]}
      />,
    );
    expect(screen.getByText('${service:nope}')).toBeInTheDocument();
  });

  it('flags a reference to an unknown variable', () => {
    renderWithMantine(
      <HDXMarkdownChart
        config={{ markdown: '$service $nope' }}
        variables={[service]}
      />,
    );
    expect(screen.getByTestId('variable-validation')).toHaveAccessibleName(
      'Markdown references unknown variable $nope. Available variables: service.',
    );
  });

  it('checks references against the available names when given', () => {
    renderWithMantine(
      <HDXMarkdownChart
        config={{ markdown: '$service $env' }}
        variables={[service]}
        availableVariableNames={['service', 'env']}
      />,
    );
    expect(screen.queryByTestId('variable-validation')).not.toBeInTheDocument();
  });

  it('flags nothing when every reference is known', () => {
    renderWithMantine(
      <HDXMarkdownChart
        config={{ markdown: '$service' }}
        variables={[service]}
      />,
    );
    expect(screen.queryByTestId('variable-validation')).not.toBeInTheDocument();
  });

  it('flags nothing without variables', () => {
    renderWithMantine(<HDXMarkdownChart config={{ markdown: '$nope' }} />);
    expect(screen.queryByTestId('variable-validation')).not.toBeInTheDocument();
  });
});
