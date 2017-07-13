import * as fs from 'mz/fs';
import { join } from 'path';

async function diskUsage(dir: string) {
	let size = 0;
	for (const name of await fs.readdir(dir)) {
		const sub = join(dir, name);
		const stat = await fs.stat(sub);
		if (stat.isDirectory()) size += await diskUsage(sub);
		else if (stat.isFile()) size += stat.size;
	}
	return size;
}

async function printDiskUsage(dir: string) {
	console.log(`${dir}: ${await diskUsage(dir)}`);
}

printDiskUsage(process.cwd())
	.catch(err => { throw err; });
