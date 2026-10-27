'use strict'

const {
	ifError,
	strictEqual,
	partialDeepStrictEqual,
} = require('node:assert/strict')
const test = require('node:test')
const {createServer, request} = require('http')
const {promisify} = require('util')
const {buffer: collect} = require('get-stream')
const etag = require('etag')
const {gzipSync, brotliCompressSync, zstdCompress} = require('zlib')
const omit = require('lodash/omit.js')
const serveBuffer = require('.')

const T0 = 12345678

const fetch = async (buf, reqOpts = {}, serveOpts = {}) => {
	let cbCalls = 0
	const cb = (err) => {
		cbCalls++
		ifError(err)
	}

	let negotiatedState = {}
	const server = createServer((req, res) => {
		serveBuffer(req, res, buf, {
			etag: etag(buf),
			timeModified: new Date(T0),
			beforeSend: (req, res, body, opt, _negotiatedState) => {
				negotiatedState = _negotiatedState
			},
			...serveOpts,
		}, cb)
	})
	const stop = promisify(server.close.bind(server))

	await promisify(server.listen.bind(server))({
		host: '127.0.0.1',
		port: 10000 + Math.round(Math.random() * 9999),
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
		strictEqual(cbCalls, 1, 'cb not called once')
		await stop()
		return {
			res,
			buf,
			negotiatedState,
		}
	} catch (err) {
		await stop()
		throw err
	}
}

const expectHeaders = (headers, expHeaders) => {
	partialDeepStrictEqual(headers, expHeaders)
}
const expectNegotiatedState = (negotiatedState, expNegotiatedState) => {
	partialDeepStrictEqual(negotiatedState, expNegotiatedState)
}

const expect = async (_buf, headers, expCode = 200, expHeaders = {}, expNegotiatedState = {}) => {
	const {
		res,
		negotiatedState,
		buf,
	} = await fetch(_buf, {headers})

	strictEqual(res.statusCode, expCode, 'status code is not equal')
	expectHeaders(res.headers, expHeaders)
	expectNegotiatedState(negotiatedState, expNegotiatedState)
	return {
		res,
		negotiatedState,
		buf,
	}
}
const expectData = async (_buf, headers, expBuf, expCode = 200, expHeaders = {}, expNegotiatedState = {}) => {
	const {
		res,
		negotiatedState,
		buf,
	} = await fetch(_buf, {headers})

	strictEqual(res.statusCode, expCode, 'status code is not equal')
	expectHeaders(res.headers, expHeaders)
	expectNegotiatedState(negotiatedState, expNegotiatedState)
	strictEqual(buf.toString('hex'), expBuf.toString('hex'), 'response data is not equal')
	return {
		res,
		negotiatedState,
		buf,
	}
}

const BUF = Buffer.from('fedcba0987654321', 'hex')
const BUF_GZIP = gzipSync(BUF)
const BUF_BROTLI = brotliCompressSync(BUF)
// As of 2026-10-27 and Node.js v22.23.4, zstdCompress() and zstdCompressSync() do not yield the same output! [1]
// This was fixed [1] on 2026-09-29 [2], but the fix has not been released and the release distributed.
// [1] https://github.com/nodejs/node/pull/66358
// [2] https://github.com/nodejs/node/commit/fa4af164144545f15dbc46bc5fe72fef80da278a
// As a workaround, we zstdCompress() only.
const pZstdCompress = promisify(zstdCompress)
const P_BUF_ZSTD = pZstdCompress(BUF)
const BUF_5M = Buffer.alloc(5 * 1024 * 1024)
const BUF_5M_GZIP = gzipSync(BUF_5M)
const BUF_5M_ZSTD = pZstdCompress(BUF_5M)
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

test('whole Buffer, without ETags', async () => {
	await expectData(BUF, {}, BUF, 200, BASE_HEADERS)
})

test('whole Buffer, with non-matching ETags', async () => {
	await expect(BUF, {
		'if-match': [etag(BUF.slice(1)), etag(BUF.slice(3))].join(', '),
	}, 412, {}, {
		preconditionFailed: true,
	})
	await expect(BUF, {
		'if-match': ['"foo"'].join(', '),
	}, 412, {}, {
		preconditionFailed: true,
	})
	await expectData(BUF, {
		'if-match': '*',
	}, BUF, 200)
})

test('whole Buffer, with cache', async () => {
	await expectData(BUF, {
		'if-match': [etag(BUF.slice(1)), etag(BUF)].join(', '),
	}, BUF, 200)
	await expect(BUF, {
		'if-none-match': [etag(BUF.slice(1)), etag(BUF)].join(', '),
	}, 304, {}, {
		clientIsFresh: true,
	})
	await expect(BUF, {
		'if-none-match': '*',
	}, 304, {}, {
		clientIsFresh: true,
	})
})

test('empty Buffer', async () => {
	await expectData(b(), {}, b(), 200, {
		...BASE_HEADERS,
		'etag': etag(b()),
		'content-length': '0',
	})
	await expect(b(), {
		'if-none-match': [etag(BUF.slice(5)), etag(b())].join(', '),
	}, 304, {
		'accept-ranges': 'bytes',
		// 'cache-control': 'public, max-age=0',
		'etag': etag(b()),
	}, {
		clientIsFresh: true,
	})
})

test('HEAD', async () => {
	const {
		buf,
		negotiatedState,
		res,
	} = await fetch(BUF, {method: 'HEAD'})
	strictEqual(buf.length, 0)
	expectHeaders(res.headers, BASE_HEADERS)
	expectNegotiatedState(negotiatedState, {
		headersOnly: true,
	})
})

// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/test/send.js#L561-L673

test('unsatisfiable range', async () => {
	await expect(BUF, {
		'range': 'bytes=8-10',
	}, 416, {
		'content-range': 'bytes */8',
	}, {
		rangeIsUnsatisfiable: true,
	})
})

test('range 2-4', async () => {
	await expectData(BUF, {
		'range': 'bytes=2-4',
	}, b('ba0987'), 206, {
		...BASE_HEADERS,
		'content-range': 'bytes 2-4/8',
		'content-length': '3', // range is inclusive
	}, {
		range: true,
	})
})

test('range -3', async () => {
	await expectData(BUF, {
		'range': 'bytes=-3',
	}, BUF.slice(-3), 206, {
		...BASE_HEADERS,
		'content-range': 'bytes 5-7/8',
		'content-length': '3',
	}, {
		range: true,
	})
})

test('range 3-', async () => {
	await expectData(BUF, {
		'range': 'bytes=3-',
	}, BUF.slice(3), 206, {
		...BASE_HEADERS,
		'content-range': 'bytes 3-7/8',
		'content-length': '5',
	}, {
		range: true,
	})
})

test('ignores multi-ranges', async () => {
	const expectFull = async (range) => {
		await expectData(BUF, {range}, BUF, 200, BASE_HEADERS)
	}
	await expectFull('bytes=1-3,5-7')
	await expectFull('bytes=1-3,5-')
	await expectFull('bytes=1-3,-2')
})

test('range 2-4, if-range', async () => {
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
		await expectData(BUF, {
			'if-range': etag(BUF),
			'range': 'bytes=2-4',
		}, BUF.slice(2, 5), 206, {
			...BASE_HEADERS,
			'content-range': 'bytes 2-4/8',
			'content-length': '3', // range is inclusive
		}, {
			range: true,
		})
	}
	// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/test/send.js#L691-L704
	{
		await expectData(BUF, {
			'if-range': '"some other etag"',
			'range': 'bytes=2-4',
		}, BUF, 200, BASE_HEADERS)
	}
	// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/test/send.js#L706-L719
	{
		await expectData(BUF, {
			'if-range': new Date(T0).toUTCString(),
			'range': 'bytes=2-4',
		}, BUF.slice(2, 5), 206, {
			...BASE_HEADERS,
			'content-range': 'bytes 2-4/8',
			'content-length': '3', // range is inclusive
		}, {
			range: true,
		})
	}
	// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/test/send.js#L721-L734
	{
		await expectData(BUF, {
			'if-range': new Date(T0 + 1000).toUTCString(),
			'range': 'bytes=2-4',
		}, BUF, 200, BASE_HEADERS)
	}
	// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/test/send.js#L736-L742
	{
		await expectData(BUF, {
			'if-range': 'foo',
			'range': 'bytes=2-4',
		}, BUF, 200, BASE_HEADERS)
	}
})

