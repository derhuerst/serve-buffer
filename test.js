'use strict'

const tapePromise = require('tape-promise').default
const tape = require('tape')
const {createServer, request} = require('http')
const {promisify} = require('util')
const {buffer: collect} = require('get-stream')
const etag = require('etag')
const {gzipSync, brotliCompressSync} = require('zlib')
const serveBuffer = require('.')

const T0 = 12345678

const test = tapePromise(tape)

const fetch = async (t, buf, reqOpts = {}, serveOpts = {}) => {
	let cbCalls = 0
	const cb = (err) => {
		cbCalls++
		t.ifError(err)
	}

	const server = createServer((req, res) => {
		serveBuffer(req, res, buf, {
			etag: etag(buf),
			timeModified: new Date(T0),
			...serveOpts,
		}, cb)
	})
	const stop = promisify(server.close.bind(server))

	await promisify(server.listen.bind(server))({
		host: '127.0.0.1', port: 12345,
	})
	const {address, port} = server.address()

	try {
		const res = await new Promise((resolve, reject) => {
			const req = request({
				...reqOpts,
				family: 4, host: address, port,
				timeout: 2 * 1000,
			}, resolve)
			req.once('error', reject)
			req.end()
		})
		const buf = await collect(res)
		t.equal(cbCalls, 1, 'cb not called once')
		await stop()
		return {res, buf}
	} catch (err) {
		await stop()
		throw err
	}
}

const expectHeaders = (t, headers, expHeaders) => {
	for (const [name, val] of Object.entries(expHeaders)) {
		t.equal(headers[name], val, `headers.${name} is not equal`)
	}
}
const expect = async (t, _buf, headers, expCode = 200, expHeaders = {}) => {
	const {res, buf} = await fetch(t, _buf, {headers})

	t.equal(res.statusCode, expCode, 'status code is not equal')
	expectHeaders(t, res.headers, expHeaders)
	return {res, buf}
}
const expectData = async (t, _buf, headers, expBuf, expCode = 200, expHeaders = {}) => {
	const {res, buf} = await fetch(t, _buf, {headers})

	t.equal(res.statusCode, expCode, 'status code is not equal')
	expectHeaders(t, res.headers, expHeaders)
	t.equal(buf.toString('hex'), expBuf.toString('hex'), 'response data is not equal')
	return {res, buf}
}

const BUF = Buffer.from('fedcba0987654321', 'hex')
const BUF_GZIP = gzipSync(BUF)
const BUF_BROTLI = brotliCompressSync(BUF)
const BUF_5M = Buffer.alloc(5 * 1024 * 1024)
const BUF_5M_GZIP = gzipSync(BUF_5M)
const BUF_50M = Buffer.alloc(50 * 1024 * 1024)
const b = (hex = '') => Buffer.from(hex, 'hex')

const BASE_HEADERS = {
	'accept-ranges': 'bytes',
	// 'cache-control': 'public, max-age=0',
	'content-type': 'application/octet-stream',
	'etag': etag(BUF),
	'last-modified': new Date(T0).toUTCString(),
	'cache-control': 'public, max-age=0',
	'content-length': '8',
}

test('whole Buffer, without ETags', async (t) => {
	await expectData(t, BUF, {}, BUF, 200, BASE_HEADERS)
})

test('whole Buffer, with non-matching ETags', async (t) => {
	await expect(t, BUF, {
		'if-match': [etag(BUF.slice(1)), etag(BUF.slice(3))].join(', '),
	}, 412)
	await expect(t, BUF, {
		'if-match': [etag(BUF.slice(1)), etag(BUF.slice(3))].join(', '),
	}, 412)
	await expectData(t, BUF, {
		'if-match': '*',
	}, BUF, 200)
})

test('whole Buffer, with cache', async (t) => {
	await expectData(t, BUF, {
		'if-match': [etag(BUF.slice(1)), etag(BUF)].join(', '),
	}, BUF, 200)
	await expect(t, BUF, {
		'if-none-match': [etag(BUF.slice(1)), etag(BUF)].join(', '),
	}, 304)
	await expect(t, BUF, {
		'if-none-match': '*',
	}, 304)
})

