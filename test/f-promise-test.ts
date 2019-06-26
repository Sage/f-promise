// tslint:disable:no-reference
import { assert } from 'chai';
import * as fs from 'fs';
import * as mzfs from 'mz/fs';
import * as fsp from 'path';
import { canWait, context, eventHandler, funnel, handshake, map, Queue, run, sleep, wait, withContext } from '..';

const {
    ok,
    notOk,
    equal,
    notEqual,
    deepEqual,
    strictEqual,
    closeTo,
    fail,
    typeOf,
    isNull,
    isNotNull,
    isUndefined,
    isObject,
    throws,
} = assert;

function test(name: string, fn: () => void) {
    it(name, done => {
        run(() => (fn(), undefined)).then(done, done);
    });
}

function delay<T>(val: T, millis?: number) {
    return wait<T>(cb => {
        setTimeout(() => {
            cb(null, val);
        }, millis || 0);
    });
}

function sum(array: (number | undefined)[]): number {
    return array.reduce<number>((sum, x) => sum + (x || 0), 0);
}

describe('wait', () => {
    it('promise wait with success', done => {
        const p = run(() => {
            const fname = fsp.join(__dirname, '../../test/f-promise-test.ts');
            const text = wait(mzfs.readFile(fname, 'utf8'));
            typeOf(text, 'string');
            ok(text.length > 200);
            ok(text.indexOf('// tslint') === 0);
            const text2 = wait(mzfs.readFile(fname, 'utf8'));
            equal(text, text2);
            return 'success';
        });
        p.then(result => {
            equal(result, 'success');
            done();
        }, done);
    });
    it('promise wait with error', done => {
        const p = run(() => {
            const fname = fsp.join(__dirname, '../../test/f-promise-test.ts.not.exist');
            wait(mzfs.readFile(fname, 'utf8'));
        });
        p.then(
            result => {
                fail();
                done();
            },
            e => {
                done();
            },
        );
    });
    it('callback wait with success', done => {
        const p = run(() => {
            const fname = fsp.join(__dirname, '../../test/f-promise-test.ts');
            const text = wait<string>(cb => fs.readFile(fname, 'utf8', cb));
            typeOf(text, 'string');
            ok(text.length > 200);
            ok(text.indexOf('// tslint') === 0);
            const text2 = wait<string>(cb => fs.readFile(fname, 'utf8', cb));
            equal(text, text2);
            return 'success';
        });
        p.then(result => {
            equal(result, 'success');
            done();
        }, done);
    });
    it('callback wait with error', done => {
        const p = run(() => {
            const fname = fsp.join(__dirname, '../../test/f-promise-test.ts.not.exist');
            wait<string>(cb => fs.readFile(fname, 'utf8', cb));
        });
        p.then(
            result => {
                fail();
                done();
            },
            e => {
                done();
            },
        );
    });
    it('wait into a callback wait', done => {
        const p = run(() => {
            wait(cb => {
                wait(_cb => process.nextTick(_cb));
                cb(null, null);
            });
        });
        p.then(done, done);
    });
});

