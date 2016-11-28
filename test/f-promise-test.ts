import { assert } from 'chai';
import * as fs from 'mz/fs';
import * as fsp from 'path';
import { wait, run } from '..';

describe(module.id, () => {
    it('basic tests', (done) => {
        const p = run(() => {
            const fname = fsp.join(__dirname, 'f-promise-test.ts');
            const text = wait(fs.readFile(fname, 'utf8'));
            assert.typeOf(text, 'string');
            assert.ok(text.length > 200);
            assert.ok(text.indexOf('import') === 0);
            const text2 = wait(fs.readFile(fname, 'utf8'));
            assert.equal(text, text2);
            return 'success';
        });
        p.then(result => {
            assert.equal(result, 'success');
            done();
        }, err => done(err));
    });
});