test('empty Buffer', async (t) => {
	await expectData(t, b(), {}, b(), 200, {
		...BASE_HEADERS,
		'etag': etag(b()),
		'content-length': '0',
	})
	await expect(t, b(), {
		'if-none-match': [etag(BUF.slice(5)), etag(b())].join(', '),
	}, 304, {
		'accept-ranges': 'bytes',
		// 'cache-control': 'public, max-age=0',
		'etag': etag(b()),
	})
})

test('HEAD', async (t) => {
	const {buf, res} = await fetch(t, BUF, {method: 'HEAD'})
	t.equal(buf.length, 0)
	await expectHeaders(t, res.headers, BASE_HEADERS)

})

// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/test/send.js#L561-L673

test('unsatisfiable range', async (t) => {
	await expect(t, BUF, {
		'range': 'bytes=8-10',
	}, 416, {
		'content-range': 'bytes */8',
	})
})

test('range 2-4', async (t) => {
	await expectData(t, BUF, {
		'range': 'bytes=2-4',
	}, b('ba0987'), 206, {
		...BASE_HEADERS,
		'content-range': 'bytes 2-4/8',
		'content-length': '3', // range is inclusive
	})
})

test('range -3', async (t) => {
	await expectData(t, BUF, {
		'range': 'bytes=-3',
	}, BUF.slice(-3), 206, {
		...BASE_HEADERS,
		'content-range': 'bytes 5-7/8',
		'content-length': '3',
	})
})

test('range 3-', async (t) => {
	await expectData(t, BUF, {
		'range': 'bytes=3-',
	}, BUF.slice(3), 206, {
		...BASE_HEADERS,
		'content-range': 'bytes 3-7/8',
		'content-length': '5',
	})
})

test('ignores multi-ranges', async (t) => {
	const expectFull = async (range) => {
		await expectData(t, BUF, {range}, BUF, 200, BASE_HEADERS)
	}
	await expectFull('bytes=1-3,5-7')
	await expectFull('bytes=1-3,5-')
	await expectFull('bytes=1-3,-2')
})

test('range 2-4, if-range', async (t) => {
	// If a client has a partial copy of a representation and wishes to have
	// an up-to-date copy of the entire representation, it could use the
	// Range header field with a conditional GET (using either or both of
	// If-Unmodified-Since and If-Match.)  However, if the precondition
	// fails because the representation has been modified, the client would
	// then have to make a second request to obtain the entire current
	// representation.

	// The "If-Range" header field allows a client to "short-circuit" the
	// second request.  Informally, its meaning is as follows: if the
	// representation is unchanged, send me the part(s) that I am requesting
	// in Range; otherwise, send me the entire representation.

	// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/test/send.js#L676-L689
	{
		await expectData(t, BUF, {
			'if-range': etag(BUF),
			'range': 'bytes=2-4',
		}, BUF.slice(2, 5), 206, {
			...BASE_HEADERS,
			'content-range': 'bytes 2-4/8',
			'content-length': '3', // range is inclusive
		})
	}
	// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/test/send.js#L691-L704
	{
		await expectData(t, BUF, {
			'if-range': '"some other etag"',
			'range': 'bytes=2-4',
		}, BUF, 200, BASE_HEADERS)
	}
	// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/test/send.js#L706-L719
	{
		await expectData(t, BUF, {
			'if-range': new Date(T0).toUTCString(),
			'range': 'bytes=2-4',
		}, BUF.slice(2, 5), 206, {
			...BASE_HEADERS,
			'content-range': 'bytes 2-4/8',
			'content-length': '3', // range is inclusive
		})
	}
	// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/test/send.js#L721-L734
	{
		await expectData(t, BUF, {
			'if-range': new Date(T0 + 1000).toUTCString(),
			'range': 'bytes=2-4',
		}, BUF, 200, BASE_HEADERS)
	}
	// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/test/send.js#L736-L742
	{
		await expectData(t, BUF, {
			'if-range': 'foo',
			'range': 'bytes=2-4',
		}, BUF, 200, BASE_HEADERS)
	}
})

