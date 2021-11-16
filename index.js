'use strict'

const _serveBuffer = require('./lib/serve-buffer')

const serveBuffer = (req, res, buf, opt, cb) => {
	if (cb === undefined && 'function' === typeof opt) {
		cb = opt
		opt = {}
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
