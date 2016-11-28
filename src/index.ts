// Very thin implementation. Streamline.js does all the work.
import { _ } from 'streamline-runtime';

export function wait<T>(promise: Promise<T>): T {
    const streamlined = ((_: _) => promise.then(_, _))
    return (streamlined as any)['fiberized-0'].call(null, true);
}

export function run<T>(fn: () => T): Promise<T> {
    return _.promise((_: _) => fn());
}