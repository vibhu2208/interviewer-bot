import assert from 'assert';
import { salesforceIdsEqual, toCaseInsensitiveId } from '../src/authorization';
import ids from './test-data/salesforce-ids.json';

const idData = ids.map((i) => ({ full: i, short: i.slice(0, 15) }));

test('toCaseInsensitiveId', () => {
  for (const id of idData) {
    assert.strictEqual(toCaseInsensitiveId(id.short), id.full);
  }
});

test('salesforceIdsEqual - positive', () => {
  const switchLeftAndRight = (left: string, right: string, fn: (left: string, right: string) => void) => {
    fn(left, right);
    fn(right, left);
  };

  for (const id of idData) {
    const pairsToCompare = [
      [id.short, id.short],
      [id.short, id.full],
      [id.short, id.full.toLowerCase()],
      [id.short, id.full.toUpperCase()],
      [id.full, id.full],
      [id.full, id.full.toLowerCase()],
      [id.full, id.full.toUpperCase()],
    ];
    for (const [left, right] of pairsToCompare) {
      switchLeftAndRight(left, right, (l, r) => {
        assert.strictEqual(salesforceIdsEqual(l, r), true, `'${l}' and '${r}' were expected to be equal.`);
      });
    }
  }
});
