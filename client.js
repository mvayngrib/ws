
const EventEmitter = require('events').EventEmitter
const util = require('util')
const pump = require('pump')
const through = require('through2')
const reemit = require('re-emitter')
const protobufs = require('sendy-protobufs').ws
const debug = require('debug')('tradle:ws:client')
const Wire = require('@tradle/wire')
const duplexify = require('duplexify')
const reconnect = require('reconnect-ws')
const utils = require('./utils')
const createManager = require('./manager')
const schema = protobufs.schema
const reconnectOpts = {
  initialDelay: 1e3,
  maxDelay: 30e3
}

module.exports = Client

function Client (opts) {
  const self = this

  EventEmitter.call(this)
  if (typeof opts === 'string') {
    opts = { url: opts }
  }

  this._opts = opts
  this._url = opts.url
  this._manager = createManager()
  this._manager._createWire = function (recipient) {
    const wire = self._createWire(recipient)
    if (self._socket) {
      self._connectWire(recipient, wire)
    } else {
      wire.cork()
    }

    return wire
  }

  reemit(this._manager, this, createManager.WIRE_EVENTS)
  this._connector = reconnect(reconnectOpts, this._setStream.bind(this))
    .connect(opts.url)
    .on('connect', function () {
      self._debug('connected')
      self.emit('connect')
    })
    .on('disconnect', this._onDisconnect.bind(this))
    .on('error', function (err) {
      self._debug('error in websocket stream', err)
      if (self._socket) {
        self._socket.end()
      }
    })
}

util.inherits(Client, EventEmitter)

/**
 * Overwrite this
 */
Client.prototype._createWire = function () {
  const wire = new Wire({ plaintext: true })
  wire._debugId = 'client-wire-' + wire._debugId
  return wire
}

Client.prototype.send = function (recipient, msg, cb) {
  this._manager.send(recipient, msg, cb)
}

Client.prototype.ack = function (recipient, msg) {
  this._manager.ack(recipient, msg)
}

Client.prototype._debug = function () {
  var args = [].slice.call(arguments)
  args.unshift(this._url)
  return debug.apply(null, arguments)
}

Client.prototype._setStream = function (stream) {
  const self = this

  this._socket = stream
  this._debug('connected to ' + this._url)
  pump(
    stream,
    utils.decoder(),
    through.obj(function (packet, enc, cb) {
      self._manager.wire(packet.from).write(packet.data)
      cb()
    })
    // ,
    // function (err) {
    //   if (err) self._debug('experienced error', err.stack)
    // }
  )

  const wires = this._manager.wires()
  Object.keys(wires).forEach(function (recipient) {
    this._connectWire(recipient, wires[recipient])
  }, this)
}

Client.prototype._connectWire = function (recipient, wire) {
  pump(
    wire,
    utils.encoder({ to: recipient }),
    this._socket
    // ,
    // function (err) {
    //   if (err) self._debug('experienced error', err.stack)
    // }
  )

  wire.uncork()
}

Client.prototype._onDisconnect = function (err) {
  if (err) this._debug('experienced error', err)
  if (this._destroyed) return
  if (this._destroying) {
    this._debug('destroyed')
    this._destroying = false
    this._destroyed = true
    return this.emit('destroy')
  }

  debug('backing off before reconnecting')
  this._socket = null
  this._manager.reset()
  this.emit('disconnect')
}

Client.prototype.destroy = function (cb) {
  if (this._destroyed) return process.nextTick(cb)

  this._destroying = true
  if (cb) this.once('destroy', cb)

  this._manager.destroy()
  this._connector.disconnect()
}
