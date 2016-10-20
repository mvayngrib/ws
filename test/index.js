
var path = require('path')
var test = require('tape')
var Wire = require('@tradle/wire')
var nacl = Wire.nacl
var WebSocketServer = require('../server')
var WSClient = require('../client')
var strings = require('./fixtures/strings')
var BASE_PORT = 22222
const names = ['bill', 'ted']
const users = names.map(name => {
  return {
    identity: nacl.box.keyPair(),
    name: name
  }
})

const billInfo = users[0]
const billIdentifier = new Buffer(billInfo.identity.publicKey).toString('hex')
const tedInfo = users[1]
const tedIdentifier = new Buffer(tedInfo.identity.publicKey).toString('hex')

;[
  { disconnect: false, encrypt: true },
  { disconnect: false, encrypt: false },
  { disconnect: true, encrypt: true },
  { disconnect: true, encrypt: false }
].forEach(function (settings) {
  var cxnType = settings.disconnect ? 'good' : 'bad'
  test(`connection: ${cxnType}, encrypted: ${settings.encrypt}`, function (t) {
    t.timeoutAfter(90000)
    var port = BASE_PORT++

    var wsPath = '/custom/relay/path'
    var ted = new WebSocketServer({
      port: port,
      path: wsPath,
      identifier: tedIdentifier
    })

    var serverURL = 'http://127.0.0.1:' + port + path.join('/', wsPath)
    var bill = new WSClient({
      url: serverURL + '?from=' + new Buffer(billInfo.identity.publicKey).toString('hex')
    })

    if (settings.encrypt) {
      bill._createWire = function (recipient) {
        return new Wire({
          identity: billInfo.identity,
          theirIdentity: new Buffer(recipient, 'hex')
        })
      }

      ted._createWire = function (recipient) {
        return new Wire({
          identity: tedInfo.identity,
          theirIdentity: new Buffer(recipient, 'hex')
        })
      }
    }

    var toTed = toBuffer({
      dear: 'ted',
      contents: 'sixmeg'.repeat(1000000),
      seq: 1
    })

    bill.send(tedIdentifier, toTed, function () {
      t.pass('bill->ted delivery confirmed')
      finish()
    })

    var toBill = toBuffer({
      dear: 'bill',
      contents: 'sixmeg'.repeat(1000000),
      seq: 1
    })

    ted.send(billIdentifier, toBill, function () {
      t.pass('ted->bill delivery confirmed')
      finish()
    })

    ted.once('message', function (actual, from) {
      t.same(actual, toTed, 'ted received')
      t.equal(from, billIdentifier)
      finish()
    })

    ted.on('message', function (actual, from) {
      ted.ack(from, JSON.parse(actual).seq)
    })

    bill.once('message', function (actual, from) {
      t.same(actual, toBill, 'bill received')
      t.equal(from, tedIdentifier)
      finish()
    })

    bill.on('message', function (actual, from) {
      bill.ack(from, JSON.parse(actual).seq)
    })

    var togo = 4 // 2 people * (send + receive)

    function finish (err) {
      if (err) throw err
      if (--togo) {
        // kill bill
        if (settings.disconnect && bill._socket) {
          console.log('killing bill')
          bill._socket.end()
        }

        return
      }

      t.end()
      bill.destroy()
      ted.destroy()
    }
  })
})

function toBuffer (obj) {
  return new Buffer(JSON.stringify(obj))
}

process.on('uncaughtException', function (err) {
  console.error(err)
  process.exit(1)
})
