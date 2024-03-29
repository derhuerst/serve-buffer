// Some parts of this code are taken from MIT-licensed pillarjs/send, authored by:
// - Douglas Christopher Wilson <doug@somethingdoug.com>
// - James Wyatt Cready <jcready@gmail.com>
// - Jesús Leganés Combarro <piranna@gmail.com>
'use strict'

const debug = require('debug')('serve-buffer')
const fresh = require('fresh')
const parseRanges = require('range-parser')
const {Readable} = require('stream')
const {pipeline} = require('stream/promises')
const negotiateEncoding = require('negotiator/lib/encoding')

const readBuf = (buf, from = 0, to = buf.length) => {
	let offset = from
	const read = function (size) {
		const end = Math.min(offset + size, to)
		this.push(buf.slice(offset, end))
		offset = end
		if (offset >= to) this.push(null) // EOF
	}
	return new Readable({read})
}

// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L307-L319
const isConditionalGET = (req) => {
	return !!(
		req.headers['if-match'] ||
		req.headers['if-unmodified-since'] ||
		req.headers['if-none-match'] ||
		req.headers['if-modified-since']
	)
}

// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L1078-L1112
const parseTokenList = (str) => {
	let end = 0
	const list = []
	let start = 0

	// gather tokens
	for (let i = 0, len = str.length; i < len; i++) {
		switch (str.charCodeAt(i)) {
			case 0x20: // ` `
				if (start === end) start = end = i + 1
			break
			case 0x2c: // `,`
				list.push(str.substring(start, end))
				start = end = i + 1
			break
			default:
				end = i + 1
			break
		}
	}

	// final token
	list.push(str.substring(start, end))

	return list
}

// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L1063-L1076
const parseHttpDate = (date) => {
	const t = date && Date.parse(date)
	return 'number' === typeof t ? t : NaN
}

// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L321-L349
const failsPrecondition = (req, resHeaders) => {
	// The `If-Match` header field makes the request method conditional on
	// the recipient origin server either having at least one current
	// representation of the target resource, when the field-value is `*`,
	// or having a current representation of the target resource that has an
	// entity-tag matching a member of the list of entity-tags provided in
	// the field-value.
	// https://tools.ietf.org/html/rfc7232#section-3.1
	const match = req.headers['if-match']
	if (match) {
		// `*` matches anything, so the precondition never fails.
		if (match === '*') return false
		// if-match requires an etag, so the precondition fails.
		if (!resHeaders['etag']) return true
		// An origin server MUST use the strong comparison function when
		// comparing entity-tags for If-Match […].
		// https://tools.ietf.org/html/rfc7232#section-3.1
		return !parseTokenList(match).includes(resHeaders['etag'])
	}

	// The "If-Unmodified-Since" header field makes the request method
	// conditional on the selected representation's last modification date
	// being earlier than or equal to the date provided in the field-value.
	// https://tools.ietf.org/html/rfc7232#section-3.4
	const unmodifiedSince = parseHttpDate(req.headers['if-unmodified-since'])
	if (!Number.isNaN(unmodifiedSince)) {
		return Date.parse(resHeaders['last-modified']) > unmodifiedSince
	}

	return false
}

// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L429-L441
const isClientFresh = (req, resHeaders) => {
	return fresh(req.headers, resHeaders)
}

// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L443-L466
const isClientRangeFresh = (req, resHeaders) => {
	// A server MUST ignore an `If-Range` header field received in a request
	// that does not contain a `Range` header field.
	// https://tools.ietf.org/html/rfc7233#section-3.2
	const range = req.headers['range']
	if (!range) return true

	const ifRange = req.headers['if-range']
	if (!ifRange) return true

	// A server that evaluates an `If-Range` precondition MUST use the strong
	// comparison function when comparing entity-tags […] and MUST evaluate the
	// condition as false if an `HTTP-date` validator is provided that is not a
	// strong validator […]. A valid entity-tag can be distinguished from a valid
	// `HTTP-date` by examining the first two characters for a `DQUOTE`.
	// […]
	// If the validator given in the `If-Range` header field matches the current
	// validator for the selected representation of the target resource, then the
	// server SHOULD process the `Range` header field as requested. If the
	// validator does not match, the server MUST ignore the `Range` header field.
	// https://tools.ietf.org/html/rfc7233#section-3.2

	// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L458
	// https://github.com/apache/httpd/blob/504f363b31cb7e3ad21a2c204d48b2bcd6d85d89/modules/http/http_protocol.c#L495
	// https://github.com/nginx/nginx/blob/2015a548214b08be1a556f8b8c447dcb61356448/src/http/modules/ngx_http_range_filter_module.c#L183
	if (ifRange[0] === '"' || ifRange[1] === '"') { // if-range as etag
		return resHeaders['etag'] && ifRange.includes(resHeaders['etag'])
	}

	// if-range as modification date
	// Note that this comparison by exact match, including when the validator
	// is an `HTTP-date`, differs from the "earlier than or equal to"
	// comparison used when evaluating an `If-Unmodified-Since` conditional.
	// https://tools.ietf.org/html/rfc7233#section-3.2
	const parsed = parseHttpDate(ifRange)
	// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L465
	// https://github.com/nginx/nginx/blob/2015a548214b08be1a556f8b8c447dcb61356448/src/http/modules/ngx_http_range_filter_module.c#L213
	// https://github.com/apache/httpd/blob/504f363b31cb7e3ad21a2c204d48b2bcd6d85d89/modules/http/http_protocol.c#L528-L539
	return !Number.isNaN(parsed) && parsed === Date.parse(resHeaders['last-modified'])
}

// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L259-L294
const respondEmptyWithStatus = (res, statusCode, beforeSend) => {
	// Nagle's algorithm delays data before it is sent via the network. It
	// attempts to optimize throughput at the expense of latency.
	// Passing true for noDelay or not passing an argument will disable Nagle's
	// algorithm for the socket.
	// https://nodejs.org/docs/latest-v16.x/api/net.html#socketsetnodelaynodelay
	res.socket.setNoDelay(true)

	// todo: clear headers already set
	res.statusCode = statusCode
	res.setHeader('content-security-policy', `default-src 'none'`)
	res.setHeader('x-content-type-options', 'nosniff')
	beforeSend()
	res.end()
}

const serveBuffer = async (req, res, buf, opt) => {
	opt = {
		contentType: 'application/octet-stream',
		timeModified: new Date(),
		etag: null,

		gzip: null,
		brotliCompress: null,

		cacheControl: true, // send `cache-control` header?
		maxAge: 0, // ms
		immutable: false,

		beforeSend: () => {},
		...opt,
	}
	if ('string' !== typeof opt.contentType) {
		throw new TypeError('opt.contentType must be a string')
	}
	if (!(opt.timeModified instanceof Date)) {
		throw new TypeError('opt.timeModified must be a Date')
	}
	if (opt.etag !== null && 'string' !== typeof opt.etag) {
		throw new TypeError('opt.etag must be a string or null')
	}
	if (opt.gzip !== null && 'function' !== typeof opt.gzip) {
		throw new TypeError('opt.gzip must be an async function or null')
	}
	if (opt.brotliCompress !== null && 'function' !== typeof opt.brotliCompress) {
		throw new TypeError('opt.brotliCompress must be an async function or null')
	}
	if ('function' !== typeof opt.beforeSend) {
		throw new TypeError('opt.beforeSend must be a function or null')
	}
	debug('opt', opt)

	let body = buf
	const beforeSend = () => opt.beforeSend(req, res, body, opt)

	// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L599-L708

	// A recipient cache or origin server MUST evaluate the request
	// preconditions defined by this specification in the following order:
	// 1. When recipient is the origin server and If-Match is present,
	// evaluate the If-Match precondition:
	// *  if true, continue to step 3
	// *  if false, respond 412 (Precondition Failed) unless it can be
	//    determined that the state-changing request has already
	//    succeeded (see Section 3.1)
	// 2. When recipient is the origin server, If-Match is not present, and
	// If-Unmodified-Since is present, evaluate the If-Unmodified-Since
	// precondition:
	// *  if true, continue to step 3
	// *  if false, respond 412 (Precondition Failed) unless it can be
	//    determined that the state-changing request has already
	//    succeeded (see Section 3.4)
	// 3. When If-None-Match is present, evaluate the If-None-Match
	// precondition:
	// *  if true, continue to step 5
	// *  if false for GET/HEAD, respond 304 (Not Modified)
	// *  if false for other methods, respond 412 (Precondition Failed)
	// 4. When the method is GET or HEAD, If-None-Match is not present, and
	// If-Modified-Since is present, evaluate the If-Modified-Since
	// precondition:
	// *  if true, continue to step 5
	// *  if false, respond 304 (Not Modified)
	// 5. When the method is GET and both Range and If-Range are present,
	// evaluate the If-Range precondition:
	// *  if the validator matches and the Range specification is
	//    applicable to the selected representation, respond 206
	//    (Partial Content) [RFC7233]
	// 6. Otherwise,
	// *  all conditions are met, so perform the requested action and
	//    respond according to its success or failure.
	// https://datatracker.ietf.org/doc/html/rfc7232#section-6

	res.setHeader('content-type', opt.contentType)
	res.setHeader('accept-ranges', 'bytes')
	res.setHeader('last-modified', opt.timeModified.toUTCString())
	if (opt.etag) res.setHeader('etag', opt.etag)
	if (opt.cacheControl) {
		res.setHeader('cache-control', [
			'public, max-age=', Math.floor(opt.maxAge / 1000),
			opt.immutable ? ', immutable' : '',
		].join(''))
	}

	// The `Vary` HTTP response header determines how to match future request
	// headers to decide whether a cached response can be used rather than
	// requesting a fresh one from the origin server. It is used by the server
	// to indicate which headers it used when selecting a representation of a
	// resource in a content negotiation algorithm.
	// Example:
	// When using the `Vary: User-Agent` header, caching servers should consider
	// the user agent when deciding whether to serve the page from cache.
	// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Vary
	if (opt.gzip || opt.brotliCompress) {
		res.setHeader('vary', 'accept-encoding')
	}

	// The `last-byte-pos` value gives the byte-offset of the last byte in the
	// range; that is, the byte positions specified are inclusive. Byte offsets
	// start at zero.
	// https://tools.ietf.org/html/rfc7233#section-2.1
	let start = 0, length = body.length

	// negotiate content-encoding
	// see also https://stackoverflow.com/a/11664307
	const availableEncodings = {}
	if (opt.gzip) availableEncodings.gzip = opt.gzip
	if (opt.brotliCompress) availableEncodings.br = opt.brotliCompress

	const acceptEnc = req.headers['accept-encoding']
	const enc = (negotiateEncoding(acceptEnc, Object.keys(availableEncodings)) || [])[0]
	if (enc) {
		debug('using content-encoding', enc)
		const encodeWithNegotiatedEncoding = availableEncodings[enc]
		const {
			compressedBuffer: cBody, compressedEtag: cEtag,
		} = await encodeWithNegotiatedEncoding(buf)
		const errMsg = enc + ' encoding fn must return {compressedBuffer, compressedEtag}'

		if (cBody !== null) {
			if (!Buffer.isBuffer(cBody)) throw new TypeError(errMsg)
			body = cBody
			length = cBody.length
			res.setHeader('content-encoding', enc)

			if (cEtag !== undefined && cEtag !== null && 'string' !== typeof cEtag) {
				throw new TypeError(errMsg)
			}
			if (cEtag) res.setHeader('etag', cEtag)
			else res.removeHeader('etag')
		}
	}

	if (isConditionalGET(req)) {
		if (failsPrecondition(req, res.getHeaders())) {
			debug('fails precondition', req.headers, res.getHeaders())
			respondEmptyWithStatus(res, 412, beforeSend)
			return;
		}

		if (isClientFresh(req, res.getHeaders())) {
			debug('client cache is fresh', req.headers, res.getHeaders())
			respondEmptyWithStatus(res, 304, beforeSend)
			return;
		}
	}

	// handle range requests
	if (/^ *bytes=/.test(req.headers['range'])) {
		const ranges = parseRanges(body.length, req.headers['range'], {
			combine: true,
		})
		const malformed = ranges === -2
		const unsatisfiable = ranges === -1
		debug('ranges', ranges)

		if (unsatisfiable) {
			debug('range is unsatisfiable', req.headers['range'])
			// The "Content-Range" header field is sent in […] 416 (Range Not
			// Satisfiable) responses to provide information about the selected
			// representation.
			// https://tools.ietf.org/html/rfc7233#section-4.2
			res.setHeader('content-range', `bytes */${length}`)
			respondEmptyWithStatus(res, 416, beforeSend)
			return;
		}

		// todo: indicate lacking `ranges.length > 1` support to the client?
		// todo: what about `ranges.length === 0`?
		if (!malformed && isClientRangeFresh(req, res.getHeaders()) && ranges.length === 1) {
			const r = ranges[0]
			debug('responding with range', r)
			res.statusCode = 206
			res.setHeader('content-range', `bytes ${r.start}-${r.end}/${length}`)
			start = r.start
			length = r.end - r.start + 1
		}
	}

	res.setHeader('content-length', length)

	if (req.method === 'HEAD') {
		respondEmptyWithStatus(res, 204, beforeSend)
		return;
	}

	if (body.length < 1024) {
		// disable Nagle's algorithm for very small bodies
		res.socket.setNoDelay(true)
	}
	beforeSend()
	debug('sending body')
	await pipeline(
		readBuf(body, start, start + length),
		res,
	)
}

module.exports = serveBuffer
