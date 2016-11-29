import { wait, run } from '..';
import * as fs from 'mz/fs';
import { join } from 'path';

function diskUsage(dir: string): number {
    return wait(fs.readdir(dir)).reduce((size, name) => {
        const sub = join(dir, name);
        const stat = wait(fs.stat(sub));
        if (stat.isDirectory()) return size + diskUsage(sub);
        else if (stat.isFile()) return size + stat.size;
        else return size;
    }, 0);
}

function printDiskUsage(dir: string) {
    console.log(`${dir}: ${diskUsage(dir)}`);
}

run(() => printDiskUsage(process.cwd()))
    .then(() => { }, err => { throw err; });
