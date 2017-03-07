'use string'

exports.parse = parse
exports.applyDefaultOptions = applyDefaultOptions

const path = require('path')

const minimist = require('minimist')

const Logger = require('./logger').getLogger(__filename)

// parse the command-line options
function parse (cliArgs, optTypes) {
  // skeletal options for minimist
  const minimistOpts = {
    string: [],
    boolean: [],
    alias: {}
  }

  // fill out minimist opts
  for (let optName in optTypes) {
    const type = optTypes[optName]

    if (type === String) {
      minimistOpts.string.push(optName)
    } else if (type === Boolean) {
      minimistOpts.boolean.push(optName)
    } else {
      return new Error(`invalid option type for --${optName}: ${type}`)
    }

    minimistOpts.alias[optName] = optName[0]
  }

  // parse cli args with minimist
  const parsed = minimist(cliArgs, minimistOpts)

  if (parsed._[0] === '?') {
    parsed._.shift()
    parsed.help = true
  }

  // get and set the arguments
  for (let arg of parsed._) {
    Logger.log(`cli argument ${arg} ignored`)
  }
  delete parsed._

  // ultimate result
  let opts = {}

  for (let optName in optTypes) {
    opts[optName] = parsed[optName]
    delete parsed[optName]
    delete parsed[optName[0]]
  }

  for (let optName in parsed) {
    const prefix = optName.length === 1 ? '-' : '--'
    Logger.log(`cli option ${prefix}${optName} ignored (value: ${parsed[optName]})`)
  }

  // return
  return opts
}

// set default options on options passed in
function applyDefaultOptions (originalOpts, optTypes) {
  const opts = Object.assign({}, originalOpts || {})

  // set option defaults
  provideDefault(opts, 'target', 'http://localHost:9229')
  provideDefault(opts, 'port', '3000')
  provideDefault(opts, 'dataDir', path.join(homeDir(), '.playbug'))

  return opts
}

// set a value of an option if it's not already set
function provideDefault (opts, optionName, value) {
  if (value == null) return
  if (opts[optionName] != null) return

  opts[optionName] = value
}

// return home directory name
function homeDir () {
  const envVar = (process.platform === 'win32') ? 'USERPROFILE' : 'HOME'
  return process.env[envVar]
}
