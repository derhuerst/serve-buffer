'use strict'

const {promisify} = require('util')
const {gzip, brotliCompress} = require('zlib')
const {performance} = require('perf_hooks')
const computeEtag = require('etag')
const debugCompression = require('debug')('serve-buffer:compression')
const _serveBuffer = require('./lib/serve-buffer')

const pGzip = promisify(gzip)
const pBrotliCompress = promisify(brotliCompress)

const compression = (compress, name, maxSize, unmutatedBuffers) => {
	const cache = new WeakMap()
	return async (buf) => {
		if (buf.length > maxSize) {
			debugCompression(`buffer is larger than ${maxSize} (${buf.length}), skipping compression`)
			return {compressedBuffer: null, compressedEtag: null}
		}
		if (unmutatedBuffers && cache.has(buf)) return cache.get(buf)

		const t0 = performance.now()
		const compressedBuffer = await compress(buf)
		const t1 = performance.now()
		// todo: is there an async version of this?
		const compressedEtag = computeEtag(compressedBuffer)
		const t2 = performance.now()
		debugCompression(`${name}-compressed in ${(t1 - t0).toFixed(1)}ms, computed ETag in ${(t2 - t1).toFixed(1)}ms`)

		const res = {compressedBuffer, compressedEtag}
		if (unmutatedBuffers) cache.set(buf, res)
		return res
	}
}

const serveBuffer = (req, res, buf, opt, cb) => {
	if (cb === undefined && 'function' === typeof opt) {
		cb = opt
		opt = {}
	}

	opt = {
		gzip: true,
		gzipMaxSize: 10 * 1024 * 1024, // 10mb
		brotliCompress: true,
		brotliCompressMaxSize: 512 * 1024, // 512kb
		// Assume that Buffers passed in as `buf` never get mutated? If `true`,
		// each compressed buffer & compressed ETag will be cached as long as
		// the buffer instance exists.
		unmutatedBuffers: false,

		...opt,
	}

	if (opt.gzip === true) {
		opt.gzip = compression(
			pGzip,
			'gzip',
			opt.gzipMaxSize,
			opt.unmutatedBuffers,
		)
	} else if (opt.gzip === false) {
		opt.gzip = null
	} else if ('function' !== typeof opt.gzip) {
		throw new TypeError('opt.gzip must be true, false or an async function')
	}
	if (opt.brotliCompress === true) {
		opt.brotliCompress = compression(
			pBrotliCompress,
			'brotliCompress',
			opt.brotliCompressMaxSize,
			opt.unmutatedBuffers,
		)
	} else if (opt.brotliCompress === false) {
		opt.brotliCompress = null
	} else if ('function' !== typeof opt.brotliCompress) {
		throw new TypeError('opt.brotliCompress must be true, false or an async function')
	}

	if ('function' !== typeof cb) {
		cb = (err) => {
			if (!err) return
			throw err
		}
	}
	_serveBuffer(req, res, buf, opt)
	.then(() => cb(), cb)
}

module.exports = serveBuffer
