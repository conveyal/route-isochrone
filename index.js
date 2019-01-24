console.log('starting...')

const fs = require('fs')
const fetch = require('isomorphic-fetch')
const csv = require('csv')
const turf = require('@turf/turf')

// TODO: move to a config file / env vars / etc.
const otpApi = 'http://localhost:8001/otp/routers/default'


// a csv of id, lat, lon
const originListFile = 'data/stops.csv'

stops = []

fs.readFile(originListFile, function (err, fileData){
  if (err) throw err;
  parse(fileData, {trim: true}, function (err, rows){
    if (err) throw err;
    processRows(rows)
    console.log('stops: ' + Object.keys(stops).length)

    // constuct OTP isochrone queries for each of the stops
    const otpRequests = Object.keys(stops).map(key => {
      const stop = stop[key]
      const url = `${otpApi}/isochrone?fromPlace=${stop.stop_lat},${stop.stop_lon}&date=2017/10/01&time=12:00:00&mode=WALK&cutoffSec=600&walkSpeed=1.34112&precisionMeters=50`
      return url
    })

    getUnionedBuffer(otpRequests)

  })
})

// Function to read CSV
const processRows = (rows) => {
  for (let i = 0; i < rows.length; i++) {
    stops.push({
      id: rows[i][0].replace("/",""),
      stop_lat: parseFloat(rows[i][1]),
      stop_lon: parseFloat(rows[i][2])
    })
  }
}

// Function to run all of the OTP isochrone queries
const getUnionedBuffer = otpRequests => Promise.all(otpRequests.map(url => fetch(url))).then(responses =>
    Promise.all(responses.map(res => res.json())).then(jsons => {
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
        console.log('wrote combined isochrone for route ')
      })
  })) // end of Promise.all() handler
