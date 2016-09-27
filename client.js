
const EventEmitter = require('events').EventEmitter
const util = require('util')
const eos = require('end-of-stream')
const ws = require('websocket-stream')
const pump = require('pump')
const reemit = require('re-emitter')
const protobufs = require('sendy-protobufs').ws
const debug = require('debug')('tradle:ws:client')
const Wire = require('@tradle/wire')
const createBackoff = require('backoff')
const utils = require('./utils')
const schema = protobufs.schema

module.exports = Client

function Client (opts) {
  EventEmitter.call(this)
  this._opts = opts
  this._openSocket = this._openSocket.bind(this)
  this._callbacks = {}
  this._queues = []
  this._wires = {}
  this._backoff = opts.backoff || createBackoff.exponential({
    initialDelay: 1000,
    maxDelay: 10000
  })

  this._backoff.on('ready', this._openSocket)
  this._openSocket()
}

util.inherits(Client, EventEmitter)

Client.prototype.send = function (to, msg, cb) {
  const wire = this._getWire(to)
  wire.send(toBuffer(msg))

  if (!this._queues[to]) this._queues[to] = []
  this._queues[to].push(arguments)

  if (!this._callbacks[to]) this._callbacks[to] = {}

  const seq = Buffer.isBuffer(msg) ? JSON.parse(msg).seq : msg.seq
  this._callbacks[to][seq] = cb
}

Client.prototype._getWire = function (recipient) {
  const self = this
  if (this._wires[recipient]) return this._wires[recipient]

  const wire = this._wires[recipient] = new Wire(this._opts.wireOpts)
  pump(
    wire,
    utils.encoder(recipient),
    this._socket,
    utils.decoder(recipient),
    wire
  )

  wire.on('ack', function (ack) {
    const cbs = self._callbacks[recipient]
    const cb = cbs && cbs[ack]
    if (!cb) return

    delete self._callbacks[ack]
    cb()
  })

  ;['request', 'message', 'handshake', 'ack', 'error'].forEach(function (event) {
    wire.on(event, function (data) {
      if (self._destroyed || self._destroying) return

      self.emit(event, data, recipient)
    })
  })

  return wire
}

Client.prototype._debug = function () {
  var args = [].slice.call(arguments)
  args.unshift(this._opts.url)
  return debug.apply(null, arguments)
}

Client.prototype._openSocket = function () {
  const self = this
  if (this._socket) this._debug('reconnecting')

  this._socket = ws(this._opts.url)
  eos(this._socket, function () {
    if (self._destroyed) return
    if (self._destroying) {
      self._debug('destroyed')
      self._destroying = false
      self._destroyed = true
      return self.emit('destroy')
    }

    debug('backing off before reconnecting')
    self._backoff.backoff()
  })

  // clear callbacks and queues,
  // then requeue
  for (var recipient in this._wires) {
    this._wires[recipient].end()
  }

  this._wires = {}
  this._callbacks = {}
  for (var recipient in this._queues) {
    var q = this._queues[recipient].slice()
    this._queues[recipient].length = 0
    for (var i = 0; i < q.length; i++) {
      this.send.apply(this, q[i])
    }
  }
}

Client.prototype.destroy = function (cb) {
  if (this._destroyed) return process.nextTick(cb)

  this._destroying = true
  if (cb) this.once('destroy', cb)

  this._socket.end()
}

function toBuffer (obj) {
  if (Buffer.isBuffer(obj)) return obj
  if (typeof obj === 'string') return new Buffer(obj)
  return new Buffer(JSON.stringify(obj))
}