describe('queue', () => {
    test('queue overflow', () => {
        const queue = new Queue<number>(2);
        // must produce and consume in parallel to avoid deadlock
        const produce = run(() => {
            queue.write(4);
            queue.write(9);
            queue.write(16);
            queue.write(25);
        });
        const consume = run(() => {
            strictEqual(queue.read(), 4);
            strictEqual(queue.read(), 9);
            strictEqual(queue.read(), 16);
            strictEqual(queue.read(), 25);
        });
        wait(produce);
        wait(consume);
        strictEqual(queue.peek(), undefined);
    });

    test('queue length, contents, alter', () => {
        const queue = new Queue<number>();
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
});

describe('handshake', () => {
    test('notify without wait', () => {
        const hk = handshake();
        hk.notify();
        hk.notify();
    });
    test('wait then notify', () => {
        const hk = handshake();
        let counter = 0;

        function runSleepAndCount() {
            run(() => {
                sleep(10);
                counter++;
                hk.notify();
            });
        }

        equal(counter, 0);
        runSleepAndCount();
        hk.wait();
        equal(counter, 1);
        runSleepAndCount();
        hk.wait();
        equal(counter, 2);
    });
    test('multiple wait fails', () => {
        const hk = handshake();
        let thrown = false;
        function runAndWait() {
            run(() => {
                hk.wait();
            }).catch(e => {
                thrown = true;
            });
        }
        runAndWait();
        runAndWait();
        sleep(10);
        hk.notify(); // release not thrown run
        equal(thrown, true);
    });
});

describe('funnel', () => {
    test('less concurrency than allowed', () => {
        const fun = funnel(4);
        const begin = Date.now();
        const results = map<number, number | undefined>([10, 10], timeToSleep => {
            return fun<number>(() => {
                sleep(timeToSleep);
                return 1;
            });
        });
        equal(sum(results), 2);
        closeTo(Date.now() - begin, 10, 4);
    });
    test('more concurrency than allowed', () => {
        const fun = funnel(2);
        const begin = Date.now();
        const results = map<number, number | undefined>([10, 10, 10, 10], timeToSleep => {
            return fun<number>(() => {
                sleep(timeToSleep);
                return 1;
            });
        });
        equal(sum(results), 4);
        closeTo(Date.now() - begin, 20, 8);
    });
    test('close funnel access', () => {
        const fun = funnel(1);
        const begin = Date.now();
        run(() => {
            sleep(15);
            fun.close();
        });
        const results = map<number, number | undefined>([10, 10, 10, 10], timeToSleep => {
            return fun<number>(() => {
                sleep(timeToSleep);
                return 1;
            });
        });
        equal(sum(results), 2);
        closeTo(Date.now() - begin, 20, 8);
    });
});

describe('contexts', () => {
    const mainCx = context();
    it('is main at top level', () => {
        equal(context(), mainCx);
    });
    it('is main inside run', done => {
        run(() => {
            equal(context(), mainCx);
        }).then(done, done);
    });
    it('is scoped inside withContext', done => {
        const cx = {};
        run(() => {
            equal(context(), mainCx);
            withContext(() => {
                equal(context(), cx);
            }, cx);
            equal(context(), mainCx);
        }).then(done, done);
    });

    test('contexts', () => {
        function testContext(x: number) {
            return withContext(() => {
                const y = delay(2 * x);
                strictEqual(y, 2 * context<number>());
                return y + 1;
            }, x);
        }

        isObject(context());
        const promises = [run(() => testContext(3)), run(() => testContext(5))];
        deepEqual(promises.map(wait), [7, 11]);
        isObject(context());
    });
});

describe('collection functions', () => {
    it('map', done => {
        run(() => {
            deepEqual(map([2, 5], delay), [2, 5]);
            return 'success';
        }).then(result => {
            equal(result, 'success');
            done();
        }, done);
    });
});

describe('canWait', () => {
    it('true inside run', done => {
        run(() => {
            ok(canWait());
            return 'success';
        }).then(result => {
            equal(result, 'success');
            done();
        }, done);
    });
    it('false outside run', () => {
        notOk(canWait());
    });
});

describe('eventHandler', () => {
    it('can wait with it', done => {
        setTimeout(
            eventHandler(() => {
                ok(canWait());
                done();
            }),
            0,
        );
    });
    it('cannot wait without', done => {
        setTimeout(() => {
            notOk(canWait());
            done();
        }, 0);
    });
    it('outside run', done => {
        notOk(canWait());
        let sync = true;
        eventHandler((arg: string) => {
            equal(arg, 'hello', 'arg ok');
            wait<void>(cb => setTimeout(cb, 0));
            equal(sync, false, 'new fiber');
            done();
        })('hello');
        sync = false;
    });
    it('inside run', done => {
        run(() => {
            let sync = true;
            ok(canWait());
            eventHandler((arg: string) => {
                equal(arg, 'hello', 'arg ok');
                wait<void>(cb => setTimeout(cb, 0));
                equal(sync, true, 'same fiber as run');
                done();
            })('hello');
            sync = false;
        });
    });
    it('preserves arity', () => {
        equal(eventHandler(() => {}).length, 0);
        equal(eventHandler((a: any, b: any) => {}).length, 2);
    });
    it('starts with a fresh context if outside run', done => {
        ok(!canWait());
        eventHandler(() => {
            isNotNull(context());
            done();
        })();
    });
    it('preserves context if already inside run', done => {
        run(() => {
            ok(canWait());
            const cx = {};
            withContext(() => {
                eventHandler(() => {
                    equal(context(), cx);
                    done();
                })();
            }, cx);
        });
    });
});
