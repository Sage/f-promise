const fibers = require('fibers');

export type Callback<T> = (err: any, result?: T) => void;
export type Thunk<T> = (cb: Callback<T>) => void;

///
/// ## run/wait
/// * `promise = run(() => { wait(promise/callback); ... })`
///    create a coroutine to write asynchronous code in a synchronous way.
///
/// All the job is done by fibers library.
/// Those two functions are the core, others are goodies:
///   * `promise = run(fn)` create a coroutine.
///     This start a fiber, which is stopped when `fn` returns.
///   * `result = wait(promise/callback)` encapsulate promise or callback.
///     Concretely, the fiber is suspended while the asynchronous task is not finished, then it resumes.
///     As many `wait()` as needed may be used in a run.
export let wait = <T = any>(promiseOrCallback: Promise<T> | Thunk<T>): T => {
    const fiber = fibers.current;
    if (!fiber) throw new Error('cannot wait: no fiber');
    if (typeof promiseOrCallback === 'function') {
        promiseOrCallback((err, res) => {
            process.nextTick(() => {
                let cx = globals.context;
                try {
                    if (err) {
                        fiber.throwInto(err);
                    } else {
                        fiber.run(res);
                    }
                } finally {
                    globals.context = cx;
                    cx = null;
                }
            });
        });
    } else {
        promiseOrCallback
            .then(res => {
                let cx = globals.context;
                try {
                    fiber.run(res);
                } finally {
                    globals.context = cx;
                    cx = null;
                }
            })
            .catch(e => {
                let cx = globals.context;
                try {
                    fiber.throwInto(e);
                } finally {
                    globals.context = cx;
                    cx = null;
                }
            });
    }
    let cx = globals.context;
    try {
        return fibers.yield();
    } catch (e) {
        throw (fullStackError && fullStackError(e)) || e;
    } finally {
        globals.context = cx;
        cx = null;
    }
};

export let run = <T>(fn: () => T): Promise<T> => {
    if (typeof fn !== 'function') {
        throw new Error('run() should take a function as argument');
    }
    return new Promise((resolve, reject) => {
        const cx = globals.context;
        fibers(() => {
            try {
                resolve(fn());
            } catch (e) {
                reject((cleanFiberStack && cleanFiberStack(e)) || e);
            }
        }).run();
        globals.context = cx;
    });
};

// goodies

/// ## funnel
/// * `fun = funnel(max)`
///   limits the number of concurrent executions of a given code block.
///
/// The `funnel` function is typically used with the following pattern:
///
/// ``` ts
/// // somewhere
/// var myFunnel = funnel(10); // create a funnel that only allows 10 concurrent executions.
///
/// // elsewhere
/// myFunnel(function() { /* code with at most 10 concurrent executions */ });
/// ```
///
/// The `funnel` function can also be used to implement critical sections. Just set funnel's `max` parameter to 1.
///
/// If `max` is set to 0, a default number of parallel executions is allowed.
/// This default number can be read and set via `flows.funnel.defaultSize`.
/// If `max` is negative, the funnel does not limit the level of parallelism.
///
/// The funnel can be closed with `fun.close()`.
/// When a funnel is closed, the operations that are still in the funnel will continue but their callbacks
/// won't be called, and no other operation will enter the funnel.
export function funnel(max = -1): Funnel {
    if (typeof max !== 'number') {
        throw new Error('bad max number: ' + max);
    }

    const _max = max === 0 ? exports.funnel.defaultSize : max;

    // Each bottled coroutine use an handshake to be waked up later when an other quit.
    // Before waiting on the handshake, it is pushed to this queue.
    let queue: Handshake[] = [];
    let active = 0;
    let closed = false;

    function tryEnter<T>(fn: () => T): T {
        if (active < _max) {
            active++;
            try {
                return fn();
            } finally {
                active--;
                const hk = queue.shift();
                if (hk) {
                    hk.notify();
                }
            }
        } else {
            return overflow<T>(fn);
        }
    }

    function overflow<T>(fn: () => T): T {
        const hk = handshake();
        queue.push(hk);
        hk.wait();
        if (closed) {
            throw new Error(`cannot execute: funnel has been closed`);
        }
        // A success is not sure, the entry ticket may have already be taken by another,
        // so this one may still be delayed by re-entering in overflow().
        return tryEnter<T>(fn);
    }

    const fun = function<T>(fn: () => T): T {
        if (closed) {
            throw new Error(`cannot execute: funnel has been closed`);
        }
        if (_max < 0 || _max === Infinity) {
            return fn();
        }
        return tryEnter(fn);
    } as Funnel;

    fun.close = () => {
        queue.forEach(hk => {
            hk.notify();
        });
        queue = [];
        closed = true;
    };
    return fun;
}
(funnel as any).defaultSize = 4;

