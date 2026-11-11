import { fireEvent, screen } from '@testing-library/react';

import { DenoiseSummary } from '@/components/DenoiseSummary';

describe('DenoiseSummary', () => {
  const base = {
    sampledRowCount: 100,
    skipped: undefined,
    bodyExpression: 'Body',
    isLoading: false,
  };

  it('summarizes hidden patterns and lists them on demand', () => {
    renderWithMantine(
      <DenoiseSummary
        {...base}
        noisyPatterns={[
          { pattern: 'Browsing product', count: 30 },
          { pattern: 'user <*> <*> logged in', count: 10 },
          { pattern: 'user <*> logged in', count: 12 },
        ]}
      />,
    );
    expect(
      screen.getByText(
        'Hiding 2 common patterns, about 52% of events. Errors and warnings are never hidden.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show patterns' }));
    expect(screen.getByText('user … logged in')).toBeInTheDocument();
    expect(screen.getByText('22%')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
  });

  it('says when it is still loading', () => {
    renderWithMantine(
      <DenoiseSummary {...base} isLoading noisyPatterns={[]} />,
    );
    expect(screen.getByText('Finding common patterns…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('explains why results were not denoised', () => {
    renderWithMantine(
      <DenoiseSummary
        {...base}
        skipped="body_not_in_results"
        noisyPatterns={[]}
      />,
    );
    expect(
      screen.getByText('Add Body to the table columns to denoise results.'),
    ).toBeInTheDocument();
  });
});
