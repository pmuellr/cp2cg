'use strict'

exports.getLogger = getLogger

const path = require('path')
const util = require('util')

const chalk = require('chalk')

const pkg = require('../package.json')

const IsDebug = (process.env.DEBUG != null) || (process.env.LOGLEVEL === 'debug')

const ProjectPath = path.dirname(__dirname)

// Return the path of a file relative to the project root if path provided.
// If path not provided, returns the project path itself.
function getProjectPath (aPath) {
  if (aPath == null) return ProjectPath

  return path.relative(ProjectPath, aPath)
}

// Create a new logger.
function getLogger (fileName, opts) {
  fileName = getProjectPath(fileName)
  return new Logger(fileName, opts)
}

// Create a new logger, to log nice messages to stdXXX.
class Logger {
  constructor (fileName, opts) {
    if (opts == null) opts = {}

    this.opts = opts
    this.fileName = fileName
  }

  // Convert arguments to strings, join with ' ', write as a log message.
  log (messageParms) {
    this._print(arguments)
  }

  // Like log, but only if debug enabled.
  debug (messageParms) {
    // We can actually replace this method with a simpler one when not in debug.
    if (!IsDebug) {
      Logger.prototype.debug = () => {}
      return
    }

    this._print(arguments, {debug: true})
  }

  // internal impl that prints the message
  _print (arguments_, opts) {
    opts = opts || {}

    const messageParms = [].slice.call(arguments_)
    const date = new Date()
    const time = new Date(date.getTime() - (date.getTimezoneOffset() * 1000 * 60))
      .toISOString()
      .substr(11, 12)

    const parts = [ chalk.yellow(time) ]

    if (this.opts.prefixFileName) {
      parts.push(chalk.cyan(`${this.fileName}:`))
    } else {
      parts.push(chalk.green(`${pkg.name}:`))
    }

    if (opts.debug) {
      parts.push(chalk.red.dim('[DEBUG]'))
      if (!this.opts.prefixFileName) {
        parts.push(`${this.fileName}:`)
      }
    }

    parts.push(util.format.apply(util, messageParms))

    console.log(parts.join(' '))
  }
}
