'use strict'

const tapePromise = require('tape-promise').default
const tape = require('tape')
const {createServer, request} = require('http')
const {promisify} = require('util')
const {buffer: collect} = require('get-stream')
const etag = require('etag')
const serveBuffer = require('.')

const test = tapePromise(tape)

const fetch = async (serve, reqOpts) => {
	const server = createServer(serve)
	const stop = promisify(server.close.bind(server))

	await promisify(server.listen.bind(server))()
	const {address, port} = server.address()

	try {
		const res = await new Promise((resolve, reject) => {
			const req = request({
				...reqOpts,
				host: address, port,
				timeout: 2 * 1000,
			}, resolve)
			req.once('error', reject)
			req.end()
		})
		const buf = await collect(res)
		await stop()
		return {res, buf}
	} catch (err) {
		stop()
		throw err
	}
}

const expectHeaders = (t, headers, expHeaders) => {
	for (const [name, val] of Object.entries(expHeaders)) {
		t.equal(headers[name], val, `headers.${name} is not equal`)
	}
}
const expect = async (t, reqBuf, headers, expCode = 200, expHeaders = {}) => {
	const serve = serveBuffer(reqBuf)
	const {res, buf, stop} = await fetch(serve, {headers})

	t.equal(res.statusCode, expCode, 'status code is not equal')
	expectHeaders(t, res.headers, expHeaders)
	return {res, buf}
}
const expectData = async (t, reqBuf, headers, expBuf, expCode = 200, expHeaders = {}) => {
	const serve = serveBuffer(reqBuf)
	const {res, buf, stop} = await fetch(serve, {headers})

	t.equal(res.statusCode, expCode, 'status code is not equal')
	expectHeaders(t, res.headers, expHeaders)
	t.equal(buf.toString('hex'), expBuf.toString('hex'), 'response data is not equal')
	return {res, buf}
}

const BUF = Buffer.from('fedcba0987654321', 'hex')
const b = (hex = '') => Buffer.from(hex, 'hex')

const BASE_HEADERS = {
	'accept-ranges': 'bytes',
	'cache-control': 'public, max-age=0',
	'content-type': 'application/octet-stream',
	'etag': etag(BUF),
	'content-length': '8',
}

test('whole Buffer, without ETags', async (t) => {
	const {res} = await expectData(t, BUF, {}, BUF, 200, BASE_HEADERS)
	const lastModified = res.headers['last-modified']
	t.ok(lastModified, 'last-modified header is missing/invalid')
	t.ok((Date.now() - new Date(lastModified)) < 2 * 1000, 'last-modified header is invalid')
	t.end()
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
	t.end()
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
	t.end()
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
		'cache-control': 'public, max-age=0',
		'etag': etag(b()),
	})
	t.end()
})

test('HEAD', async (t) => {
	const {buf, res, stop} = await fetch(serveBuffer(BUF), {method: 'HEAD'})
	t.equal(buf.length, 0)
	await expectHeaders(t, res.headers, BASE_HEADERS)

	t.end()
})

// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/test/send.js#L561-L673

test('unsatisfiable range', async (t) => {
	await expect(t, BUF, {
		'range': 'bytes=8-10',
	}, 416, {
		'content-range': 'bytes */8',
	})
	t.end()
})

test('range 2-4', async (t) => {
	await expectData(t, BUF, {
		'range': 'bytes=2-4',
	}, b('ba0987'), 206, {
		...BASE_HEADERS,
		'content-range': 'bytes 2-4/8',
		'content-length': '3', // range is inclusive
	})
	t.end()
})

test('range -3', async (t) => {
	await expectData(t, BUF, {
		'range': 'bytes=-3',
	}, BUF.slice(-3), 206, {
		...BASE_HEADERS,
		'content-range': 'bytes 5-7/8',
		'content-length': '3',
	})
	t.end()
})

test('range 3-', async (t) => {
	await expectData(t, BUF, {
		'range': 'bytes=3-',
	}, BUF.slice(3), 206, {
		...BASE_HEADERS,
		'content-range': 'bytes 3-7/8',
		'content-length': '5',
	})
	t.end()
})

test('multiple ranges', async (t) => {
	const expectFull = async (range) => {
		await expectData(t, BUF, {range}, BUF, 200, BASE_HEADERS)
	}
	await expectFull('bytes=1-3,5-7')
	await expectFull('bytes=1-3,5-')
	await expectFull('bytes=1-3,-2')
	t.end()
})
