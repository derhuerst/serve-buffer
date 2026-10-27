'use strict'

const {promisify} = require('util')
const {gzip, brotliCompress, zstdCompress} = require('zlib')
const {performance} = require('perf_hooks')
const computeEtag = require('etag')
const debugCompression = require('debug')('serve-buffer:compression')
const _serveBuffer = require('./lib/serve-buffer')

const pGzip = promisify(gzip)
const pBrotliCompress = promisify(brotliCompress)
const pZstdCompress = promisify(zstdCompress)

const compression = (compress, name, maxSize, unmutatedBuffers, cache) => {
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

// todo [breaking]: this is ugly, make `serveBuffer` a closure
const gzipCache = new WeakMap()
const brotliCompressCache = new WeakMap()
const zstdCompressCache = new WeakMap()

const serveBuffer = async (req, res, buf, opt) => {
	opt = {
		gzip: true,
		gzipMaxSize: 10 * 1024 * 1024, // 10mb
		brotliCompress: true,
		brotliCompressMaxSize: 512 * 1024, // 512kb
		zstdCompress: true,
		zstdCompressMaxSize: 10 * 1024 * 1024, // 10mb
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
			gzipCache,
		)
	} else if (opt.gzip === false) {
		opt.gzip = null
	} else if ('function' !== typeof opt.gzip) {
		throw new TypeError('opt.gzip must be true, false or an async function')
	}
	if (opt.brotliCompress === true) {
		opt.brotliCompress = compression(
			pBrotliCompress,
			'brotli',
			opt.brotliCompressMaxSize,
			opt.unmutatedBuffers,
			brotliCompressCache,
		)
	} else if (opt.brotliCompress === false) {
		opt.brotliCompress = null
	} else if ('function' !== typeof opt.brotliCompress) {
		throw new TypeError('opt.brotliCompress must be true, false or an async function')
	}
	if (opt.zstdCompress === true) {
		opt.zstdCompress = compression(
			pZstdCompress,
			'zstd',
			opt.zstdCompressMaxSize,
			opt.unmutatedBuffers,
			zstdCompressCache,
		)
	} else if (opt.zstdCompress === false) {
		opt.zstdCompress = null
	} else if ('function' !== typeof opt.zstdCompress) {
		throw new TypeError('opt.zstdCompress must be true, false or an async function')
	}

	try {
		await _serveBuffer(req, res, buf, opt)
	} catch (err) {
		if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
		throw err
	}
}

module.exports = serveBuffer
