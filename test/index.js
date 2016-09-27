
var path = require('path')
var test = require('tape')
var WebSocketServer = require('../server')
var WSClient = require('../client')
var strings = require('./fixtures/strings')
var BASE_PORT = 22222

;[true, false].forEach(function (goodConnection) {
  test(goodConnection ? 'good connection' : 'bad connection', function (t) {
    t.timeoutAfter(90000)
    var port = BASE_PORT++

    var wsPath = '/custom/relay/path'
    var server = new WebSocketServer({
      port: port,
      path: wsPath
    })

    var serverURL = 'http://127.0.0.1:' + port + path.join('/', wsPath)
    var state = {}

    var client = new WSClient({
      wireOpts: { plaintext: true },
      url: serverURL + '?from=bill'
    })

    var expected = toBuffer({
      dear: 'ted',
      contents: 'sixmeg'.repeat(1000000),
      seq: 1
    })

    client.send('ted', expected, function () {
      t.pass('delivery confirmed')
      finish()
    })

    var togo = 2
    server.on('message', function (actual, from) {
      t.same(actual, expected, 'received')
      t.equal(from, 'bill')
      server.ack(JSON.parse(actual).seq, from)
      finish()
    })

    if (!goodConnection) {
      setInterval(function () {
        // randomly drop connections
        client._socket.end()
      }, 100).unref()
    }

    function finish (err) {
      if (err) throw err
      if (--togo) return

      t.end()
      client.destroy()
      server.destroy()
    }
  })
})

function toBuffer (obj) {
  return new Buffer(JSON.stringify(obj))
}