test('range 2-4, caching', async () => {
	// The Range header field is evaluated after evaluating the precondition
	// header fields defined in [RFC7232], and only if the result in absence
	// of the Range header field would be a 200 (OK) response.  In other
	// words, Range is ignored when a conditional GET would result in a 304
	// (Not Modified) response.
	// https://datatracker.ietf.org/doc/html/rfc7233#section-3.1
	{
		await expectData(BUF, {
			'if-none-match': etag(BUF),
			'range': 'bytes=2-4',
		}, b(), 304, omit(BASE_HEADERS, [
			'content-length',
		]), {
			clientIsFresh: true,
		})
	}
	{
		await expectData(BUF, {
			'if-none-match': '"some other etag"',
			'range': 'bytes=2-4',
		}, BUF.slice(2, 5), 206, {
			...BASE_HEADERS,
			'content-range': 'bytes 2-4/8',
			'content-length': '3', // range is inclusive
		}, {
			range: true,
		})
	}

	// with if-range in addition
	{
		await expectData(BUF, {
			'if-none-match': '"some other etag"',
			'if-range': etag(BUF),
			'range': 'bytes=2-4',
		}, BUF.slice(2, 5), 206, {
			...BASE_HEADERS,
			'content-range': 'bytes 2-4/8',
			'content-length': '3', // range is inclusive
		}, {
			range: true,
		})
	}
	{
		await expectData(BUF, {
			'if-none-match': '"some other etag"',
			'if-range': '"some other etag"',
			'range': 'bytes=2-4',
		}, BUF, 200, BASE_HEADERS)
	}
	{
		await expectData(BUF, {
			'if-none-match': etag(BUF),
			'if-range': '"some other etag"',
			'range': 'bytes=2-4',
		}, b(), 304, omit(BASE_HEADERS, [
			'content-length',
		]), {
			clientIsFresh: true,
		})
	}
	{
		await expectData(BUF, {
			'if-none-match': etag(BUF),
			'if-range': etag(BUF),
			'range': 'bytes=2-4',
		}, b(), 304, omit(BASE_HEADERS, [
			'content-length',
		]), {
			clientIsFresh: true,
		})
	}
})

