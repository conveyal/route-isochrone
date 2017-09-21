const fs = require('fs')
const fetch = require('isomorphic-fetch')
const turf = require('@turf/turf')

// TODO: move to a config file / env vars / etc.
const gtfsApi = 'http://localhost:4567/api/graphql'
const feedId = 'COTA'
const otpApi = 'http://localhost:8001/otp/routers/default'

// construct GTFS-API GraphQL query

const graphqlQuery = `
  query routeQuery ($feedId: String) {
    feeds (feed_id: [$feedId]) {
      feed_id,
      routes {
        route_id
        route_short_name
        route_long_name
        patterns {
          pattern_id
          stops {
            stop_id
            stop_lat
            stop_lon
          }
        }
      }
    }
  }
`

const vars = `{ "feedId": "${feedId}" }`

const url = `${gtfsApi}?query=${encodeURIComponent(graphqlQuery)}&variables=${encodeURIComponent(vars)}`

fetch(url)
.then(res => { return res.json() })
.then(json => {
  // process all feeds returned (there should only be one)
  json.feeds.forEach(feed => {
    // process the routes for this feed
    feed.routes.forEach(route => {
      console.log('Got route from GTFS-API: ' + route.route_short_name + ' ' + route.route_long_name)
      //if (route.route_short_name !== '2' && route.route_short_name !== '3') return
      const uniqueStops = {}

      // process the patterns
      route.patterns.forEach(pattern => {
        console.log(' - Pattern ' + pattern.pattern_id)

        // add all of this pattern's stops to the uniqueStops dictionary
        pattern.stops.forEach(stop => {
          uniqueStops[stop.stop_id] = stop
        })
      })
      console.log('    unique stops: ' + Object.keys(uniqueStops).length)

      // constuct OTP isochrone queries for each of this route's unique stops
      const otpRequests = Object.keys(uniqueStops).map(key => {
        const stop = uniqueStops[key]
        const url = `${otpApi}/isochrone?fromPlace=${stop.stop_lat},${stop.stop_lon}&date=2017/10/01&time=12:00:00&mode=WALK&cutoffSec=600&walkSpeed=1.34112&precisionMeters=50`
        return url
      })

      // run all of the OTP isochrone queries for this route
      Promise.all(otpRequests.map(url => fetch(url))).then(responses =>
        Promise.all(responses.map(res => res.json())).then(jsons => {
          console.log('Processing OTP responses for route ' + route.route_short_name + '...')
          const inputs = jsons.map((json, i) => {
            /* // code to write individual stop isochrones to disk for debugging, etc
            fs.writeFile(`stop${i}.json`, JSON.stringify(jsons[i]), 'utf8', () => {
              console.log('wrote stop'+i)
            }) */

            // extract the polygon coordinates from the OTP json response
            const coords = json.features[0].geometry.coordinates[0]

            // turf.buffer() fixes various topology problems that tend to arise here
            return turf.buffer(turf.polygon(coords), 0.00001)
          })

          // union all of the stop-specific isocrhones together
          let unioned = inputs[0]
          try {
            for (let i = 1; i < inputs.length; i++) {
              unioned = turf.union(unioned, inputs[i])
              console.log(' - added stop ' + i + ' of ' + inputs.length + ' for route ' + route.route_short_name)
            }
          } catch (err) {
            console.log(err)
            process.exit()
          }
          fs.writeFile(`route_${route.route_short_name}.geojson`, JSON.stringify(unioned), 'utf8', () => {
            console.log('wrote combined isochrone for route ' + route.route_short_name)
          })
        })) // end of Promise.all() handler
    }) // end of route forEach block
  }) // end of feed forEach block
})
