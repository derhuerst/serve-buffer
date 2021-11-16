'use strict'

const {deepStrictEqual: eql} = require('assert')

const match = (str, regex) => {
	const m = str.match(regex)
	return m || []
}
const parseApacheBenchOutput = (out) => {
	const completeRequests = parseInt(match(out, /complete requests:\s+([\d.]+)/i)[1])
	const failedRequests = parseInt(match(out, /failed requests:\s+([\d.]+)/i)[1])
	const requestsPerSecond = parseFloat(match(out, /requests per second:\s+([\d.]+)/i)[1])
	const waitingTime = match(out, /waiting:\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i).slice(1, 6)
	const totalTime = match(out, /total:\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i).slice(1, 6)
	return {
		completeRequests,
		failedRequests,
		requestsPerSecond,
		waitingTimeMin: parseFloat(waitingTime[0]),
		waitingTimeMean: parseFloat(waitingTime[1]),
		waitingTimeStdDev: parseFloat(waitingTime[2]),
		waitingTimeMedian: parseFloat(waitingTime[3]),
		waitingTimeMax: parseFloat(waitingTime[4]),
		totalTimeMin: parseFloat(totalTime[0]),
		totalTimeMean: parseFloat(totalTime[1]),
		totalTimeStdDev: parseFloat(totalTime[2]),
		totalTimeMedian: parseFloat(totalTime[3]),
		totalTimeMax: parseFloat(totalTime[4]),
	}
}

const test1 = `\
This is ApacheBench, Version 2.3 <$Revision: 1879490 $>
Copyright 1996 Adam Twiss, Zeus Technology Ltd, http://www.zeustech.net/
Licensed to The Apache Software Foundation, http://www.apache.org/

Benchmarking :: (be patient).....done


Server Software:
Server Hostname:        ::
Server Port:            3000

Document Path:          /
Document Length:        100 bytes

Concurrency Level:      2
Time taken for tests:   1.001 seconds
Complete requests:      350
Failed requests:        0
Total transferred:      132678 bytes
HTML transferred:       35100 bytes
Requests per second:    349.58 [#/sec] (mean)
Time per request:       5.721 [ms] (mean)
Time per request:       2.861 [ms] (mean, across all concurrent requests)
Transfer rate:          129.41 [Kbytes/sec] received

Connection Times (ms)
              min  mean[+/-sd] median   max
Connect:        1    2   2.1      2      23
Processing:     1    3   3.4      2      20
Waiting:        0    2   2.6      1      16
Total:          2    6   4.0      4      26`

eql(parseApacheBenchOutput(test1), {
	completeRequests: 350,
	failedRequests: 0,
	requestsPerSecond: 349.58,
	waitingTimeMin: 0,
	waitingTimeMean: 2,
	waitingTimeStdDev: 2.6,
	waitingTimeMedian: 1,
	waitingTimeMax: 16,
	totalTimeMin: 2,
	totalTimeMean: 6,
	totalTimeStdDev: 4,
	totalTimeMedian: 4,
	totalTimeMax: 26,
})

module.exports = parseApacheBenchOutput