test('opt.getTimeModified', async () => {
	const mtime = new Date(1234567890 * 1000)
	const _fetch = (headers = {}) => {
		return fetch(BUF, {headers}, {timeModified: mtime})
	}

	const {res: res1} = await _fetch({})
	strictEqual(res1.headers['last-modified'], mtime.toUTCString())

	const earlier = new Date(mtime - 2000).toUTCString()
	const {res: res2} = await _fetch({
		'if-modified-since': earlier,
	})
	strictEqual(res2.statusCode, 200)
	const {res: res3} = await _fetch({
		'if-unmodified-since': earlier,
	})
	strictEqual(res3.statusCode, 412)

	const later = new Date(mtime + 1000).toUTCString()
	const {res: res4} = await _fetch({
		'if-modified-since': later,
	})
	strictEqual(res4.statusCode, 304)
	const {res: res5} = await _fetch({
		'if-unmodified-since': later,
	})
	strictEqual(res5.statusCode, 200)
})

test('opt.etag', async () => {
	const e = etag('foo')
	const {res} = await fetch(BUF, {}, {etag: e})
	strictEqual(res.headers['etag'], e)
})

test('opt.cacheControl, opt.maxAge, opt.immutable', async () => {
	const {res: r1} = await fetch(BUF, {}, {
		maxAge: 123 * 1000,
	})
	expectHeaders(r1.headers, {
		...BASE_HEADERS,
		'cache-control': 'public, max-age=123',
	})

	const {res: r2} = await fetch(BUF, {}, {
		maxAge: 321 * 1000,
		immutable: true,
	})
	expectHeaders(r2.headers, {
		...BASE_HEADERS,
		'cache-control': 'public, max-age=321, immutable',
	})
})