export interface Funnel {
    <T>(fn: () => T): T;
    close(): void;
}

///
/// ## handshake and queue
/// * `hs = handshake()`
///   allocates a simple semaphore that can be used to do simple handshakes between two tasks.
///   The returned handshake object has two methods:
///   `hs.wait()`: waits until `hs` is notified.
///   `hs.notify()`: notifies `hs`.
///   Note: `wait` calls are not queued. An exception is thrown if wait is called while another `wait` is pending.
export function handshake<T = void>() {
    let callback: Callback<T> | undefined = undefined,
        notified = false;
    return {
        wait() {
            return wait<T>((cb: Callback<T>) => {
                if (callback) throw new Error('already waiting');
                if (notified) setImmediate(cb);
                else callback = cb;
                notified = false;
            });
        },
        notify() {
            if (!callback) notified = true;
            else setImmediate(callback);
            callback = undefined;
        },
    };
}

export interface Handshake<T = void> {
    wait(): void;
    notify(): void;
}

/// * `q = new Queue(options)`
///   allocates a queue which may be used to send data asynchronously between two tasks.
///   The `max` option can be set to control the maximum queue length.
///   When `max` has been reached `q.put(data)` discards data and returns false.
///   The returned queue has the following methods:
export interface QueueOptions {
    max?: number;
}
export class Queue<T> {
    _max: number;
    _callback: Callback<T> | undefined;
    _err: any;
    _q: (T | undefined)[] = [];
    _pendingWrites: [Callback<T>, T | undefined][] = [];
    constructor(options?: QueueOptions | number) {
        if (typeof options === 'number') {
            options = {
                max: options,
            };
        }
        options = options || {};
        this._max = options.max != null ? options.max : -1;
    }
    ///   `data = q.read()`:  dequeue and returns the first item. Waits if the queue is empty. Does not allow concurrent read.
    read() {
        return wait<T>((cb: Callback<T>) => {
            if (this._callback) throw new Error('already getting');
            if (this._q.length > 0) {
                const item = this._q.shift();
                // recycle queue when empty to avoid maintaining arrays that have grown large and shrunk
                if (this._q.length === 0) this._q = [];
                setImmediate(() => {
                    cb(this._err, item);
                });
                if (this._pendingWrites.length > 0) {
                    const wr = this._pendingWrites.shift();
                    setImmediate(() => {
                        wr && wr[0](this._err, wr[1]);
                    });
                }
            } else {
                this._callback = cb;
            }
        });
    }
    ///   `q.write(data)`:  queues an item. Waits if the queue is full.
    write(item: T | undefined) {
        return wait<T>((cb: Callback<T>) => {
            if (this.put(item)) {
                setImmediate(() => {
                    cb(this._err);
                });
            } else {
                this._pendingWrites.push([cb, item]);
            }
        });
    }
    ///   `ok = q.put(data)`: queues an item synchronously. Returns true if the queue accepted it, false otherwise.
    put(item: T | undefined, force?: boolean) {
        if (!this._callback) {
            if (this._max >= 0 && this._q.length >= this._max && !force) return false;
            this._q.push(item);
        } else {
            const cb = this._callback;
            this._callback = undefined;
            setImmediate(() => {
                cb(this._err, item);
            });
        }
        return true;
    }
    ///   `q.end()`: ends the queue. This is the synchronous equivalent of `q.write(_, undefined)`
    end() {
        this.put(undefined, true);
    }
    ///   `data = q.peek()`: returns the first item, without dequeuing it. Returns `undefined` if the queue is empty.
    peek() {
        return this._q[0];
    }
    ///   `array = q.contents()`: returns a copy of the queue's contents.
    contents() {
        return this._q.slice(0);
    }
    ///   `q.adjust(fn[, thisObj])`: adjusts the contents of the queue by calling `newContents = fn(oldContents)`.
    adjust(fn: (old: (T | undefined)[]) => (T | undefined)[]) {
        const nq = fn.call(null, this._q);
        if (!Array.isArray(nq)) throw new Error('adjust function does not return array');
        this._q = nq;
    }
    get length() {
        return this._q.length;
    }
}

