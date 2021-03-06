const EventEmitter = require('events').EventEmitter
const eos = require('end-of-stream')
const debug = require('debug')('tradle:ws:manager')
const extend = require('xtend')
const typeforce = require('typeforce')
const noop = function () {}
const WIRE_EVENTS = ['request', 'message', 'handshake', 'ack']

exports = module.exports = createManager
exports.WIRE_EVENTS = WIRE_EVENTS

function createManager (opts) {
  opts = opts || {}

  const ackCache = {}
  var wires = {}
  var callbacks = {}
  var queues = {}
  var destroying
  var destroyed

  const manager = new EventEmitter()
  manager._read = function () {}
  manager.reset = function () {
    // don't reset ackCache
    for (var recipient in wires) {
      wires[recipient].destroy()
    }

    callbacks = {}
    wires = {}
    for (var recipient in queues) {
      resendQueue(recipient)
    }
  }

  manager.hasWire = function (recipient) {
    return recipient in wires
  }

  manager.wires = function () {
    return extend(wires)
  }

  manager.wire = function (recipient) {
    if (wires[recipient]) return wires[recipient]

    const wire = wires[recipient] = manager._createWire(recipient)
    wire.setMaxListeners(0)

    eos(wire, function (err) {
      debug(recipient + ' wire died', err)
      delete wires[recipient]
      if (!destroyed && destroying && Object.keys(wires).length === 0) {
        destroyed = true
        manager.emit('destroy')
      } else {
        resendQueue(recipient)
      }
    })

    wire.on('ack', function (ack) {
      const cbs = callbacks[recipient]
      const cb = cbs && cbs[ack]
      if (!cb) return

      delete cbs[ack]
      const args = cb._wsManagerArgs
      const idx = queues[recipient] ? queues[recipient].indexOf(args) : -1
      if (idx !== -1) queues[recipient].splice(idx, 1)

      cb()
    })

    WIRE_EVENTS.forEach(function (event) {
      wire.on(event, function (data) {
        if (destroying || destroyed) return

        manager.emit(event, data, recipient)
      })
    })

    const acks = ackCache[recipient]
    if (acks) {
      Object.keys(acks).sort(increasingNum).forEach(function (seq) {
        manager.ack({
          to: recipient,
          seq: seq
        })
      })
    }

    return wire
  }

  manager._createWire = function (recipient) {
    // overwrite this
    throw new Error('overwrite this!')
  }

  manager.send = function (opts, cb) {
    typeforce({
      seq: typeforce.Number,
      to: typeforce.String,
      message: typeforce.Object
    }, opts)

    const seq = opts.seq
    const msg = opts.message
    const recipient = opts.to
    const wire = manager.wire(recipient)
    const buf = toBuffer(msg)
    wire.send(buf)

    if (!callbacks[recipient]) callbacks[recipient] = {}

    callbacks[recipient][seq] = cb
    if (!queues[recipient]) queues[recipient] = []

    const args = arguments
    cb._wsManagerArgs = args
    queues[recipient].push(args)
    return function removeFromQueue () {
      const q = queues[recipient]
      if (!q) return

      const idx = q.indexOf(args)
      if (idx !== -1) {
        q.splice(idx, 1)
        return true
      }
    }
  }

  manager.destroy = function (cb) {
    if (destroyed) {
      if (cb) process.nextTick(cb)

      return
    }

    destroying = true
    for (var recipient in wires) {
      wires[recipient].destroy()
    }

    if (cb) manager.once('destroy', cb)
  }

  manager.ack = function (opts) {
    typeforce({
      seq: typeforce.Number,
      to: typeforce.String
    }, opts)

    const recipient = opts.to
    const seq = opts.seq
    const wire = wires[recipient]
    if (wire) return wire.ack(seq)

    debug(`caching ack for msg ${seq} from ${recipient}`)
    if (!ackCache[recipient]) {
      ackCache[recipient] = {}
    }

    ackCache[recipient][seq] = true
  }

  return manager

  function resendQueue (recipient) {
    var q = queues[recipient]
    if (!(q && q.length)) return

    queues[recipient] = []
    debug('resending to ' + recipient)
    for (var i = 0; i < q.length; i++) {
      manager.send.apply(manager, q[i])
    }
  }
}

function increasingNum (a, b) {
  return a - b
}

function toBuffer (obj) {
  if (
    obj instanceof Uint8Array ||
    obj instanceof ArrayBuffer ||
    typeof obj === 'string'
  ) {
    return new Buffer(obj)
  }

  if (Buffer.isBuffer(obj)) return obj

  return new Buffer(JSON.stringify(obj))
}