test('content negotiation', async (t)=> {
	const BUF_ZSTD = await P_BUF_ZSTD

	const gzip = async () => ({
		compressedBuffer: BUF_GZIP,
		compressedEtag: '"foo gzip"',
	})
	const brotliCompress = async () => ({
		compressedBuffer: BUF_BROTLI,
		compressedEtag: '"foo brotli"',
	})
	const zstdCompress = async () => ({
		compressedBuffer: BUF_ZSTD,
		compressedEtag: '"foo zstd"',
	})

	const withAccEnc = ae => ({headers: {'accept-encoding': ae}})
	const eqlBuf = (actualBuf, expectedBuf, msg) => {
		strictEqual(actualBuf.toString('hex'), expectedBuf.toString('hex'), msg)
	}

	// supports HEAD requests
	{
		const {
			res,
			negotiatedState,
			buf,
		} = await fetch(BUF, {
			method: 'HEAD',
			...withAccEnc('gzip'),
		}, {
			gzip: async () => ({
				compressedBuffer: BUF_GZIP,
				compressedEtag: null,
			}),
			brotliCompress: false,
			zstdCompress: false,
		})
		expectHeaders(res.headers, {
			...omit(BASE_HEADERS, [
				'etag',
			]),
			'content-encoding': 'gzip',
			'content-length': BUF_GZIP.length + '',
		})
		expectNegotiatedState(negotiatedState, {
			encoding: 'gzip',
			headersOnly: true,
		})
		strictEqual(buf.length, 0, 'HEAD body is not empty')
	}

	// supports `accept-encoding: gzip`
	{
		const {
			res,
			negotiatedState,
			buf,
		} = await fetch(BUF, withAccEnc('gzip'), {
			gzip,
			brotliCompress: false,
			zstdCompress: false,
		})
		expectHeaders(res.headers, {
			...BASE_HEADERS,
			'content-encoding': 'gzip',
			'etag': '"foo gzip"',
			'content-length': BUF_GZIP.length + '',
		})
		expectNegotiatedState(negotiatedState, {
			encoding: 'gzip',
		})
		eqlBuf(buf, BUF_GZIP, 'body is not gzipped')
	}

	// supports `accept-encoding: br`
	{
		const {
			res,
			negotiatedState,
			buf,
		} = await fetch(BUF, withAccEnc('br'), {
			gzip: false,
			brotliCompress,
			zstdCompress: false,
			etag: '"bar"', // should not be used
		})
		expectHeaders(res.headers, {
			...BASE_HEADERS,
			'content-encoding': 'br',
			'etag': '"foo brotli"',
			'content-length': BUF_BROTLI.length + '',
		})
		expectNegotiatedState(negotiatedState, {
			encoding: 'br',
		})
		eqlBuf(buf, BUF_BROTLI, 'body is not brotli-compressed')
	}

	// supports `accept-encoding: zstd`
	{
		const {
			res,
			negotiatedState,
			buf,
		} = await fetch(BUF, withAccEnc('zstd'), {
			gzip: false,
			brotliCompress: false,
			zstdCompress,
			etag: '"bar"', // should not be used
		})
		expectHeaders(res.headers, {
			...BASE_HEADERS,
			'content-encoding': 'zstd',
			'etag': '"foo zstd"',
			'content-length': BUF_ZSTD.length + '',
		})
		expectNegotiatedState(negotiatedState, {
			encoding: 'zstd',
		})
		eqlBuf(buf, BUF_ZSTD, 'body is not zstd-compressed')
	}

	// ignores `accept-encoding: identity`
	{
		const {
			res,
			buf,
		} = await fetch(BUF, withAccEnc('identity'), {
			gzip,
			brotliCompress,
			zstdCompress,
		})
		expectHeaders(res.headers, BASE_HEADERS)
		eqlBuf(buf, BUF, 'body is encoded')
	}

	// picks preferred with >1 encoding, without ETag
	{
		const {
			res,
			negotiatedState,
			buf,
		} = await fetch(BUF, withAccEnc('br, gzip, zstd'), {
			gzip,
			brotliCompress: async () => ({
				compressedBuffer: BUF_BROTLI,
				compressedEtag: null,
			}),
			zstdCompress,
			etag: '"foo"', // should not be used
		})
		expectHeaders(res.headers, {
			...omit(BASE_HEADERS, [
				'etag',
			]),
			'content-encoding': 'br',
			'content-length': BUF_BROTLI.length + '',
		})
		expectNegotiatedState(negotiatedState, {
			encoding: 'br',
		})
		eqlBuf(buf, BUF_BROTLI, 'body is not brotli-compressed')
	}
	{
		const {
			res,
			negotiatedState,
			buf,
		} = await fetch(BUF, withAccEnc('br, gzip, zstd'), {
			gzip: async () => ({
				compressedBuffer: BUF_GZIP,
				compressedEtag: null,
			}),
			brotliCompress: false,
			zstdCompress: false,
		})
		expectHeaders(res.headers, {
			...omit(BASE_HEADERS, [
				'etag',
			]),
			'content-encoding': 'gzip',
			'content-length': BUF_GZIP.length + '',
		})
		expectNegotiatedState(negotiatedState, {
			encoding: 'gzip',
		})
		eqlBuf(buf, BUF_GZIP, 'body is not gzip-compressed')
	}
	{
		const {
			res,
			negotiatedState,
			buf,
		} = await fetch(BUF, withAccEnc('br, gzip, zstd'), {
			gzip: false,
			brotliCompress: false,
			zstdCompress: async () => ({
				compressedBuffer: BUF_ZSTD,
				compressedEtag: null,
			}),
		})
		expectHeaders(res.headers, {
			...omit(BASE_HEADERS, [
				'etag',
			]),
			'content-encoding': 'zstd',
			'content-length': BUF_ZSTD.length + '',
		})
		expectNegotiatedState(negotiatedState, {
			encoding: 'zstd',
		})
		eqlBuf(buf, BUF_ZSTD, 'body is not zstandard-compressed')
	}

	{
		const {
			res,
			negotiatedState,
			buf,
		} = await fetch(BUF, {
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
			zstdCompress: false,
		})
		strictEqual(res.statusCode, 206, 'status code is 206')
		expectHeaders(res.headers, {
			...omit(BASE_HEADERS, [
				'etag',
			]),
			'content-encoding': 'br',
			'content-range': 'bytes 2-4/' + BUF_BROTLI.length,
			'content-length': '3',
		})
		expectNegotiatedState(negotiatedState, {
			encoding: 'br',
			range: true,
		})
		// https://stackoverflow.com/a/11664307
		eqlBuf(buf, BUF_BROTLI.slice(2, 5), 'body is not a range of the brotli-compressed buffer')
	}

	// compresses by default
	{
		const {res, buf} = await fetch(BUF, withAccEnc('gzip'), {
			brotliCompress: false,
			zstdCompress: false,
		})
		expectHeaders(res.headers, {
			...BASE_HEADERS,
			'content-encoding': 'gzip',
			'etag': etag(BUF_GZIP),
			'content-length': BUF_GZIP.length + '',
		})
		eqlBuf(buf, BUF_GZIP, 'body is not gzipped')
	}
	{
		const {res, buf} = await fetch(BUF, withAccEnc('br'), {
			gzip: false,
			zstdCompress: false,
		})
		expectHeaders(res.headers, {
			...BASE_HEADERS,
			'content-encoding': 'br',
			'etag': etag(BUF_BROTLI),
			'content-length': BUF_BROTLI.length + '',
		})
		eqlBuf(buf, BUF_BROTLI, 'body is not brotli-compressed')
	}
	{
		const {res, buf} = await fetch(BUF, withAccEnc('zstd'), {
			gzip: false,
			brotliCompress: false,
		})
		expectHeaders(res.headers, {
			...BASE_HEADERS,
			'content-encoding': 'zstd',
			'etag': etag(BUF_ZSTD),
			'content-length': BUF_ZSTD.length + '',
		})
		eqlBuf(buf, BUF_ZSTD, 'body is not zstandard-compressed')
	}

	// turning off compression works
	{
		const {res, buf} = await fetch(BUF, withAccEnc('br', 'gzip'), {
			gzip: false,
			brotliCompress: false,
			zstdCompress: false,
		})
		expectHeaders(res.headers, BASE_HEADERS)
		eqlBuf(buf, BUF, 'body is compressed')
	}

	// does not compress large buffers
	{
		const {res} = await fetch(BUF_50M, {
			...withAccEnc('gzip'),
			method: 'HEAD',
		})
		expectHeaders(res.headers, {
			...BASE_HEADERS,
			etag: etag(BUF_50M),
			'content-length': BUF_50M.length + '',
		})
	}
	{
		const {res} = await fetch(BUF_5M, {
			...withAccEnc('gzip'),
			method: 'HEAD',
		})
		expectHeaders(res.headers, {
			...BASE_HEADERS,
			'content-encoding': 'gzip',
			etag: etag(BUF_5M_GZIP),
			'content-length': BUF_5M_GZIP.length + '',
		})
	}
	{
		const {res} = await fetch(BUF_5M, {
			...withAccEnc('br'),
			method: 'HEAD',
		})
		expectHeaders(res.headers, {
			...BASE_HEADERS,
			etag: etag(BUF_5M),
			'content-length': BUF_5M.length + '',
		})
	}
	{
		const {res} = await fetch(BUF_50M, {
			...withAccEnc('zstd'),
			method: 'HEAD',
		})
		expectHeaders(res.headers, {
			...BASE_HEADERS,
			etag: etag(BUF_50M),
			'content-length': BUF_50M.length + '',
		})
	}
})