///
/// ## Continuation local storage (CLS)
///
/// * `result = withContext(fn, cx)`
///   wraps a function so that it executes with context `cx` (or a wrapper around current context if `cx` is falsy).
///   The previous context will be restored when the function returns (or throws).
///   returns the wrapped function.
export function withContext<T>(fn: () => T, cx: any): T {
    if (!fibers.current) throw new Error('withContext(fn) not allowed outside run()');
    const oldContext = globals.context;
    globals.context = cx || Object.create(oldContext);
    try {
        return fn();
    } finally {
        globals.context = oldContext;
    }
}

export function context<T = any>(): T {
    return globals.context;
}

///
/// ## Miscellaneous
///
/// * `results = map(collection, fn)`
///   creates as many coroutines with `fn` as items in `collection` and wait for them to finish to return result array.
export function map<T, R>(collection: T[], fn: (val: T) => R) {
    return wait(
        Promise.all(
            collection.map(item => {
                return run(() => fn(item));
            }),
        ),
    );
}

/// * `sleep(ms)`
///   suspends current coroutine for `ms` milliseconds.
export function sleep(n: number): void {
    wait(cb => setTimeout(cb, n));
}

/// * `ok = canWait()`
///   returns whether `wait` calls are allowed (whether we are called from a `run`).
export function canWait() {
    return !!fibers.current;
}

/// * `wrapped = eventHandler(handler)`
///   wraps `handler` so that it can call `wait`.
///   the wrapped handler will execute on the current fiber if canWait() is true.
///   otherwise it will be `run` on a new fiber (without waiting for its completion)
export function eventHandler<T extends Function>(handler: T): T {
    const wrapped = function(this: any, ...args: any[]) {
        if (canWait()) {
            handler.apply(this, args);
        } else {
            run(() => withContext(() => handler.apply(this, args), {})).catch(err => {
                console.error(err);
            });
        }
    } as any;
    // preserve arity
    Object.defineProperty(wrapped, 'length', { value: handler.length });
    return wrapped;
}

// private

declare const global: any;
const secret = '_20c7abceb95c4eb88b7ca1895b1170d1';
const globals = (global[secret] = global[secret] || { context: {} });

// Those functions are conditionally assigned bellow.
let fullStackError: ((e: Error) => Error) | undefined;
let cleanFiberStack: ((e: Error) => Error) | undefined;

let cannotOverrideStackWarned = false;
function overrideStack(e: Error, getFn: (this: Error) => string) {
    try {
        Object.defineProperty(e, 'stack', {
            get: getFn,
            enumerable: true,
            configurable: true,
        });
    } catch (e) {
        if (!cannotOverrideStackWarned) {
            console.warn(`[F-PROMISE] attempt to override e.stack failed (warning will not be repeated)`);
            cannotOverrideStackWarned = true;
        }
    }
}

