const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const axios = require('axios');

const WHITELISTS_DIR = path.join(__dirname, 'whitelists');
const urls = [

];

const ensureDir = dir => fs.promises.mkdir(dir, { recursive: true });

const downloadFile = async (url, dir) => {
	const filename = path.join(dir, path.basename(url));
	const res = await axios.get(url, { responseType: 'stream' });
	await new Promise((resolve, reject) => {
		const stream = fs.createWriteStream(filename);
		res.data.pipe(stream);
		stream.on('finish', resolve);
		stream.on('error', reject);
	});
	return filename;
};

const extractDomain = line => {
	line = line.trim();
	if (!line || line.startsWith('#')) return null;
	const match = line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)?\s*([a-zA-Z0-9\-\\._]+\.[a-zA-Z]{2,})/);
	return match ? match[1] : null;
};

const getDomainsFromFile = async file =>
	(await fs.promises.readFile(file, 'utf8'))
		.split('\n')
		.map(extractDomain)
		.filter(Boolean);

const getAllDomains = async dir => {
	const files = await fs.promises.readdir(dir);
	const sets = await Promise.all(
		files.map(async file => new Set(await getDomainsFromFile(path.join(dir, file))))
	);
	return Array.from(new Set(sets.flatMap(set => [...set])));
};

const checkDomain = async domain => {
	for (const proto of ['https', 'http']) {
		try {
			await axios.get(`${proto}://${domain}`, { timeout: 4000 });
			return { domain, status: 'ok' };
		} catch (err) {
			if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN')
			{return { domain, status: 'warn', error: err.code };}
			if (err.response) return { domain, status: 'ok' };
		}
	}
	return { domain, status: 'error', error: 'not reachable' };
};

const mapLimit = async (items, limit, fn) => {
	const results = [];
	let idx = 0;
	const exec = async () => {
		while (idx < items.length) {
			const i = idx++;
			results[i] = await fn(items[i]);
		}
	};
	await Promise.all(Array(limit).fill(0).map(exec));
	return results;
};

const main = async () => {
	await ensureDir(WHITELISTS_DIR);
	await Promise.all(urls.map(async url => {
		try {
			await downloadFile(url, WHITELISTS_DIR);
			console.log(`[INFO] Downloaded: ${url}`);
		} catch (e) {
			console.log(`[WARN] Download failed: ${url} (${e.message})`);
		}
	}));
	const domains = await getAllDomains(WHITELISTS_DIR);
	const concurrency = Math.min(os.cpus().length, 8);
	const results = await mapLimit(domains, concurrency, checkDomain);
	for (const res of results) {
		if (res.status === 'ok')
		{console.log(`[OK]    ${res.domain}`);}
		else if (res.status === 'warn')
		{console.log(`[WARN]  ${res.domain} (${res.error})`);}
		else
		{console.log(`[ERROR] ${res.domain} (${res.error})`);}
	}
};

main().catch(err => {
	console.error('[FATAL]', err);
	process.exit(1);
});