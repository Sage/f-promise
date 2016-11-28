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
import { wait, run } from '..';
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

## License

MIT.

## Credits

`f-promise` is just a thin layer. All the hard work is done by the [`fibers`](https://github.com/laverdet/node-fibers) library.

## Gotchas

The absence of `async/await` markers in code that calls asynchronous APIs is unusual in JavaScript (and considered harmful by some).
But this is the norm in other languages. Basically `f-promise` enables _goroutines_ in JavaScript.
