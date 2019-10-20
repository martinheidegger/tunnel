const tcp = require('tcp-forward')
const network = require('@hyperswarm/network')
const pump = require('pump')

exports.Local = tcp.Local

exports.Remote = class Remote extends tcp.Remote {
  constructor () {
    super()

    const announcing = new Map()

    this.network = network({
      ephemeral: false
    })

    this.on('forward-listening', (port, topic) => {
      this.network.bind(() => {
        const t = this.network.discovery.announce(topic, { port })
        const key = topic.toString('hex') + ':' + port
        announcing.set(key, t)
      })
    })

    this.on('forward-close', (port, topic) => {
      this.network.bind(() => {
        const key = topic.toString('hex') + ':' + port
        const t = announcing.get(key)
        if (t) {
          t.destroy()
          announcing.delete(key)
        }
      })
    })

    this.on('forward-connect', (socket, topic) => {
      this.network.bind(() => {
        const t = this.network.lookup(topic)
        const seen = new Set()
        const queued = []
        let destroyOnEmpty = false
        const self = this

        t.on('peer', function (peer) {
          const id = peer.host + ':' + peer.port
          if (seen.has(id)) return
          seen.add(id)
          queued.push(peer)
          if (queued.length === 1) kick()
        })
        t.on('update', function () {
          destroyOnEmpty = true
          if (!queued.length) destroy()
        })

        function destroy () {
          t.destroy()
          socket.destroy()
        }

        function kick () {
          if (self.network.destroyed) return

          if (!queued.length) {
            if (destroyOnEmpty) destroy()
            return
          }
          const next = queued[queued.length - 1]

          self.network.connect(next, function (err, connection) {
            queued.pop()
            if (err || self.network.destroyed) return kick()
            t.destroy()
            pump(connection, socket, connection)
          })
        }
      })
    })
  }

  destroy () {
    this.network.close((err) => {
      if (!err) this.emit('network-close')
    })
    super.destroy()
  }

  listen (...args) {
    this.network.bind()
    super.listen(...args)
  }
}