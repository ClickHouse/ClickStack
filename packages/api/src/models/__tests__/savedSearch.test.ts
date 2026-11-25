import mongoose from 'mongoose';

import { SavedSearch } from '@/models/savedSearch';

// Mongoose strict mode silently drops paths the schema does not declare, so
// these build documents in memory (no DB) to pin that searchScope survives.
describe('SavedSearch model searchScope', () => {
  const base = {
    team: new mongoose.Types.ObjectId(),
    source: new mongoose.Types.ObjectId(),
    name: 'trace search',
    where: 'ServiceName:frontend',
  };

  it('keeps a Trace scope', () => {
    const doc = new SavedSearch({ ...base, searchScope: 'trace' });
    expect(doc.searchScope).toBe('trace');
    expect(doc.validateSync()).toBeUndefined();
  });

  it('leaves the scope unset for legacy saved searches', () => {
    const doc = new SavedSearch(base);
    expect(doc.searchScope).toBeUndefined();
    expect(doc.validateSync()).toBeUndefined();
  });

  it('rejects an unknown scope', () => {
    const doc = new SavedSearch({ ...base, searchScope: 'session' });
    expect(doc.validateSync()?.errors.searchScope).toBeDefined();
  });
});
