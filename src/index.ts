// Very thin implementation. Streamline.js does all the work.
import { _ } from 'streamline-runtime';
const fibers = require('fibers');

export type Callback<T> = (err: any, result?: T) => void;
export type Thunk<T> = (cb: Callback<T>) => void;

export function wait<T>(arg: Promise<T> | Thunk<T>): T {
	if (typeof arg === 'function') {
		// fiberized test optimizes calls to streamlined thunks: (_: _) => T 
		const fiberized = (arg as any)['fiberized-0'];
		if (fiberized) return fiberized(true);
		else return wait(_.promise(_ => _.cast<T>(arg as any)(_)));
	} else {
		const streamlined = ((_: _) => arg.then(_, _));
		return (streamlined as any)['fiberized-0'].call(null, true);
	}
}

export function run<T>(fn: () => T): Promise<T> {
	return _.promise((_: _) => fn());
}

export function map<T, R>(collection: T[], fn: (val: T) => R) {
	return collection.map(item => {
		return run(() => fn(item));
	}).map(wait);
}

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
export function funnel(n: number): <T>(fn: () => T) => T;
export function funnel(n: number): <T>(fn: () => T | undefined) => T | undefined {
	const fun = _.funnel(n);
	return fn => wait(_ => fun(_ as any, (_: _) => fn()));
}

/// 
/// ## handshake and queue
/// * `hs = handshake()`  
///   allocates a simple semaphore that can be used to do simple handshakes between two tasks.  
///   The returned handshake object has two methods:  
///   `hs.wait()`: waits until `hs` is notified.  
///   `hs.notify()`: notifies `hs`.  
///   Note: `wait` calls are not queued. An exception is thrown if wait is called while another `wait` is pending.
export function handshake<T>() {
	let callback: Callback<T> | undefined = undefined, notified = false;
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
	get length() { return this._q.length; }
}

/// 
/// ## Continuation local storage (CLS)
/// 
/// * `result = withContext(fn, cx)`  
///   wraps a function so that it executes with context `cx` (or a wrapper around current context if `cx` is falsy).
///   The previous context will be restored when the function returns (or throws).  
///   returns the wrapped function.
export function withContext<T>(fn: () => T, cx: any) {
	if (!fibers.current) throw new Error('withContext(fn) not allowed outside run()');
	return _.withContext(fn, cx)();
}

export function context() {
	return _.context;
}

// wait variant for streamline.js
// Callback parameter is typed as any so that f-promise does not re-export streamline-runtime's _ definition.
export function wait_<T>(arg: (_: any) => T): T {
	const fiberized = (arg as any)['fiberized-0'];
	return fiberized(true);
}

/// 
/// ## Miscellaneous
/// 
/// * `ok = canWait()`  
///   returns whether `wait` calls are allowed (whether we are called from a `run`).
export function canWait() {
	return !!fibers.current;
}

/// 
/// * `wrapped = eventHandler(handler)`  
///   wraps `handler` so that it can call `wait`.  
///   the wrapped handler will excute on the current fiber if canWait() is true.
///   otherwise it will be `run` on a new fiber (without waiting for its completion)  
export function eventHandler<T extends Function>(handler: T): T {
	const wrapped = function (this: any, ...args: any[]) {
		if (canWait()) handler.apply(this, args);
		else run(() => withContext(() => handler.apply(this, args), {})).catch(err => { throw err; });
	} as any;
	// preserve arity
	Object.defineProperty(wrapped, 'length', { value: handler.length });
	return wrapped;
}
