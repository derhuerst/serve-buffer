# serve-buffer

**Serve a [`Buffer`](https://nodejs.org/api/buffer.html#buffer_class_buffer) via HTTP, with [`Range`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Range), [conditional `GET`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-None-Match) and [GZip](https://developer.mozilla.org/en-US/docs/Glossary/GZip_compression)/[Brotli](https://developer.mozilla.org/en-US/docs/Glossary/brotli_compression) compression support.**

[![npm version](https://img.shields.io/npm/v/serve-buffer.svg)](https://www.npmjs.com/package/serve-buffer)
[![build status](https://api.travis-ci.org/derhuerst/serve-buffer.svg?branch=master)](https://travis-ci.org/derhuerst/serve-buffer)
![ISC-licensed](https://img.shields.io/github/license/derhuerst/serve-buffer.svg)
![minimum Node.js version](https://img.shields.io/node/v/serve-buffer.svg)
[![support me via GitHub Sponsors](https://img.shields.io/badge/support%20me-donate-fa7664.svg)](https://github.com/sponsors/derhuerst)
[![chat with me on Twitter](https://img.shields.io/badge/chat%20with%20me-on%20Twitter-1da1f2.svg)](https://twitter.com/derhuerst)

*Note:* If you want to serve *files* with support for `Range`, conditional `GET` and compression, use [`send`](https://github.com/pillarjs/send). If you want to serve an entire directory of files, use [`serve-static`](https://github.com/expressjs/serve-static).

There is a surprising number of difficult-to-understand corner cases in the HTTP RFCs. I [tried my best](lib/serve-buffer.js) here, so that others don't have to write quick-and-dirty (which in the HTTP realm usually means slightly wrong) implementations. This library supports the following request headers:

- [`Accept-Encoding`](https://datatracker.ietf.org/doc/html/rfc7231#section-5.3.4)
- [`Range`](https://datatracker.ietf.org/doc/html/rfc7233#section-3.1) & [`If-Range`](https://datatracker.ietf.org/doc/html/rfc7233#section-3.2)
- [`If-None-Match`](https://datatracker.ietf.org/doc/html/rfc7232#section-3.2)/[`If-Match`](https://datatracker.ietf.org/doc/html/rfc7232#section-3.1) & [`If-Modified-Since`](https://datatracker.ietf.org/doc/html/rfc7232#section-3.3)/[`If-Unmodified-Since`](https://datatracker.ietf.org/doc/html/rfc7232#section-3.4)


## Installation

```shell
npm install serve-buffer
```


## Usage

```js
const express = require('express')
const serveBuffer = require('serve-buffer')

const app = express()

let data = Buffer.from('a lot of data here…', 'utf8')
app.use('/data', (req, res) => {
	serveBuffer(req, res, data)
})

// change buffer later
data = Buffer.from('entirely different buffer', 'utf8')
```

### allow caching via `timeModified` & `etag`

```js
const computeEtag = require('etag')

let data = Buffer.from('a lot of data here…', 'utf8')
let timeModified = new Date()
let etag = computeEtag(data)

app.use('/data', (req, res) => {
	serveBuffer(req, res, data, {timeModified, etag})
})

// change buffer later
data = Buffer.from('entirely different buffer', 'utf8')
timeModified = new Date()
etag = computeEtag(data)
```

### serve [gzipped](https://en.wikipedia.org/wiki/Gzip) & [Brotli](https://en.wikipedia.org/wiki/Brotli)-compressed data

Serving compressed data reduces the amount of transferred data at the cost of higher CPU load, so it is usually worth it if your data rarely changes, or if you have slowly connected (or a lot of) consumers.

If `buf` is reasonably small (<=10mb for GZip, <= 512kb for Brotli), `serve-buffer` will compress it by default. If you don't want this, pass `opt.gzip: false` and/or `opt.brotliCompress: false`; Instead, you can also customise the size limits via `opt.gzipMaxSize` & `opt.brotliCompressMaxSize`.

If you *never mutate* the buffer(s) that you pass into `serveBuffer`, you can tell it to *cache* each buffer's compressed version as long as the instance exists (using a [`WeakMap`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakMap)) by passing `opt.unmutatedBuffers: true`:

```js
const data = Buffer.from('a lot of data here…', 'utf8')
const timeModified = new Date()
const etag = computeEtag(data)

app.use('/data', (req, res) => {
	serveBuffer(req, res, data, {
		timeModified,
		etag,
		// Only do this if you never mutate `data`!
		unmutatedBuffers: true,
	})
})
```


## API

```js
serveBuffer(req, res, buf, opt = {}, cb = () => {})
```

`opt` overrides the default config, which looks like this:

```js
{
	contentType: 'application/octet-stream',
	timeModified: new Date(),
	etag: require('etag')(buf),

	gzip: true, // or `false` or `async (buf) => ({compressedBuffer, compressedEtag})`
	gzipMaxSize: 10 * 1024 * 1024, // 10mb
	brotliCompress: true, // or `false` or `async (buf) => ({compressedBuffer, compressedEtag})`
	brotliCompressMaxSize: 512 * 1024, // 512kb
	// Assume that Buffers passed in as `buf` never get mutated? If `true`, each compressed buffer & compressed ETag will be cached as long as the buffer instance exists.
	unmutatedBuffers: false,

	cacheControl: true, // send cache-control header?
	maxAge: 0, // for cache-control, in milliseconds
	immutable: false, // for cache-control

	// hook functions for modifying serve-buffer's behavior
	beforeSend: (req, res, body, opt) => {},
}
```

`cb` will be called once the response headers and body (if applicable) have been sent.


## Related

- [`send-stream`](https://github.com/nicolashenry/send-stream) – Streaming file server with Range and conditional-GET support from file system or other streaming sources. (Very similar to `serve-buffer`.)
- [`send`](https://github.com/pillarjs/send) – Streaming static file server with Range and conditional-GET support
- [`http-file-response`](https://github.com/mafintosh/http-file-response) – Send a file back as a HTTP response with support for range queries etc.


## Contributing

If you have a question or need support using `serve-buffer`, please double-check your code and setup first. If you think you have found a bug or want to propose a feature, use [the issues page](https://github.com/derhuerst/serve-buffer/issues).
