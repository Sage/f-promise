# f-promise

Promise-oriented coroutines for node.js.

```sh
npm install f-promise
```

## API

The `f-promise` API consists in 2 calls: `wait` and `run`.

* `result = wait(promise)`:  waits on a promise and returns its result (or throws if the promise is rejected).
* `promise = run(fn)`: runs a function as a coroutine and returns a promise for the function's result.

Constraint: `wait` may only be called from a coroutine (a function which is executed by `run`).

## Simple example

```js
import { wait, run } from 'f-promise';
import * as fs from 'mz/fs';
import { join } from 'path';

function diskUsage(dir) {
    return wait(fs.readdir(dir)).reduce((size, name) => {
        const sub = join(dir, name);
        const stat = wait(fs.stat(sub));
        if (stat.isDirectory()) return size + diskUsage(sub);
        else if (stat.isFile()) return size + stat.size;
        else return size;
    }, 0);
}

function printDiskUsage(dir) {
    console.log(`${dir}: ${diskUsage(dir)}`);
}

run(() => printDiskUsage(process.cwd()))
    .then(() => {}, err => { throw err; });
```

Note: this is not a very efficient implementation because the logic is completely
serialized.

## Why f-promise?

To understand the benefits of `f-promise`, let us compare the example above with the ES7 `async/await` equivalent:

```js
import * as fs from 'mz/fs';
import { join } from 'path';

async function diskUsage(dir) {
    var size = 0;
    for (var name of await fs.readdir(dir)) {
        const sub = join(dir, name);
        const stat = await fs.stat(sub);
        if (stat.isDirectory()) size += await diskUsage(sub);
        else if (stat.isFile()) size += stat.size;
    }
    return size;
}

async function printDiskUsage(dir) {
    console.log(`${dir}: ${await diskUsage(dir)}`);
}

printDiskUsage(process.cwd())
    .then(() => {}, err => { throw err; });
```

Two observations:

* Async is contagious: `printDiskUsage` must be marked as `async` 
because it needs to `await` on `diskUsage`.
This is not dramatic in this simple example but in a large code base this translates
into a proliferation of `async/await` keywords throughout the code.
* ES7 async/await does not play well with array methods (`forEach`, `map`, `reduce`, ...) 
because you cannot use `await` inside the callbacks of these methods. 
You have to write the loop differently, with `for ... of ...` or `Promise.all`.

`f-promise` solves these problems:

* Functions that _wait_ on async operations are not marked with `async`; 
they are _normal_ JavaScript functions. `async/await` keywords don't invade the code.
* `wait` plays well with array methods, and with other APIs that expect _synchronous_ callbacks.

## TypeScript support

TypeScript is fully supported.

## Control Flow utilities
 
### funnel

* `fun = fpromise.funnel(max)`  
  limits the number of concurrent executions of a given code block.

The `funnel` function is typically used with the following pattern:

``` javascript
import { funnel } from 'f-promise';

// somewhere
var myFunnel = funnel(10); // create a funnel that only allows 10 concurrent executions.

// elsewhere
myFunnel(() => { /* code with at most 10 concurrent executions */ });
```

The `funnel` function can also be used to implement critical sections. Just set funnel's `max` parameter to 1.

If `max` is set to 0, a default number of parallel executions is allowed. 
This default number can be read and set via `funnel.defaultSize`.  
If `max` is negative, the funnel does not limit the level of parallelism.

The funnel can be closed with `fun.close()`.  
When a funnel is closed, the operations that are still in the funnel will continue but their callbacks
won't be called, and no other operation will enter the funnel.

### handshake and queue

* `hs = fpromise.handshake()`  
  allocates a simple semaphore that can be used to do simple handshakes between two tasks.  
  The returned handshake object has two methods:  
  `hs.wait()`: waits until `hs` is notified.  
  `hs.notify()`: notifies `hs` (without waiting for an acknowledgement)
  Note: `wait` calls are not queued. An exception is thrown if wait is called while another `wait` is pending.
* `q = fpromise.queue(options)`  
  allocates a queue which may be used to send data asynchronously between two tasks.  
  The `max` option can be set to control the maximum queue length.  
  When `max` has been reached `q.put(data)` discards data and returns false.
  The returned queue has the following methods:  
  `data = q.read()`: dequeues an item from the queue. Waits if no element is available.  
  `q.write(data)`:  queues an item. Waits if the queue is full.  
  `ok = q.put(data)`: queues an item synchronously. Returns true if the queue accepted it, false otherwise. 
  `q.end()`: ends the queue. This is the synchronous equivalent of `q.write(undefined)`  
  `data = q.peek()`: returns the first item, without dequeuing it. Returns `undefined` if the queue is empty.  
  `array = q.contents()`: returns a copy of the queue's contents.  
  `q.adjust(fn[, thisObj])`: adjusts the contents of the queue by calling `newContents = fn(oldContents)`.  
  `q.length`: number of items currently in the queue.  

### CLS (Continuation Local Storage)

* `cx = fpromise.context()`  
  returns the current context.

* `fn = fpromise.withContext(fn, cx)`  
  wraps a function so that it executes with context `cx` (or a wrapper around current context if `cx` is falsy).
  The previous context will be restored when the function returns (or throws).  
  returns the wrapped function.

## Related projects

* [f-streams](https://github.com/Sage/f-streams)
* [f-express](https://github.com/Sage/f-express)
* [f-mocha](https://github.com/Sage/f-mocha)

## License

MIT.

## Credits

`f-promise` is just a thin layer. All the hard work is done by the [`fibers`](https://github.com/laverdet/node-fibers) library.

## Gotchas

The absence of `async/await` markers in code that calls asynchronous APIs is unusual in JavaScript (and considered harmful by some).
But this is the norm in other languages. Basically `f-promise` enables _goroutines_ in JavaScript.