/// ## Error stack traces
///
/// Three policies:
/// * `fast`: stack traces are not changed. Call history might be difficult to read; cost less.
/// * `whole`: stack traces due to async tasks errors in `wait()` are concatenate with the current coroutine stack.
///   This allow to have a complete history call (including f-promise traces).
/// * default: stack traces are like `whole` policy, but clean up to remove f-promise noise.
///
/// The policy can be set with `FPROMISE_STACK_TRACES` environment variable.
/// Any value other than `fast` and `whole` are consider as default policy.
if (process.env.FPROMISE_STACK_TRACES === 'whole') {
    fullStackError = function fullStackError(e: Error) {
        if (!(e instanceof Error)) {
            return e;
        }
        const localError = new Error('__fpromise');
        const fiberStack = e.stack || '';
        overrideStack(e, function() {
            const localStack = localError ? localError.stack || '' : '';
            return fiberStack + localStack;
        });
        return e;
    };
} else if (process.env.FPROMISE_STACK_TRACES !== 'fast') {
    fullStackError = function fullStackError(e: Error) {
        if (!(e instanceof Error)) {
            return e;
        }
        const localError = new Error('__f-promise');
        const fiberStack = e.stack || '';
        overrideStack(e, function() {
            const localStack = localError ? localError.stack || '' : '';
            return (
                fiberStack +
                '\n' +
                localStack
                    .split('\n')
                    .slice(1)
                    .filter(line => {
                        return !/\/f-promise\//.test(line);
                    })
                    .join('\n')
            );
        });
        return e;
    };

    cleanFiberStack = function cleanFiberStack(e: Error) {
        if (!(e instanceof Error)) {
            return e;
        }
        const fiberStack = e.stack || '';
        overrideStack(e, function() {
            return fiberStack
                .split('\n')
                .filter(line => {
                    return !/\/f-promise\//.test(line);
                })
                .join('\n');
        });
        return e;
    };
}

// little goodie to improve V8 debugger experience
// The debugger hangs if Fiber.yield is called when evaluating expressions at a breakpoint
// So we monkey patch wait to throw an exception if it detects this special situation.
if (process.execArgv.find(str => str.startsWith('--inspect-brk'))) {
    // Unfortunately, there is no public API to check if we are called from a breakpoint.
    // There is a C++ API (context->IsDebugEvaluateContext()) to test this
    // but unfortunately this is an internal V8 API.
    // This test is the best workaround I have found.
    const isDebugEval = () => (new Error().stack || '').indexOf('.remoteFunction (<anonymous>') >= 0;

    const oldWait = wait;

    const flushDelayed = () => {
        if (fibers.current.delayed) {
            const delayed = fibers.current.delayed;
            fibers.current.delayed = undefined;
            for (const arg of delayed) {
                try {
                    oldWait(arg);
                } catch (err) {
                    console.error(`delayed 'wait' call failed: ${err.message}`);
                }
            }
        }
    };

    // Why throw string (from bjouhier)
    // I think I threw a string rather than an Error object because
    // I did not want to clutter the debugger with error objects.
    // There was also a memory issue here: debugger allocating a lot
    // of Error objects and stack trace captures vs. a string literal
    // which does not require any dynamic memory allocation.
    wait = <T>(arg: Promise<T> | Thunk<T>): T => {
        if (isDebugEval()) {
            if (!fibers.current.delayed) fibers.current.delayed = [];
            fibers.current.delayed.push(arg);
            // tslint:disable-next-line:no-string-throw
            throw 'would yield';
        }
        flushDelayed();
        return oldWait(arg);
    };
    const oldRun = run;
    run = <T>(fn: () => T): Promise<T> => {
        // tslint:disable-next-line:no-string-throw
        if (isDebugEval()) throw 'would start a fiber';
        else return oldRun(fn);
    };
    console.log('Running with f-promise debugger hooks');
}
