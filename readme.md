# serve-buffer

**Serve a [`Buffer`](https://nodejs.org/api/buffer.html#buffer_class_buffer) via HTTP, with [`Range`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Range) and [conditional `GET`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-None-Match) support.** Monkey-patches [`send`](https://github.com/pillarjs/send) to allow serving in-memory data.

[![npm version](https://img.shields.io/npm/v/serve-buffer.svg)](https://www.npmjs.com/package/serve-buffer)
[![build status](https://api.travis-ci.org/derhuerst/serve-buffer.svg?branch=master)](https://travis-ci.org/derhuerst/serve-buffer)
![ISC-licensed](https://img.shields.io/github/license/derhuerst/serve-buffer.svg)
![minimum Node.js version](https://img.shields.io/node/v/serve-buffer.svg)
[![chat with me on Gitter](https://img.shields.io/badge/chat%20with%20me-on%20gitter-512e92.svg)](https://gitter.im/derhuerst)
[![support me on Patreon](https://img.shields.io/badge/support%20me-on%20patreon-fa7664.svg)](https://patreon.com/derhuerst)


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


## API

```js
serveBuffer(req, res, buf, opt = {})
```

`opt` overrides the default config, which looks like this:

```js
{
	contentType: 'application/octect-stream',
	timeModified: new Date(),
	etag: require('etag')(buf),
}
```


## Related

- [`send-stream`](https://github.com/nicolashenry/send-stream) – Streaming file server with Range and conditional-GET support from file system or other streaming sources. (Very similar to `serve-buffer`.)
- [`send`](https://github.com/pillarjs/send) – Streaming static file server with Range and conditional-GET support
- [`http-file-response`](https://github.com/mafintosh/http-file-response) – Send a file back as a HTTP response with support for range queries etc.


## Contributing

If you have a question or need support using `serve-buffer`, please double-check your code and setup first. If you think you have found a bug or want to propose a feature, use [the issues page](https://github.com/derhuerst/serve-buffer/issues).
