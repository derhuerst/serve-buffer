#!/usr/bin/env node
'use strict'

const {randomBytes} = require('crypto')
const computeEtag = require('etag')
const {createServer} = require('http')
const serveBuffer = require('..')

let data = randomBytes(100)
let timeModified = new Date()
let etag = computeEtag(data)

// change buffer later
// setInterval(() => {
// 	randomBytes(3).copy(data)
// 	timeModified = new Date()
// 	etag = computeEtag(data)
// }, 3000)

const server = createServer((req, res) => {
	serveBuffer(req, res, data, {
		timeModified,
		etag,
		unmutatedBuffers: true,
	})
})

server.listen({port: 3000, host: '::'}, (err) => {
	if (err) {
		console.error(err)
		process.exit(1)
	}
})

const closeServer = () => {
	server.close()
}
process.on('SIGINT', closeServer)
process.on('SIGTERM', closeServer)
