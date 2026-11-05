import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(new URL('../package.json', import.meta.url));
test('DSH can resolve exported manifest and localized plugin inventory metadata', () => {
  const pkg = require('dsh-room-world/package.json');
  assert.ok(pkg.description.includes('房间'));
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  for (const language of ['en', 'zh']) {
    const meta = JSON.parse(fs.readFileSync(require.resolve('dsh-room-world/locale/' + language + '.json'), 'utf8')).meta;
    assert.ok(meta.title && meta.description);
    if (language === 'zh') assert.equal(meta.title, '大肥鱼 · 房间与小天地');
  }
});
