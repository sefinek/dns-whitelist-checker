const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');

const WHITELISTS_DIR = path.join(__dirname, 'whitelists');
const urls = [
	'https://raw.githubusercontent.com/anudeepND/whitelist/refs/heads/master/domains/whitelist.txt',
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
	const domainsSet = new Set();
	for (const file of files) {
		const fullPath = path.join(dir, file);
		const domains = await getDomainsFromFile(fullPath);
		for (const domain of domains) domainsSet.add(domain);
	}
	return Array.from(domainsSet);
};

const checkDomain = async domain => {
	for (const proto of ['https', 'http']) {
		try {
			await axios.get(`${proto}://${domain}`, { timeout: 4000 });
			return { domain, status: 'ok' };
		} catch (err) {
			if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return { domain, status: 'warn', error: err.code };
			if (err.response) return { domain, status: 'ok' };
		}
	}
	return { domain, status: 'error', error: 'not reachable' };
};

const main = async () => {
	await ensureDir(WHITELISTS_DIR);

	for (const url of urls) {
		try {
			await downloadFile(url, WHITELISTS_DIR);
			console.log(`[INFO] Downloaded: ${url}`);
		} catch (err) {
			console.log(`[WARN] Download failed: ${url} (${err.message})`);
		}
	}

	const domains = await getAllDomains(WHITELISTS_DIR);
	console.log(`[INFO] Found ${domains.length} domains`);

	for (const domain of domains) {
		const res = await checkDomain(domain);
		if (res.status === 'ok') {
			console.log(`[OK]   ${res.domain}`);
		} else if (res.status === 'warn') {
			console.log(`[WARN]  ${res.domain} (${res.error})`);
		} else {
			console.log(`[ERROR] ${res.domain} (${res.error})`);
		}
	}
};

main().catch(err => {
	console.error('[FATAL]', err);
	process.exit(1);
});