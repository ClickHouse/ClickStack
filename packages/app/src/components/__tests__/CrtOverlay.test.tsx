import { render } from '@testing-library/react';

import { CrtOverlay } from '@/components/CrtOverlay';

describe('CrtOverlay', () => {
  it('adds the root class to <html> while mounted and removes it after', () => {
    const { unmount } = render(<CrtOverlay />);
    expect(document.documentElement).toHaveClass('root');

    unmount();
    expect(document.documentElement).not.toHaveClass('root');
  });
});