test('range 2-4, caching', async (t) => {
	// The Range header field is evaluated after evaluating the precondition
	// header fields defined in [RFC7232], and only if the result in absence
	// of the Range header field would be a 200 (OK) response.  In other
	// words, Range is ignored when a conditional GET would result in a 304
	// (Not Modified) response.
	// https://datatracker.ietf.org/doc/html/rfc7233#section-3.1
	{
		await expectData(t, BUF, {
			'if-none-match': etag(BUF),
			'range': 'bytes=2-4',
		}, b(), 304, {
			...BASE_HEADERS,
			'content-length': undefined,
		})
	}
	{
		await expectData(t, BUF, {
			'if-none-match': '"some other etag"',
			'range': 'bytes=2-4',
		}, BUF.slice(2, 5), 206, {
			...BASE_HEADERS,
			'content-range': 'bytes 2-4/8',
			'content-length': '3', // range is inclusive
		})
	}

	// with if-range in addition
	{
		await expectData(t, BUF, {
			'if-none-match': '"some other etag"',
			'if-range': etag(BUF),
			'range': 'bytes=2-4',
		}, BUF.slice(2, 5), 206, {
			...BASE_HEADERS,
			'content-range': 'bytes 2-4/8',
			'content-length': '3', // range is inclusive
		})
	}
	{
		await expectData(t, BUF, {
			'if-none-match': '"some other etag"',
			'if-range': '"some other etag"',
			'range': 'bytes=2-4',
		}, BUF, 200, BASE_HEADERS)
	}
	{
		await expectData(t, BUF, {
			'if-none-match': etag(BUF),
			'if-range': '"some other etag"',
			'range': 'bytes=2-4',
		}, b(), 304, {
			...BASE_HEADERS,
			'content-length': undefined,
		})
	}
	{
		await expectData(t, BUF, {
			'if-none-match': etag(BUF),
			'if-range': etag(BUF),
			'range': 'bytes=2-4',
		}, b(), 304, {
			...BASE_HEADERS,
			'content-length': undefined,
		})
	}
})

test('opt.getTimeModified', async (t) => {
	const mtime = new Date(1234567890 * 1000)
	const _fetch = (headers = {}) => {
		return fetch(t, BUF, {headers}, {timeModified: mtime})
	}

	const {res: res1} = await _fetch({})
	t.equal(res1.headers['last-modified'], mtime.toUTCString())

	const earlier = new Date(mtime - 2000).toUTCString()
	const {res: res2} = await _fetch({
		'if-modified-since': earlier,
	})
	t.equal(res2.statusCode, 200)
	const {res: res3} = await _fetch({
		'if-unmodified-since': earlier,
	})
	t.equal(res3.statusCode, 412)

	const later = new Date(mtime + 1000).toUTCString()
	const {res: res4} = await _fetch({
		'if-modified-since': later,
	})
	t.equal(res4.statusCode, 304)
	const {res: res5} = await _fetch({
		'if-unmodified-since': later,
	})
	t.equal(res5.statusCode, 200)
})

test('opt.etag', async (t) => {
	const e = etag('foo')
	const {res} = await fetch(t, BUF, {}, {etag: e})
	t.equal(res.headers['etag'], e)
})

test('opt.cacheControl, opt.maxAge, opt.immutable', async (t) => {
	const {res: r1} = await fetch(t, BUF, {}, {
		maxAge: 123 * 1000,
	})
	expectHeaders(t, r1.headers, {
		...BASE_HEADERS,
		'cache-control': 'public, max-age=123',
	})

	const {res: r2} = await fetch(t, BUF, {}, {
		maxAge: 321 * 1000,
		immutable: true,
	})
	expectHeaders(t, r2.headers, {
		...BASE_HEADERS,
		'cache-control': 'public, max-age=321, immutable',
	})
})

