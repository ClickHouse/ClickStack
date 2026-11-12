import { simplifyPattern } from '@/components/Patterns/simplifyPattern';

describe('simplifyPattern', () => {
  it('collapses generalized key=value pairs into one ellipsis', () => {
    expect(
      simplifyPattern(
        'msg="Product found" catalog.brand=<*> <*>.<*>_<*>=<*> <*>.<*>_<*>="<*> <*> <*>" catalog.rating=<*>.<*> grpc.status_code=OK',
      ),
    ).toBe(
      'msg="Product found" catalog.brand=… catalog.rating=… grpc.status_code=OK',
    );
  });

  it('keeps quotes and text around a wildcard run', () => {
    expect(
      simplifyPattern(
        '[2026-04-16T20:<*>:<*>.<*>] "GET /api/products/<*> HTTP/1.1" 200 0 <*> <*> <*> "-" "python-requests/2.32.3" "<*>-<*>-<*>-<*>-<*>" 10.116.<*>.<*>:<*> - -',
      ),
    ).toBe(
      '[2026-04-16T20:…] "GET /api/products/… HTTP/1.1" 200 0 … "-" "python-requests/2.32.3" "…" 10.116.… - -',
    );
  });

  it('leaves patterns without wildcards unchanged', () => {
    expect(simplifyPattern('GetCartAsync called with userId={userId}')).toBe(
      'GetCartAsync called with userId={userId}',
    );
  });
});
