'use strict'

const computeEtag = require('etag')
const {createServer} = require('http')
const {randomBytes} = require('crypto')
const serveBuffer = require('.')

let data = Buffer.from('0123456789', 'utf8')
let timeModified = new Date()
let etag = computeEtag(data)

// change buffer later
setInterval(() => {
	randomBytes(3).copy(data)
	timeModified = new Date()
	etag = computeEtag(data)
})

createServer((req, res) => {
	serveBuffer(req, res, data, {timeModified, etag})
})
.listen(3000, (err) => {
	if (err) {
		console.error(err)
		process.exit(1)
	}

	console.info(`\
listening on port 3000
try fetching data via curl 'http://localhost:3000/'`)
})
