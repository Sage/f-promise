import { _ } from 'streamline-runtime';
export declare type Callback<T> = (err: any, result?: T) => void;
export declare type Thunk<T> = (cb: Callback<T>) => void;
export declare function wait<T>(arg: Promise<T> | Thunk<T>): T;
export declare function run<T>(fn: () => T): Promise<T>;
export declare function map<T, R>(collection: T[], fn: (val: T) => R): R[];
export declare function funnel<T>(n: number): (fn: () => T) => T;
export declare function handshake<T>(): {
    wait(): T;
    notify(): void;
};
export interface QueueOptions {
    max?: number;
}
export declare class Queue<T> {
    _max: number;
    _callback: Callback<T> | undefined;
    _err: any;
    _q: (T | undefined)[];
    _pendingWrites: [Callback<T>, T | undefined][];
    constructor(options?: QueueOptions | number);
    read(): T;
    write(item: T | undefined): T;
    put(item: T | undefined, force?: boolean): boolean;
    end(): void;
    peek(): T | undefined;
    contents(): (T | undefined)[];
    adjust(fn: (old: (T | undefined)[]) => (T | undefined)[]): void;
    readonly length: number;
}
export declare function withContext<T>(fn: () => T, cx: any): T;
export declare function context(): any;
export declare function wait_<T>(arg: (_: _) => T): T;
export declare function canWait(): boolean;
export declare function eventHandler<T extends Function>(handler: T): T;
