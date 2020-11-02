// Some parts of this code are taken from MIT-licensed pillarjs/send, authored by:
// - Douglas Christopher Wilson <doug@somethingdoug.com>
// - James Wyatt Cready <jcready@gmail.com>
// - Jesús Leganés Combarro <piranna@gmail.com>
'use strict'

const fresh = require('fresh')
const parseRanges = require('range-parser')
// const {Readable} = require('stream')

// const readBuf = (buf, from = 0, to = buf.length) => {
// 	let offset = from
// 	const read = function (size) {
// 		const end = Math.min(offset + size, to)
// 		this.push(buf.slice(offset, end))
// 		offset = end
// 		if (offset >= buf.length) this.push(null) // EOF
// 	}
// 	return new Readable({read})
// }

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
const failsPrecondition = (req, opt) => {
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
		if (!opt.etag) return true
		// An origin server MUST use the strong comparison function when
		// comparing entity-tags for If-Match […].
		// https://tools.ietf.org/html/rfc7232#section-3.1
		return !parseTokenList(match).includes(opt.etag)
	}

	// The "If-Unmodified-Since" header field makes the request method
	// conditional on the selected representation's last modification date
	// being earlier than or equal to the date provided in the field-value.
	// https://tools.ietf.org/html/rfc7232#section-3.4
	const unmodifiedSince = parseHttpDate(req.headers['if-unmodified-since'])
	if (!Number.isNaN(unmodifiedSince)) {
		return opt.timeModified > unmodifiedSince
	}

	return false
}

// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L429-L441
const isClientFresh = (req, opt) => {
	const resHeaders = {}
	if (opt.etag) {
		resHeaders['etag'] = opt.etag
	}
	resHeaders['last-modified'] = opt.timeModified.toUTCString()
	return fresh(req.headers, resHeaders)
}

// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L443-L466
const isClientRangeFresh = (req, opt) => {
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
		return opt.etag && ifRange.includes(opt.etag)
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
	return !Number.isNaN(parsed) && parsed === +opt.timeModified
}

// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L259-L294
const respondEmptyWithStatus = (res, statusCode) => {
	// todo: clear headers already set
	res.statusCode = statusCode
	res.setHeader('Content-Security-Policy', `default-src 'none'`)
	res.setHeader('X-Content-Type-Options', 'nosniff')
	res.end()
}

const _serveBuffer = (req, res, buf, opt, cb) => {
	opt = {
		contentType: 'application/octet-stream',
		timeModified: new Date(),
		etag: null,
		// todo: immutable, see send() option
		// todo: maxAge, see send() option
		...opt,
	}
	if ('string' !== typeof opt.contentType) {
		throw new TypeError('opt.contentType must a string')
	}
	if (!(opt.timeModified instanceof Date)) {
		throw new TypeError('opt.timeModified must be a Date')
	}
	if (opt.etag !== null && 'string' !== typeof opt.etag) {
		throw new TypeError('opt.etag must a string or null')
	}

	// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L599-L708

	if (isConditionalGET(req)) {
		if (failsPrecondition(req, opt)) {
			respondEmptyWithStatus(res, 412)
			return;
		}

		if (isClientFresh(req, opt)) {
			respondEmptyWithStatus(res, 304)
			return;
		}
	}

	// The `last-byte-pos` value gives the byte-offset of the last byte in the
	// range; that is, the byte positions specified are inclusive. Byte offsets
	// start at zero.
	// https://tools.ietf.org/html/rfc7233#section-2.1
	let start = 0, length = buf.length

	if (/^ *bytes=/.test(req.headers['range'])) {
		const ranges = parseRanges(buf.length, req.headers['range'], {
			combine: true,
		})
		const malformed = ranges === -2
		const unsatisfiable = ranges === -1

		if (unsatisfiable) {
			// The "Content-Range" header field is sent in […] 416 (Range Not
			// Satisfiable) responses to provide information about the selected
			// representation.
			// https://tools.ietf.org/html/rfc7233#section-4.2
			res.setHeader('Content-Range', `bytes */${length}`)
			respondEmptyWithStatus(res, 416)
			return;
		}

		// todo: indicate lacking `ranges.length > 1` support to the client?
		// todo: what about `ranges.length === 0`?
		if (!malformed && isClientRangeFresh(req, opt) && ranges.length === 1) {
			const r = ranges[0]
			res.statusCode = 206
			res.setHeader('Content-Range', `bytes ${r.start}-${r.end}/${length}`)
			start = r.start
			length = r.end - r.start + 1
		}
	}

	res.setHeader('Accept-Ranges', 'bytes')
	res.setHeader('Content-Type', opt.contentType) // todo: optionally send charset?
	res.setHeader('Content-Length', length)
	res.setHeader('Last-Modified', opt.timeModified.toUTCString())
	if (opt.etag) res.setHeader('ETag', opt.etag)

	if (req.method === 'HEAD') {
		res.statusCode = 204
		res.end()
		return;
	}

	// todo: stream response?
	// todo: expose events `stream` & `end`?
	res.end(buf.slice(start, start + length))
}

const serveBuffer = (req, res, buf, opt, cb) => {
	if (cb === undefined && 'function' === typeof opt) {
		cb = opt
		opt = {}
	}
	if ('function' !== typeof cb) {
		cb = (err) => {
			if (!err) return;
			// todo: clear existing headers, reply with error
		}
	}
	_serveBuffer(req, res, buf, opt, cb)
}

module.exports = serveBuffer
