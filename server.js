
const parseUrl = require('url').parse
const querystring = require('querystring')
const EventEmitter = require('events').EventEmitter
const eos = require('end-of-stream')
const pump = require('pump')
const websocket = require('websocket-stream')
const debug = require('debug')('tradle:ws:server')
const Wire = require('@tradle/wire')
const utils = require('./utils')
const DEFAULT_WIRE_OPTS = { plaintext: true }

module.exports = function createServer (opts) {
  const wsServer = websocket.createServer(opts, onconnection)
  const streams = {}
  const wires = {}
  const ackCache = {}
  const ee = new EventEmitter()
  var closed

  ee.hasClient = function (from) {
    return from in streams
  }

  ee.send = function (msg, to, cb) {
    if (!streams[to]) return cb(new Error('recipient not found'))

    streams[to].write(msg)
  }

  ee.close = function (cb) {
    if (closed) throw new Error('already closed')

    closed = true
    wsServer.close(cb)
  }

  ee.ack = function (msg, sender) {
    const seq = msg.seq || msg
    if (typeof seq !== 'number') throw new Error('invalid seq')

    const wire = wires[sender]
    if (wire) return wire.ack(seq)

    debug(`caching ack for msg ${seq} from ${from}`)
    if (!ackCache[from]) {
      ackCache[from] = {}
    }

    ackCache[from][seq] = true
  }

  ee.destroy = wsServer.close.bind(wsServer)

  return ee

  function onconnection (stream) {
    if (closed) {
      debug('already closed, terminating incoming connection')
      return stream.end()
    }

    const url = stream.socket.upgradeReq.url
    const query = querystring.parse(parseUrl(url).query)
    const from = query.from
    if (streams[from]) {
      debug(`ignoring second stream from ${from}`)
      return stream.end()
    }

    debug(`${from} connected`)
    streams[from] = stream

    const wire = wires[from] = new Wire(opts.wireOpts || DEFAULT_WIRE_OPTS)
    pump(
      stream,
      utils.decoder(from),
      wire,
      utils.encoder(from),
      stream,
      function (err) {
        if (err) stream.end()

        delete streams[from]

        wire.end()
        delete wires[from]
        if (!closed) {
          debug(`${from} disconnected`)
          ee.emit('disconnect', from)
        }
      }
    )

    wire.on('message', function (data) {
      if (!closed) {
        debug(`received message from ${from}`)
        ee.emit('message', data, from)
      }
    })

    ee.emit('connect', from)
    const acks = ackCache[from]
    if (!acks) return

    debug(`sending cached acks to ${from}`)
    delete ackCache[from]
    for (var seq in acks) {
      ee.ack(seq, from)
    }
  }
}