test('content-encoding', async (t) => {
	const gzip = async () => ({
		compressedBuffer: BUF_GZIP,
		compressedEtag: '"foo gzip"',
	})
	const brotliCompress = async () => ({
		compressedBuffer: BUF_BROTLI,
		compressedEtag: '"foo brotli"',
	})

	const withAccEnc = ae => ({headers: {'accept-encoding': ae}})
	const eqlBuf = (actualBuf, expectedBuf, msg) => {
		t.equal(actualBuf.toString('hex'), expectedBuf.toString('hex'), msg)
	}

	// supports HEAD requests
	const {res: r0, buf: b0} = await fetch(t, BUF, {
		method: 'HEAD',
		...withAccEnc('gzip'),
	}, {
		gzip: async () => ({
			compressedBuffer: BUF_GZIP,
			compressedEtag: null,
		}),
		brotliCompress: false,
	})
	expectHeaders(t, r0.headers, {
		...BASE_HEADERS,
		'content-encoding': 'gzip',
		etag: undefined,
		'content-length': BUF_GZIP.length + '',
	})
	t.equal(b0.length, 0, 'HEAD body is not empty')

	// supports `accept-encoding: gzip`
	const {res: r1, buf: b1} = await fetch(t, BUF, withAccEnc('gzip'), {
		gzip,
		brotliCompress: false,
	})
	expectHeaders(t, r1.headers, {
		...BASE_HEADERS,
		'content-encoding': 'gzip',
		'etag': '"foo gzip"',
		'content-length': BUF_GZIP.length + '',
	})
	eqlBuf(b1, BUF_GZIP, 'body is not gzipped')

	// supports `accept-encoding: br`
	const {res: r2, buf: b2} = await fetch(t, BUF, withAccEnc('br'), {
		gzip: false,
		brotliCompress,
		etag: '"bar"', // should not be used
	})
	expectHeaders(t, r2.headers, {
		...BASE_HEADERS,
		'content-encoding': 'br',
		'etag': '"foo brotli"',
		'content-length': BUF_BROTLI.length + '',
	})
	eqlBuf(b2, BUF_BROTLI, 'body is not brotli-compressed')

	// ignores `accept-encoding: identity`
	const {res: r3, buf: b3} = await fetch(t, BUF, withAccEnc('identity'), {
		gzip,
		brotliCompress,
	})
	expectHeaders(t, r3.headers, BASE_HEADERS)
	eqlBuf(b3, BUF, 'body is encoded')

	// picks preferred with >1 encoding, without ETag
	const {res: r4, buf: b4} = await fetch(t, BUF, withAccEnc('br, gzip'), {
		gzip,
		brotliCompress: async () => ({
			compressedBuffer: BUF_BROTLI,
			compressedEtag: null,
		}),
		etag: '"foo"', // should not be used
	})
	expectHeaders(t, r4.headers, {
		...BASE_HEADERS,
		'content-encoding': 'br',
		'etag': undefined,
		'content-length': BUF_BROTLI.length + '',
	})
	eqlBuf(b4, BUF_BROTLI, 'body is not brotli-compressed')

	const {res: r5} = await fetch(t, BUF, withAccEnc('br, gzip'), {
		gzip: async () => ({
			compressedBuffer: BUF_GZIP,
			compressedEtag: null,
		}),
		brotliCompress: false,
	})
	expectHeaders(t, r5.headers, {
		...BASE_HEADERS,
		'content-encoding': 'gzip',
		'etag': undefined,
		'content-length': BUF_GZIP.length + '',
	})

	const {res: r6, buf: b6} = await fetch(t, BUF, {
		headers: {
			'accept-encoding': 'br',
			'range': 'bytes=2-4',
		},
	}, {
		gzip: false,
		brotliCompress: async () => ({
			compressedBuffer: BUF_BROTLI,
			compressedEtag: null,
		}),
	})
	t.equal(r6.statusCode, 206, 'status code is 206')
	expectHeaders(t, r6.headers, {
		...BASE_HEADERS,
		'content-encoding': 'br',
		etag: undefined,
		'content-range': 'bytes 2-4/' + BUF_BROTLI.length,
		'content-length': '3',
	})
	// https://stackoverflow.com/a/11664307
	eqlBuf(b6, BUF_BROTLI.slice(2, 5), 'body is not a range of the brotli-compressed buffer')

	// compresses by default
	{
		const {res, buf} = await fetch(t, BUF, withAccEnc('gzip'), {
			brotliCompress: false,
		})
		expectHeaders(t, res.headers, {
			...BASE_HEADERS,
			'content-encoding': 'gzip',
			'etag': etag(BUF_GZIP),
			'content-length': BUF_GZIP.length + '',
		})
		eqlBuf(buf, BUF_GZIP, 'body is not gzipped')
	}
	{
		const {res, buf} = await fetch(t, BUF, withAccEnc('br'), {
			gzip: false,
		})
		expectHeaders(t, res.headers, {
			...BASE_HEADERS,
			'content-encoding': 'br',
			'etag': etag(BUF_BROTLI),
			'content-length': BUF_BROTLI.length + '',
		})
		eqlBuf(buf, BUF_BROTLI, 'body is not brotli-compressed')
	}

	// turning off compression works
	{
		const {res, buf} = await fetch(t, BUF, withAccEnc('br', 'gzip'), {
			gzip: false,
			brotliCompress: false,
		})
		expectHeaders(t, res.headers, BASE_HEADERS)
		eqlBuf(buf, BUF, 'body is compressed')
	}

	// does not compress large buffers
	{
		const {res} = await fetch(t, BUF_50M, {
			...withAccEnc('gzip'),
			method: 'HEAD',
		})
		expectHeaders(t, res.headers, {
			...BASE_HEADERS,
			etag: etag(BUF_50M),
			'content-length': BUF_50M.length + '',
		})
	}
	{
		const {res} = await fetch(t, BUF_5M, {
			...withAccEnc('gzip'),
			method: 'HEAD',
		})
		expectHeaders(t, res.headers, {
			...BASE_HEADERS,
			'content-encoding': 'gzip',
			etag: etag(BUF_5M_GZIP),
			'content-length': BUF_5M_GZIP.length + '',
		})
	}
	{
		const {res} = await fetch(t, BUF_5M, {
			...withAccEnc('br'),
			method: 'HEAD',
		})
		expectHeaders(t, res.headers, {
			...BASE_HEADERS,
			etag: etag(BUF_5M),
			'content-length': BUF_5M.length + '',
		})
	}
})