test('content-encoding & caching', async () => {
	const BUF_ZSTD = await P_BUF_ZSTD

	{
		await expect(BUF, {
			'accept-encoding': 'gzip',
			'if-none-match': etag(BUF_GZIP),
		}, 304, {}, {
			clientIsFresh: true,
		})
	}
	{
		await expect(BUF, {
			'accept-encoding': 'br',
			'if-none-match': etag(BUF_BROTLI),
		}, 304, {}, {
			clientIsFresh: true,
		})
	}
	{
		await expect(BUF, {
			'accept-encoding': 'zstd',
			'if-none-match': etag(BUF_ZSTD),
		}, 304, {}, {
			clientIsFresh: true,
		})
	}
})

test('content-encoding lazy', async () => {
	const BUF_ZSTD = await P_BUF_ZSTD

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
		zstdCompress: buf => ({
			compressedBuffer: BUF_ZSTD,
			compressedEtag: '"bar zstandard"',
		}),
	}

	const withAccEnc = ae => ({headers: {'accept-encoding': ae}})
	const eqlBuf = (actualBuf, expectedBuf, msg) => {
		strictEqual(actualBuf.toString('hex'), expectedBuf.toString('hex'), msg)
	}

	// supports `accept-encoding: gzip`
	{
		const {
			res,
			negotiatedState,
			buf,
		} = await fetch(BUF, withAccEnc('gzip'), serveOpts)
		expectHeaders(res.headers, {
			...BASE_HEADERS,
			'content-encoding': 'gzip',
			'etag': '"bar gzip"',
			'content-length': BUF_GZIP.length + '',
		})
		expectNegotiatedState(negotiatedState, {
			encoding: 'gzip',
		})
		eqlBuf(buf, BUF_GZIP, 'body is not gzipped')
	}

	// supports `accept-encoding: br`
	{
		const {
			res,
			negotiatedState,
			buf,
		} = await fetch(BUF, withAccEnc('br'), serveOpts)
		expectHeaders(res.headers, {
			...BASE_HEADERS,
			'content-encoding': 'br',
			'etag': '"bar brotli"',
			'content-length': BUF_BROTLI.length + '',
		})
		expectNegotiatedState(negotiatedState, {
			encoding: 'br',
		})
		eqlBuf(buf, BUF_BROTLI, 'body is not brotli-compressed')
	}

	// supports `accept-encoding: zstd`
	{
		const {
			res,
			negotiatedState,
			buf,
		} = await fetch(BUF, withAccEnc('zstd'), serveOpts)
		expectHeaders(res.headers, {
			...BASE_HEADERS,
			'content-encoding': 'zstd',
			'etag': '"bar zstandard"',
			'content-length': BUF_ZSTD.length + '',
		})
		expectNegotiatedState(negotiatedState, {
			encoding: 'zstd',
		})
		eqlBuf(buf, BUF_ZSTD, 'body is not zstandard-compressed')
	}
})
