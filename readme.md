# serve-buffer

**Serve a [`Buffer`](https://nodejs.org/api/buffer.html#buffer_class_buffer) via HTTP, with [`Range`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Range) and [conditional `GET`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-None-Match) support.**

[![npm version](https://img.shields.io/npm/v/serve-buffer.svg)](https://www.npmjs.com/package/serve-buffer)
[![build status](https://api.travis-ci.org/derhuerst/serve-buffer.svg?branch=master)](https://travis-ci.org/derhuerst/serve-buffer)
![ISC-licensed](https://img.shields.io/github/license/derhuerst/serve-buffer.svg)
![minimum Node.js version](https://img.shields.io/node/v/serve-buffer.svg)
[![support me via GitHub Sponsors](https://img.shields.io/badge/support%20me-donate-fa7664.svg)](https://github.com/sponsors/derhuerst)
[![chat with me on Twitter](https://img.shields.io/badge/chat%20with%20me-on%20Twitter-1da1f2.svg)](https://twitter.com/derhuerst)


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

If you pass [`Buffer`](https://nodejs.org/api/buffer.html#buffer_buffer)s as `opt.gzippedBuffer` and/or `opt.brotliCompressedBuffer`, `serve-buffer` will serve them to clients requesting compressed data.

This will reduce the amount of transferred data at the cost of higher CPU load, so it is usually worth it if you have a rarely- to medium-often-changing feed and many consumers.

If you have many feed updates and a small to medium number of consumers, encode the data lazily (once compressed data has been requested) by passing `opt.gzip: buf => ({compressedBuffer, compressedEtag})` and/or `opt.brotliCompress: buf => ({compressedBuffer, compressedEtag})`:

```js

```

Keep in mind that these functions must be synchronous, so they will [block the event loop](https://nodejs.org/en/docs/guides/blocking-vs-non-blocking/).


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

	// ahead-of-time compression
	gzippedBuffer: null, // or Buffer
	gzippedEtag: null, // or string
	brotliCompressedBuffer: null, // or Buffer
	brotliCompressedEtag: null, // or string
	// lazy compression
	gzip: null, // or buf => ({compressedBuffer, compressedEtag})
	brotliCompress: null, // or buf => ({compressedBuffer, compressedEtag})

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
