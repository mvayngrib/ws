const through = require('through2')
const protobufs = require('sendy-protobufs').ws
const extend = require('xtend/mutable')
const schema = protobufs.schema

exports.encoder = function encoder (opts) {
  return through(function (data, enc, cb) {
    var props = extend({ data: data }, opts)
    var packet = protobufs.encode(schema.Packet, props)
    cb(null, packet)
  })
}

exports.decoder = function decoder () {
  return through.obj(function (data, enc, cb) {
    var result = protobufs.decode(data)
    cb(null, result)
  })
}
