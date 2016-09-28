const through = require('through2')
const protobufs = require('sendy-protobufs').ws
const extend = require('xtend/mutable')
const schema = protobufs.schema

exports.encoder = function encoder (opts) {
  return through(function (data, enc, cb) {
    console.log('encoding')
    var props = extend({ data: data }, opts)
    var packet = protobufs.encode(schema.Packet, props)
    cb(null, packet)
  })
}

exports.decoder = function decoder () {
  return through.obj(function (data, enc, cb) {
    console.log('decoding')
    var result = protobufs.decode(data)
    cb(null, result)
  })
}

// hack for now
exports.seq = function (buf) {
  try {
    return JSON.parse(buf).seq
  } catch (err) {
    return Number(/\"_n\":(\d+)/.exec(buf)[1])
  }
}
