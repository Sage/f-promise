/// <reference path="../node_modules/streamline-node/index.d.ts" />
import { _ } from 'streamline-runtime';
import { assert } from 'chai';
import * as fs from 'fs';
import * as mzfs from 'mz/fs';
import * as fsp from 'path';
import { wait, wait_, run, withContext, context, Queue, map } from '..';

const { ok, equal, deepEqual, strictEqual, typeOf } = assert;

function test(name: string, fn: () => void) {
    it(name, (done) => {
        run(() => (fn(), undefined)).then(done, done);
    });
}

function delay<T>(val: T, millis?: number) {
    return wait<T>(cb => {
        setTimeout(() => {
            cb(null, val);
        }, millis || 0);
    })
}
describe(module.id, () => {
    it('promise wait', (done) => {
        const p = run(() => {
            const fname = fsp.join(__dirname, '../../test/f-promise-test.ts');
            const text = wait(mzfs.readFile(fname, 'utf8'));
            typeOf(text, 'string');
            ok(text.length > 200);
            ok(text.indexOf('/// <reference ') === 0);
            const text2 = wait(mzfs.readFile(fname, 'utf8'));
            equal(text, text2);
            return 'success';
        });
        p.then(result => {
            equal(result, 'success');
            done();
        }, err => done(err));
    });

    it('callback wait', (done) => {
        const p = run(() => {
            const fname = fsp.join(__dirname, '../../test/f-promise-test.ts');
            const text = wait<string>(cb => fs.readFile(fname, 'utf8', cb));
            typeOf(text, 'string');
            ok(text.length > 200);
            ok(text.indexOf('/// <reference ') === 0);
            const text2 = wait<string>(cb => fs.readFile(fname, 'utf8', cb));
            equal(text, text2);
            return 'success';
        });
        p.then(result => {
            equal(result, 'success');
            done();
        }, err => done(err));
    });

    it('streamline wait', (done) => {
        const p = run(() => {
            const fname = fsp.join(__dirname, '../../test/f-promise-test.ts');
            const text = wait_(_ => fs.readFile(fname, 'utf8', _));
            typeOf(text, 'string');
            ok(text.length > 200);
            ok(text.indexOf('/// <reference ') === 0);
            const text2 = wait_<string>(_ => fs.readFile(fname, 'utf8', _));
            equal(text, text2);
            return 'success';
        });
        p.then(result => {
            equal(result, 'success');
            done();
        }, err => done(err));
    });

    test("contexts", () => {
        function testContext(x: number) {
            return withContext(() => {
                var y = delay(2 * x);
                strictEqual(y, 2 * context());
                return y + 1;
            }, x)
        }

        var promises = [run(() => testContext(3)), run(() => testContext(5))];
        deepEqual(promises.map(wait), [7, 11]);
    })

    test("queue overflow", () => {
        var queue = new Queue(2);
        // must produce and consume in parallel to avoid deadlock
        var produce = run(() => {
            queue.write(4);
            queue.write(9);
            queue.write(16);
            queue.write(25);
        });
        var consume = run(() => {
            strictEqual(queue.read(), 4);
            strictEqual(queue.read(), 9);
            strictEqual(queue.read(), 16);
            strictEqual(queue.read(), 25);
        });
        wait(produce);
        wait(consume);
        strictEqual(queue.peek(), undefined);
    });

    test("queue length, contents, alter", () => {
        var queue = new Queue();
        queue.write(4);
        queue.write(9);
        queue.write(16);
        queue.write(25);
        strictEqual(queue.length, 4);
        strictEqual(queue.peek(), 4);
        deepEqual(queue.contents(), [4, 9, 16, 25]);
        queue.adjust(function(arr) {
            return [arr[3], arr[1]];
        });
        strictEqual(queue.peek(), 25);
        strictEqual(queue.read(), 25);
        strictEqual(queue.peek(), 9);
        strictEqual(queue.read(), 9);
        strictEqual(queue.peek(), undefined);
    });

    describe('collection functions', () => {
        it('map', (done) => {
            run(() => {
                deepEqual(map([2, 5], delay), [2, 5]);
                return 'success';
            }).then(result => {
                equal(result, 'success');
                done();
            }, err => done(err));
        });
    });
});