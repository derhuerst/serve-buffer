'use strict'

const {URL} = require('url')
const debug = require('debug')('serve-buffer')
const computeEtag = require('etag')
const createSend = require('send')

// https://nodejs.org/docs/latest-v10.x/api/fs.html#fs_stats_dev
const FAKE_STAT = {
	isBlockDevice: () => false,
	isCharacterDevice: () => false,
	isDirectory: () => false,
	isFIFO: () => false,
	isFile: () => true,
	isSocket: () => false,
	isSymbolicLink: () => false,
	// file properties
	mode: 33188,
	uid: 123, gid: 123,
	// FS stuff
	dev: 123, rdev: 0, blksize: 4096,
	ino: 123456789, nlink: 1,
}

const serveBuffer = (buf, opt = {}) => {
	const {
		'content-type': contentType,
		getTimeModified,
		getETag,
	} = {
		'content-type': 'application/octet-stream',
		getTimeModified: () => new Date(),
		getETag: () => computeEtag(buf),
		...opt,
	}

	const serve = (req, res) => { // todo: req, res, next?
		const path = new URL(req.url, 'http://foo').pathname
		const send = createSend(req, path, {
			root: '/doesnt/exist', // prevent accidental FS leaks 🙈
			index: false,
			// todo: take options like `maxAge` from `opt`
		})

		// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L710-L749
		send.sendFile = function patchedSendFile (path) {
			debug('sendFile', path)
			// todo: check path, respond with 404 if no match

			// https://nodejs.org/docs/latest-v10.x/api/fs.html#fs_stats_dev
			const mtime = getTimeModified()
			const stat = {
				...FAKE_STAT,
				size: buf.length,
				blocks: Math.ceil(buf.length / FAKE_STAT.blksize),
				atime: new Date(), atimeMs: Date.now(),
				mtime, mtimMs: +mtime, ctime: mtime, ctimMs: +mtime,
				birthtime: new Date(1), birthtimeMs: 1,
			}
			this.send(path, stat)
		}

		// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L851-L892
		const origSetHeader = send.setHeader.bind(send)
		send.setHeader = function patchedSetHeader (path, stat) {
			debug('setHeader', path)
			debugger

			// set `ETag` header so that the original `setHeader` doesn't do it
			const etag = getETag()
			if (etag) {
				debug('ETag %s', etag)
				this.res.setHeader('ETag', etag)
			}

			return origSetHeader(path, stat)
		}

		// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L781-L823
		send.stream = function patchedStream (path, opt) {
			debug('stream', path, opt)

			if (opt.start === 0 && opt.end === buf.length) {
				this.res.write(buf)
			} else {
				this.res.write(buf.slice(opt.start, opt.end + 1))
			}

			const self = this
			this.res.on('error', (err) => {
				// todo: this seems wrong
				// https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L815-L816
				self.onStatError(err)
			})
			setImmediate(() => self.emit('end'))
		}

		send.pipe(res)
	}
	return serve
}

module.exports = serveBuffer