test('content-encoding & caching', async (t) => {
	{
		await expect(t, BUF, {
			'accept-encoding': 'gzip',
			'if-none-match': etag(BUF_GZIP),
		}, 304)
	}
	{
		await expect(t, BUF, {
			'accept-encoding': 'br',
			'if-none-match': etag(BUF_BROTLI),
		}, 304)
	}
})

test('content-encoding lazy', async (t) => {
	const serveOpts = {
		etag: '"foo"', // should not be used
		gzip: buf => ({
			compressedBuffer: BUF_GZIP,
			compressedEtag: '"bar gzip"',
		}),
		brotliCompress: buf => ({
			compressedBuffer: BUF_BROTLI,
			compressedEtag: '"bar brotli"',
		}),
	}

	const withAccEnc = ae => ({headers: {'accept-encoding': ae}})
	const eqlBuf = (actualBuf, expectedBuf, msg) => {
		t.equal(actualBuf.toString('hex'), expectedBuf.toString('hex'), msg)
	}

	// supports `accept-encoding: gzip`
	const {res: r1, buf: b1} = await fetch(t, BUF, withAccEnc('gzip'), serveOpts)
	expectHeaders(t, r1.headers, {
		...BASE_HEADERS,
		'content-encoding': 'gzip',
		'etag': '"bar gzip"',
		'content-length': BUF_GZIP.length + '',
	})
	eqlBuf(b1, BUF_GZIP, 'body is not gzipped')

	// supports `accept-encoding: br`
	const {res: r2, buf: b2} = await fetch(t, BUF, withAccEnc('br'), serveOpts)
	expectHeaders(t, r2.headers, {
		...BASE_HEADERS,
		'content-encoding': 'br',
		'etag': '"bar brotli"',
		'content-length': BUF_BROTLI.length + '',
	})
	eqlBuf(b2, BUF_BROTLI, 'body is not brotli-compressed')
})
