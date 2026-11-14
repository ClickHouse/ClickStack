import {
  Api500Error,
  BaseError,
  isOperationalError,
  serializeErrorWithCause,
} from '@/utils/errors';

describe('Errors utils', () => {
  test('BaseError class', () => {
    const e = new BaseError('nvim', 500, true, 'is the best editor!!!');
    expect(e.name).toBe('nvim');
    expect(e.statusCode).toBe(500);
    expect(e.isOperational).toBeTruthy();
    expect(e.message).toBe('is the best editor!!!');
    expect(e.stack?.includes('nvim: is the best editor'));
  });

  test('isOperational', () => {
    expect(
      isOperationalError(
        new BaseError('nvim', 500, true, 'is the best editor!!!'),
      ),
    ).toBeTruthy();
    expect(isOperationalError(new Api500Error('BANG'))).toBeTruthy();
  });

  describe('serializeErrorWithCause', () => {
    it('keeps the cause chain that serializeError drops', () => {
      const connectError = Object.assign(
        new Error('connect ECONNREFUSED 10.0.0.1:443'),
        { code: 'ECONNREFUSED' },
      );
      const error = new TypeError('fetch failed', { cause: connectError });

      expect(serializeErrorWithCause(error)).toMatchObject({
        name: 'TypeError',
        message: 'fetch failed',
        cause: {
          message: 'connect ECONNREFUSED 10.0.0.1:443',
          code: 'ECONNREFUSED',
        },
      });
    });

    it("keeps an AggregateError's errors", () => {
      const error = new TypeError('fetch failed', {
        cause: new AggregateError(
          [new Error('connect ETIMEDOUT a'), new Error('connect ETIMEDOUT b')],
          'all attempts failed',
        ),
      });

      expect(serializeErrorWithCause(error)).toMatchObject({
        cause: {
          message: 'all attempts failed',
          errors: [
            { message: 'connect ETIMEDOUT a' },
            { message: 'connect ETIMEDOUT b' },
          ],
        },
      });
    });

    it('stops at a self-referential cause', () => {
      const error = new Error('loop');
      error.cause = error;

      expect(() => serializeErrorWithCause(error)).not.toThrow();
    });

    it('passes non-errors through serializeError', () => {
      expect(serializeErrorWithCause('boom')).toBe('boom');
    });
  });
});
