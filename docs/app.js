(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (process){
'use strict'

const path = require('path')

exports.create = create

// Create a new CallGraph.
function create () {
  return new CallGraph()
}

// Models a CallGraph
class CallGraph {
  constructor () {
    this.packages = new Map() // name -> Package
  }

  // should be passed cpuProfile.head
  process (node, caller) {
    const mod = url2mod(this, node)

    if (mod != null && caller != null) caller.callsModule(mod)
    if (mod != null) mod.hitCount += node.hitCount

    for (let child of node.children) {
      this.process(child, mod)
    }
  }

  // calculate selfTime for all modules;
  // will be hitCount adjusted so that sum of all selfTime = 1.0
  calculateSelfTime () {
    let sum = 0

    for (let pkg of this.packages.values()) {
      for (let mod of pkg.modules.values()) {
        sum += mod.hitCount
      }
    }

    for (let pkg of this.packages.values()) {
      for (let mod of pkg.modules.values()) {
        mod.selfTime = mod.hitCount / sum
      }
    }
  }

  // Return GraphViz notation for a callgraph.
  generateGraphviz () {
    const out = []

    out.push('digraph g {')
    out.push('    graph [')
    out.push('        rankdir = "LR"')
    out.push('    ];')

    for (let pkg of this.packages.values()) {
      out.push(`    "${pkg.name}" [`)
      out.push('        shape = "plain"')

      const tdAttrs = 'align="left" border="1"'

      const href = `href="https://npmjs.org/package/${pkg.name}"`
      const tip = `title="package ${pkg.name}"`
      const thAttrs = `${tdAttrs} cellpadding="8" bgcolor="cadetblue1" ${href} ${tip}`

      const label = []
      label.push('<table border="0" cellspacing="0">')
      label.push(`<tr><td ${thAttrs} ><b>${pkg.name}</b></td></tr>`)

      const mods = Array.from(pkg.modules.values())
      mods.sort((mod1, mod2) => stringCompare(mod1.name, mod2.name))

      for (let mod of mods) {
        const color = `bgcolor="${selfTimeColor(mod.selfTime)}"`
        const tip = `title="${mod.node.url}"`
        label.push(`<tr><td port="${mod.name}" ${tdAttrs} ${color} ${tip}>${mod.name}</td></tr>`)
      }
      label.push('</table>')

      out.push(`        label = <${label.join('\n')}>`)
      out.push('    ];')
    }

    for (let pkg of this.packages.values()) {
      for (let mod of pkg.modules.values()) {
        for (let call of mod.calls) {
          if (pkg === call.pkg) continue
          const edge = `"${pkg.name}":"${mod.name}" -> "${call.pkg.name}":"${call.name}";`
          out.push(`    ${edge}`)
        }
      }
    }

    out.push('}')

    return out.join('\n')
  }
}

// why did I have to write this?
function stringCompare (s1, s2) {
  if (s1 < s2) return -1
  if (s1 > s2) return 1
  return 0
}

const Colors = ['white', 'mistyrose', 'pink', 'hotpink', 'magenta', 'orangered', 'orange']
const ColorsCount = Colors.length

// get color given selfTime
function selfTimeColor (selfTime) {
  // 0 < selfTime < 1 ; take sqrt() to bump lower #'s up
  selfTime = Math.sqrt(selfTime)

  let colorIndex = Math.min(selfTime * ColorsCount, ColorsCount - 1)
  colorIndex = Math.round(colorIndex)

  return Colors[colorIndex]
}

// Convert a url into a Module object
/*
"functionName": "app",
"url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/express.js",
"children": []
*/

function url2mod (callGraph, node) {
  const url = node.url
  let pkgName
  let modName

  if (url === '') return
  if (!url.startsWith('/')) return

  const match = url.match(/.*\/node_modules\/([^/]*)\/(.*)/)
  if (match) {
    pkgName = match[1]
    modName = match[2]
  } else {
    pkgName = '(app)'
    modName = path.basename(url)
  }

  let pkg = callGraph.packages.get(pkgName)
  if (pkg == null) {
    pkg = new Package(pkgName)
    callGraph.packages.set(pkgName, pkg)
  }

  let mod = pkg.modules.get(modName)
  if (mod == null) {
    mod = new Module(pkg, modName, node)
    pkg.modules.set(modName, mod)
  }

  return mod
}

// Models a Package
class Package {
  constructor (name) {
    this.name = name
    this.modules = new Map() // name -> Module
  }
}

// Models a Module
class Module {
  constructor (pkg, name, node) {
    this.pkg = pkg
    this.name = name
    this.node = node
    this.calls = new Set()
    this.hitCount = 0
  }

  // process this module calling another module
  callsModule (mod) {
    if (mod == null) return
    if (mod === this) return

    this.calls.add(mod)
  }
}

}).call(this,require('_process'))

},{"_process":11,"path":10}],2:[function(require,module,exports){
(function (process,__dirname){
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

}).call(this,require('_process'),"/lib")

},{"../package.json":17,"_process":11,"chalk":7,"path":10,"util":16}],3:[function(require,module,exports){
module.exports={
  "typeId": "CPU",
  "uid": "1",
  "title": "undefined",
  "head": {
    "functionName": "(root)",
    "url": "",
    "lineNumber": 0,
    "callUID": 152,
    "bailoutReason": "",
    "id": 1,
    "scriptId": 0,
    "hitCount": 0,
    "children": [
      {
        "functionName": "start",
        "url": "nsolid.js",
        "lineNumber": 643,
        "callUID": 3,
        "bailoutReason": "no reason",
        "id": 2,
        "scriptId": 66,
        "hitCount": 0,
        "children": [
          {
            "functionName": "startProfiling",
            "url": "profiler.js",
            "lineNumber": 192,
            "callUID": 2,
            "bailoutReason": "no reason",
            "id": 3,
            "scriptId": 74,
            "hitCount": 0,
            "children": [
              {
                "functionName": "setSamplingInterval",
                "url": "",
                "lineNumber": 0,
                "callUID": 1,
                "bailoutReason": "",
                "id": 4,
                "scriptId": 0,
                "hitCount": 0,
                "children": []
              }
            ]
          }
        ]
      },
      {
        "functionName": "(program)",
        "url": "",
        "lineNumber": 0,
        "callUID": 4,
        "bailoutReason": "",
        "id": 5,
        "scriptId": 0,
        "hitCount": 25,
        "children": []
      },
      {
        "functionName": "parserOnHeadersComplete",
        "url": "_http_common.js",
        "lineNumber": 45,
        "callUID": 98,
        "bailoutReason": "no reason",
        "id": 6,
        "scriptId": 81,
        "hitCount": 0,
        "children": [
          {
            "functionName": "IncomingMessage",
            "url": "_http_incoming.js",
            "lineNumber": 20,
            "callUID": 5,
            "bailoutReason": "no reason",
            "id": 7,
            "scriptId": 80,
            "hitCount": 1,
            "children": [],
            "lineTicks": [
              {
                "line": 53,
                "hitCount": 1
              }
            ]
          },
          {
            "functionName": "parserOnIncoming",
            "url": "_http_server.js",
            "lineNumber": 463,
            "callUID": 97,
            "bailoutReason": "no reason",
            "id": 8,
            "scriptId": 84,
            "hitCount": 0,
            "children": [
              {
                "functionName": "emit",
                "url": "events.js",
                "lineNumber": 136,
                "callUID": 96,
                "bailoutReason": "no reason",
                "id": 9,
                "scriptId": 36,
                "hitCount": 0,
                "children": [
                  {
                    "functionName": "emitTwo",
                    "url": "events.js",
                    "lineNumber": 104,
                    "callUID": 95,
                    "bailoutReason": "no reason",
                    "id": 10,
                    "scriptId": 36,
                    "hitCount": 0,
                    "children": [
                      {
                        "functionName": "app",
                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/express.js",
                        "lineNumber": 37,
                        "callUID": 94,
                        "bailoutReason": "no reason",
                        "id": 11,
                        "scriptId": 88,
                        "hitCount": 0,
                        "children": [
                          {
                            "functionName": "handle",
                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/application.js",
                            "lineNumber": 157,
                            "callUID": 93,
                            "bailoutReason": "no reason",
                            "id": 12,
                            "scriptId": 90,
                            "hitCount": 0,
                            "children": [
                              {
                                "functionName": "handle",
                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/index.js",
                                "lineNumber": 135,
                                "callUID": 92,
                                "bailoutReason": "no reason",
                                "id": 13,
                                "scriptId": 100,
                                "hitCount": 0,
                                "children": [
                                  {
                                    "functionName": "next",
                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/index.js",
                                    "lineNumber": 178,
                                    "callUID": 87,
                                    "bailoutReason": "no reason",
                                    "id": 14,
                                    "scriptId": 100,
                                    "hitCount": 0,
                                    "children": [
                                      {
                                        "functionName": "process_params",
                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/index.js",
                                        "lineNumber": 322,
                                        "callUID": 86,
                                        "bailoutReason": "no reason",
                                        "id": 15,
                                        "scriptId": 100,
                                        "hitCount": 0,
                                        "children": [
                                          {
                                            "functionName": "",
                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/index.js",
                                            "lineNumber": 271,
                                            "callUID": 85,
                                            "bailoutReason": "no reason",
                                            "id": 16,
                                            "scriptId": 100,
                                            "hitCount": 0,
                                            "children": [
                                              {
                                                "functionName": "trim_prefix",
                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/index.js",
                                                "lineNumber": 284,
                                                "callUID": 89,
                                                "bailoutReason": "no reason",
                                                "id": 17,
                                                "scriptId": 100,
                                                "hitCount": 0,
                                                "children": [
                                                  {
                                                    "functionName": "handle",
                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/layer.js",
                                                    "lineNumber": 86,
                                                    "callUID": 82,
                                                    "bailoutReason": "TryCatchStatement",
                                                    "id": 18,
                                                    "scriptId": 103,
                                                    "hitCount": 0,
                                                    "children": [
                                                      {
                                                        "functionName": "query",
                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/middleware/query.js",
                                                        "lineNumber": 43,
                                                        "callUID": 91,
                                                        "bailoutReason": "no reason",
                                                        "id": 19,
                                                        "scriptId": 111,
                                                        "hitCount": 0,
                                                        "children": [
                                                          {
                                                            "functionName": "next",
                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/index.js",
                                                            "lineNumber": 178,
                                                            "callUID": 87,
                                                            "bailoutReason": "no reason",
                                                            "id": 20,
                                                            "scriptId": 100,
                                                            "hitCount": 0,
                                                            "children": [
                                                              {
                                                                "functionName": "process_params",
                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/index.js",
                                                                "lineNumber": 322,
                                                                "callUID": 86,
                                                                "bailoutReason": "no reason",
                                                                "id": 21,
                                                                "scriptId": 100,
                                                                "hitCount": 0,
                                                                "children": [
                                                                  {
                                                                    "functionName": "",
                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/index.js",
                                                                    "lineNumber": 271,
                                                                    "callUID": 85,
                                                                    "bailoutReason": "no reason",
                                                                    "id": 22,
                                                                    "scriptId": 100,
                                                                    "hitCount": 0,
                                                                    "children": [
                                                                      {
                                                                        "functionName": "trim_prefix",
                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/index.js",
                                                                        "lineNumber": 284,
                                                                        "callUID": 89,
                                                                        "bailoutReason": "no reason",
                                                                        "id": 23,
                                                                        "scriptId": 100,
                                                                        "hitCount": 0,
                                                                        "children": [
                                                                          {
                                                                            "functionName": "handle",
                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/layer.js",
                                                                            "lineNumber": 86,
                                                                            "callUID": 82,
                                                                            "bailoutReason": "TryCatchStatement",
                                                                            "id": 24,
                                                                            "scriptId": 103,
                                                                            "hitCount": 0,
                                                                            "children": [
                                                                              {
                                                                                "functionName": "expressInit",
                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/middleware/init.js",
                                                                                "lineNumber": 22,
                                                                                "callUID": 90,
                                                                                "bailoutReason": "no reason",
                                                                                "id": 25,
                                                                                "scriptId": 110,
                                                                                "hitCount": 0,
                                                                                "children": [
                                                                                  {
                                                                                    "functionName": "next",
                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/index.js",
                                                                                    "lineNumber": 178,
                                                                                    "callUID": 87,
                                                                                    "bailoutReason": "no reason",
                                                                                    "id": 26,
                                                                                    "scriptId": 100,
                                                                                    "hitCount": 0,
                                                                                    "children": [
                                                                                      {
                                                                                        "functionName": "process_params",
                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/index.js",
                                                                                        "lineNumber": 322,
                                                                                        "callUID": 86,
                                                                                        "bailoutReason": "no reason",
                                                                                        "id": 27,
                                                                                        "scriptId": 100,
                                                                                        "hitCount": 0,
                                                                                        "children": [
                                                                                          {
                                                                                            "functionName": "",
                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/index.js",
                                                                                            "lineNumber": 271,
                                                                                            "callUID": 85,
                                                                                            "bailoutReason": "no reason",
                                                                                            "id": 28,
                                                                                            "scriptId": 100,
                                                                                            "hitCount": 0,
                                                                                            "children": [
                                                                                              {
                                                                                                "functionName": "trim_prefix",
                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/index.js",
                                                                                                "lineNumber": 284,
                                                                                                "callUID": 89,
                                                                                                "bailoutReason": "no reason",
                                                                                                "id": 29,
                                                                                                "scriptId": 100,
                                                                                                "hitCount": 0,
                                                                                                "children": [
                                                                                                  {
                                                                                                    "functionName": "handle",
                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/layer.js",
                                                                                                    "lineNumber": 86,
                                                                                                    "callUID": 82,
                                                                                                    "bailoutReason": "TryCatchStatement",
                                                                                                    "id": 30,
                                                                                                    "scriptId": 103,
                                                                                                    "hitCount": 0,
                                                                                                    "children": [
                                                                                                      {
                                                                                                        "functionName": "cacheRequest",
                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/index.js",
                                                                                                        "lineNumber": 41,
                                                                                                        "callUID": 88,
                                                                                                        "bailoutReason": "no reason",
                                                                                                        "id": 31,
                                                                                                        "scriptId": 76,
                                                                                                        "hitCount": 0,
                                                                                                        "children": [
                                                                                                          {
                                                                                                            "functionName": "next",
                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/index.js",
                                                                                                            "lineNumber": 178,
                                                                                                            "callUID": 87,
                                                                                                            "bailoutReason": "no reason",
                                                                                                            "id": 32,
                                                                                                            "scriptId": 100,
                                                                                                            "hitCount": 0,
                                                                                                            "children": [
                                                                                                              {
                                                                                                                "functionName": "process_params",
                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/index.js",
                                                                                                                "lineNumber": 322,
                                                                                                                "callUID": 86,
                                                                                                                "bailoutReason": "no reason",
                                                                                                                "id": 33,
                                                                                                                "scriptId": 100,
                                                                                                                "hitCount": 0,
                                                                                                                "children": [
                                                                                                                  {
                                                                                                                    "functionName": "",
                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/index.js",
                                                                                                                    "lineNumber": 271,
                                                                                                                    "callUID": 85,
                                                                                                                    "bailoutReason": "no reason",
                                                                                                                    "id": 34,
                                                                                                                    "scriptId": 100,
                                                                                                                    "hitCount": 0,
                                                                                                                    "children": [
                                                                                                                      {
                                                                                                                        "functionName": "handle",
                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/layer.js",
                                                                                                                        "lineNumber": 86,
                                                                                                                        "callUID": 82,
                                                                                                                        "bailoutReason": "TryCatchStatement",
                                                                                                                        "id": 35,
                                                                                                                        "scriptId": 103,
                                                                                                                        "hitCount": 0,
                                                                                                                        "children": [
                                                                                                                          {
                                                                                                                            "functionName": "dispatch",
                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/route.js",
                                                                                                                            "lineNumber": 98,
                                                                                                                            "callUID": 84,
                                                                                                                            "bailoutReason": "no reason",
                                                                                                                            "id": 36,
                                                                                                                            "scriptId": 101,
                                                                                                                            "hitCount": 0,
                                                                                                                            "children": [
                                                                                                                              {
                                                                                                                                "functionName": "next",
                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/route.js",
                                                                                                                                "lineNumber": 114,
                                                                                                                                "callUID": 83,
                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                "id": 37,
                                                                                                                                "scriptId": 101,
                                                                                                                                "hitCount": 0,
                                                                                                                                "children": [
                                                                                                                                  {
                                                                                                                                    "functionName": "handle",
                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/router/layer.js",
                                                                                                                                    "lineNumber": 86,
                                                                                                                                    "callUID": 82,
                                                                                                                                    "bailoutReason": "TryCatchStatement",
                                                                                                                                    "id": 38,
                                                                                                                                    "scriptId": 103,
                                                                                                                                    "hitCount": 0,
                                                                                                                                    "children": [
                                                                                                                                      {
                                                                                                                                        "functionName": "renderPage",
                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/index.js",
                                                                                                                                        "lineNumber": 25,
                                                                                                                                        "callUID": 81,
                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                        "id": 39,
                                                                                                                                        "scriptId": 76,
                                                                                                                                        "hitCount": 0,
                                                                                                                                        "children": [
                                                                                                                                          {
                                                                                                                                            "functionName": "render",
                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/response.js",
                                                                                                                                            "lineNumber": 938,
                                                                                                                                            "callUID": 80,
                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                            "id": 40,
                                                                                                                                            "scriptId": 152,
                                                                                                                                            "hitCount": 0,
                                                                                                                                            "children": [
                                                                                                                                              {
                                                                                                                                                "functionName": "render",
                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/application.js",
                                                                                                                                                "lineNumber": 530,
                                                                                                                                                "callUID": 79,
                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                "id": 41,
                                                                                                                                                "scriptId": 90,
                                                                                                                                                "hitCount": 0,
                                                                                                                                                "children": [
                                                                                                                                                  {
                                                                                                                                                    "functionName": "tryRender",
                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/application.js",
                                                                                                                                                    "lineNumber": 637,
                                                                                                                                                    "callUID": 78,
                                                                                                                                                    "bailoutReason": "TryCatchStatement",
                                                                                                                                                    "id": 42,
                                                                                                                                                    "scriptId": 90,
                                                                                                                                                    "hitCount": 0,
                                                                                                                                                    "children": [
                                                                                                                                                      {
                                                                                                                                                        "functionName": "render",
                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/view.js",
                                                                                                                                                        "lineNumber": 124,
                                                                                                                                                        "callUID": 77,
                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                        "id": 43,
                                                                                                                                                        "scriptId": 116,
                                                                                                                                                        "hitCount": 1,
                                                                                                                                                        "children": [
                                                                                                                                                          {
                                                                                                                                                            "functionName": "exports.__express",
                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/index.js",
                                                                                                                                                            "lineNumber": 413,
                                                                                                                                                            "callUID": 76,
                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                            "id": 44,
                                                                                                                                                            "scriptId": 165,
                                                                                                                                                            "hitCount": 0,
                                                                                                                                                            "children": [
                                                                                                                                                              {
                                                                                                                                                                "functionName": "exports.renderFile",
                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/index.js",
                                                                                                                                                                "lineNumber": 362,
                                                                                                                                                                "callUID": 71,
                                                                                                                                                                "bailoutReason": "TryCatchStatement",
                                                                                                                                                                "id": 45,
                                                                                                                                                                "scriptId": 165,
                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                "children": [
                                                                                                                                                                  {
                                                                                                                                                                    "functionName": "exports.renderFile",
                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/index.js",
                                                                                                                                                                    "lineNumber": 362,
                                                                                                                                                                    "callUID": 71,
                                                                                                                                                                    "bailoutReason": "TryCatchStatement",
                                                                                                                                                                    "id": 46,
                                                                                                                                                                    "scriptId": 165,
                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                    "children": [
                                                                                                                                                                      {
                                                                                                                                                                        "functionName": "handleTemplateCache",
                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/index.js",
                                                                                                                                                                        "lineNumber": 168,
                                                                                                                                                                        "callUID": 70,
                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                        "id": 47,
                                                                                                                                                                        "scriptId": 165,
                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                        "children": [
                                                                                                                                                                          {
                                                                                                                                                                            "functionName": "exports.compile",
                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/index.js",
                                                                                                                                                                            "lineNumber": 196,
                                                                                                                                                                            "callUID": 65,
                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                            "id": 48,
                                                                                                                                                                            "scriptId": 165,
                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                            "children": [
                                                                                                                                                                              {
                                                                                                                                                                                "functionName": "parse",
                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/index.js",
                                                                                                                                                                                "lineNumber": 92,
                                                                                                                                                                                "callUID": 64,
                                                                                                                                                                                "bailoutReason": "TryCatchStatement",
                                                                                                                                                                                "id": 49,
                                                                                                                                                                                "scriptId": 165,
                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                "children": [
                                                                                                                                                                                  {
                                                                                                                                                                                    "functionName": "parse",
                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                    "lineNumber": 112,
                                                                                                                                                                                    "callUID": 18,
                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                    "id": 50,
                                                                                                                                                                                    "scriptId": 166,
                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                    "children": [
                                                                                                                                                                                      {
                                                                                                                                                                                        "functionName": "parseExpr",
                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                        "lineNumber": 208,
                                                                                                                                                                                        "callUID": 14,
                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                        "id": 51,
                                                                                                                                                                                        "scriptId": 166,
                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                        "children": [
                                                                                                                                                                                          {
                                                                                                                                                                                            "functionName": "parseTag",
                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                            "lineNumber": 753,
                                                                                                                                                                                            "callUID": 17,
                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                            "id": 52,
                                                                                                                                                                                            "scriptId": 166,
                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                            "children": [
                                                                                                                                                                                              {
                                                                                                                                                                                                "functionName": "tag",
                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                "lineNumber": 766,
                                                                                                                                                                                                "callUID": 16,
                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                "id": 53,
                                                                                                                                                                                                "scriptId": 166,
                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                "children": [
                                                                                                                                                                                                  {
                                                                                                                                                                                                    "functionName": "block",
                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                    "lineNumber": 720,
                                                                                                                                                                                                    "callUID": 15,
                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                    "id": 54,
                                                                                                                                                                                                    "scriptId": 166,
                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                      {
                                                                                                                                                                                                        "functionName": "parseExpr",
                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                        "lineNumber": 208,
                                                                                                                                                                                                        "callUID": 14,
                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                        "id": 55,
                                                                                                                                                                                                        "scriptId": 166,
                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                          {
                                                                                                                                                                                                            "functionName": "parseInclude",
                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                            "lineNumber": 581,
                                                                                                                                                                                                            "callUID": 13,
                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                            "id": 56,
                                                                                                                                                                                                            "scriptId": 166,
                                                                                                                                                                                                            "hitCount": 2,
                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                              {
                                                                                                                                                                                                                "functionName": "parse",
                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                "lineNumber": 112,
                                                                                                                                                                                                                "callUID": 18,
                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                "id": 94,
                                                                                                                                                                                                                "scriptId": 166,
                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                  {
                                                                                                                                                                                                                    "functionName": "parseExpr",
                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                    "lineNumber": 208,
                                                                                                                                                                                                                    "callUID": 14,
                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                    "id": 95,
                                                                                                                                                                                                                    "scriptId": 166,
                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                      {
                                                                                                                                                                                                                        "functionName": "parseTag",
                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                        "lineNumber": 753,
                                                                                                                                                                                                                        "callUID": 17,
                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                        "id": 96,
                                                                                                                                                                                                                        "scriptId": 166,
                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                          {
                                                                                                                                                                                                                            "functionName": "tag",
                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                            "lineNumber": 766,
                                                                                                                                                                                                                            "callUID": 16,
                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                            "id": 97,
                                                                                                                                                                                                                            "scriptId": 166,
                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                "functionName": "block",
                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                                "lineNumber": 720,
                                                                                                                                                                                                                                "callUID": 15,
                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                "id": 98,
                                                                                                                                                                                                                                "scriptId": 166,
                                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                    "functionName": "parseExpr",
                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                                    "lineNumber": 208,
                                                                                                                                                                                                                                    "callUID": 14,
                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                    "id": 99,
                                                                                                                                                                                                                                    "scriptId": 166,
                                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                        "functionName": "parseInclude",
                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                                        "lineNumber": 581,
                                                                                                                                                                                                                                        "callUID": 13,
                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                        "id": 100,
                                                                                                                                                                                                                                        "scriptId": 166,
                                                                                                                                                                                                                                        "hitCount": 1,
                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                            "functionName": "peek",
                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                                            "lineNumber": 78,
                                                                                                                                                                                                                                            "callUID": 10,
                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                            "id": 122,
                                                                                                                                                                                                                                            "scriptId": 166,
                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                "functionName": "lookahead",
                                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                                                "lineNumber": 0,
                                                                                                                                                                                                                                                "callUID": 9,
                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                "id": 123,
                                                                                                                                                                                                                                                "scriptId": 166,
                                                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                    "functionName": "lookahead",
                                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                                                    "lineNumber": 0,
                                                                                                                                                                                                                                                    "callUID": 8,
                                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                                    "id": 124,
                                                                                                                                                                                                                                                    "scriptId": 167,
                                                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                        "functionName": "next",
                                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/lexer.js",
                                                                                                                                                                                                                                                        "lineNumber": 910,
                                                                                                                                                                                                                                                        "callUID": 7,
                                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                                        "id": 125,
                                                                                                                                                                                                                                                        "scriptId": 167,
                                                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                                            "functionName": "attrs",
                                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/lexer.js",
                                                                                                                                                                                                                                                            "lineNumber": 608,
                                                                                                                                                                                                                                                            "callUID": 6,
                                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                                            "id": 126,
                                                                                                                                                                                                                                                            "scriptId": 167,
                                                                                                                                                                                                                                                            "hitCount": 1,
                                                                                                                                                                                                                                                            "children": [],
                                                                                                                                                                                                                                                            "lineTicks": [
                                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                                "line": 608,
                                                                                                                                                                                                                                                                "hitCount": 1
                                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                          },
                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                            "functionName": "resolvePath",
                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                                            "lineNumber": 479,
                                                                                                                                                                                                                                            "callUID": 12,
                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                            "id": 154,
                                                                                                                                                                                                                                            "scriptId": 166,
                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                "functionName": "basename",
                                                                                                                                                                                                                                                "url": "path.js",
                                                                                                                                                                                                                                                "lineNumber": 1352,
                                                                                                                                                                                                                                                "callUID": 11,
                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                "id": 155,
                                                                                                                                                                                                                                                "scriptId": 51,
                                                                                                                                                                                                                                                "hitCount": 1,
                                                                                                                                                                                                                                                "children": [],
                                                                                                                                                                                                                                                "lineTicks": [
                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                    "line": 1355,
                                                                                                                                                                                                                                                    "hitCount": 1
                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                        ],
                                                                                                                                                                                                                                        "lineTicks": [
                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                            "line": 581,
                                                                                                                                                                                                                                            "hitCount": 1
                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                  },
                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                    "functionName": "peek",
                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                                    "lineNumber": 78,
                                                                                                                                                                                                                                    "callUID": 10,
                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                    "id": 202,
                                                                                                                                                                                                                                    "scriptId": 166,
                                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                        "functionName": "lookahead",
                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                                        "lineNumber": 0,
                                                                                                                                                                                                                                        "callUID": 9,
                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                        "id": 203,
                                                                                                                                                                                                                                        "scriptId": 166,
                                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                            "functionName": "lookahead",
                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                                            "lineNumber": 0,
                                                                                                                                                                                                                                            "callUID": 8,
                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                            "id": 204,
                                                                                                                                                                                                                                            "scriptId": 167,
                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                "functionName": "next",
                                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/lexer.js",
                                                                                                                                                                                                                                                "lineNumber": 910,
                                                                                                                                                                                                                                                "callUID": 7,
                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                "id": 205,
                                                                                                                                                                                                                                                "scriptId": 167,
                                                                                                                                                                                                                                                "hitCount": 2,
                                                                                                                                                                                                                                                "children": [],
                                                                                                                                                                                                                                                "lineTicks": [
                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                    "line": 923,
                                                                                                                                                                                                                                                    "hitCount": 1
                                                                                                                                                                                                                                                  },
                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                    "line": 918,
                                                                                                                                                                                                                                                    "hitCount": 1
                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                              },
                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                "functionName": "peek",
                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                                "lineNumber": 78,
                                                                                                                                                                                                                                "callUID": 10,
                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                "id": 270,
                                                                                                                                                                                                                                "scriptId": 166,
                                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                    "functionName": "lookahead",
                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                                    "lineNumber": 0,
                                                                                                                                                                                                                                    "callUID": 9,
                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                    "id": 271,
                                                                                                                                                                                                                                    "scriptId": 166,
                                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                        "functionName": "lookahead",
                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                                                        "lineNumber": 0,
                                                                                                                                                                                                                                        "callUID": 8,
                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                        "id": 272,
                                                                                                                                                                                                                                        "scriptId": 167,
                                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                            "functionName": "next",
                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/lexer.js",
                                                                                                                                                                                                                                            "lineNumber": 910,
                                                                                                                                                                                                                                            "callUID": 7,
                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                            "id": 273,
                                                                                                                                                                                                                                            "scriptId": 167,
                                                                                                                                                                                                                                            "hitCount": 1,
                                                                                                                                                                                                                                            "children": [],
                                                                                                                                                                                                                                            "lineTicks": [
                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                "line": 937,
                                                                                                                                                                                                                                                "hitCount": 1
                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                              }
                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                          }
                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                      }
                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                  }
                                                                                                                                                                                                                ]
                                                                                                                                                                                                              }
                                                                                                                                                                                                            ],
                                                                                                                                                                                                            "lineTicks": [
                                                                                                                                                                                                              {
                                                                                                                                                                                                                "line": 620,
                                                                                                                                                                                                                "hitCount": 1
                                                                                                                                                                                                              },
                                                                                                                                                                                                              {
                                                                                                                                                                                                                "line": 613,
                                                                                                                                                                                                                "hitCount": 1
                                                                                                                                                                                                              }
                                                                                                                                                                                                            ]
                                                                                                                                                                                                          }
                                                                                                                                                                                                        ]
                                                                                                                                                                                                      }
                                                                                                                                                                                                    ]
                                                                                                                                                                                                  },
                                                                                                                                                                                                  {
                                                                                                                                                                                                    "functionName": "peek",
                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                    "lineNumber": 78,
                                                                                                                                                                                                    "callUID": 10,
                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                    "id": 214,
                                                                                                                                                                                                    "scriptId": 166,
                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                      {
                                                                                                                                                                                                        "functionName": "lookahead",
                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                        "lineNumber": 0,
                                                                                                                                                                                                        "callUID": 9,
                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                        "id": 215,
                                                                                                                                                                                                        "scriptId": 166,
                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                          {
                                                                                                                                                                                                            "functionName": "lookahead",
                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                            "lineNumber": 0,
                                                                                                                                                                                                            "callUID": 8,
                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                            "id": 216,
                                                                                                                                                                                                            "scriptId": 167,
                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                              {
                                                                                                                                                                                                                "functionName": "next",
                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/lexer.js",
                                                                                                                                                                                                                "lineNumber": 910,
                                                                                                                                                                                                                "callUID": 7,
                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                "id": 217,
                                                                                                                                                                                                                "scriptId": 167,
                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                  {
                                                                                                                                                                                                                    "functionName": "indent",
                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/lexer.js",
                                                                                                                                                                                                                    "lineNumber": 760,
                                                                                                                                                                                                                    "callUID": 19,
                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                    "id": 218,
                                                                                                                                                                                                                    "scriptId": 167,
                                                                                                                                                                                                                    "hitCount": 2,
                                                                                                                                                                                                                    "children": [],
                                                                                                                                                                                                                    "lineTicks": [
                                                                                                                                                                                                                      {
                                                                                                                                                                                                                        "line": 760,
                                                                                                                                                                                                                        "hitCount": 1
                                                                                                                                                                                                                      },
                                                                                                                                                                                                                      {
                                                                                                                                                                                                                        "line": 808,
                                                                                                                                                                                                                        "hitCount": 1
                                                                                                                                                                                                                      }
                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                  }
                                                                                                                                                                                                                ]
                                                                                                                                                                                                              }
                                                                                                                                                                                                            ]
                                                                                                                                                                                                          }
                                                                                                                                                                                                        ]
                                                                                                                                                                                                      }
                                                                                                                                                                                                    ]
                                                                                                                                                                                                  }
                                                                                                                                                                                                ]
                                                                                                                                                                                              }
                                                                                                                                                                                            ]
                                                                                                                                                                                          }
                                                                                                                                                                                        ]
                                                                                                                                                                                      },
                                                                                                                                                                                      {
                                                                                                                                                                                        "functionName": "peek",
                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                        "lineNumber": 78,
                                                                                                                                                                                        "callUID": 10,
                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                        "id": 182,
                                                                                                                                                                                        "scriptId": 166,
                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                        "children": [
                                                                                                                                                                                          {
                                                                                                                                                                                            "functionName": "lookahead",
                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                            "lineNumber": 0,
                                                                                                                                                                                            "callUID": 9,
                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                            "id": 183,
                                                                                                                                                                                            "scriptId": 166,
                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                            "children": [
                                                                                                                                                                                              {
                                                                                                                                                                                                "functionName": "lookahead",
                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/parser.js",
                                                                                                                                                                                                "lineNumber": 0,
                                                                                                                                                                                                "callUID": 8,
                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                "id": 184,
                                                                                                                                                                                                "scriptId": 167,
                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                "children": [
                                                                                                                                                                                                  {
                                                                                                                                                                                                    "functionName": "next",
                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/lexer.js",
                                                                                                                                                                                                    "lineNumber": 910,
                                                                                                                                                                                                    "callUID": 7,
                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                    "id": 185,
                                                                                                                                                                                                    "scriptId": 167,
                                                                                                                                                                                                    "hitCount": 1,
                                                                                                                                                                                                    "children": [],
                                                                                                                                                                                                    "lineTicks": [
                                                                                                                                                                                                      {
                                                                                                                                                                                                        "line": 910,
                                                                                                                                                                                                        "hitCount": 1
                                                                                                                                                                                                      }
                                                                                                                                                                                                    ]
                                                                                                                                                                                                  }
                                                                                                                                                                                                ]
                                                                                                                                                                                              }
                                                                                                                                                                                            ]
                                                                                                                                                                                          }
                                                                                                                                                                                        ]
                                                                                                                                                                                      }
                                                                                                                                                                                    ]
                                                                                                                                                                                  },
                                                                                                                                                                                  {
                                                                                                                                                                                    "functionName": "addWith",
                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/index.js",
                                                                                                                                                                                    "lineNumber": 40,
                                                                                                                                                                                    "callUID": 58,
                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                    "id": 57,
                                                                                                                                                                                    "scriptId": 616,
                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                    "children": [
                                                                                                                                                                                      {
                                                                                                                                                                                        "functionName": "findGlobals",
                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/index.js",
                                                                                                                                                                                        "lineNumber": 40,
                                                                                                                                                                                        "callUID": 57,
                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                        "id": 58,
                                                                                                                                                                                        "scriptId": 617,
                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                        "children": [
                                                                                                                                                                                          {
                                                                                                                                                                                            "functionName": "reallyParse",
                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/index.js",
                                                                                                                                                                                            "lineNumber": 21,
                                                                                                                                                                                            "callUID": 48,
                                                                                                                                                                                            "bailoutReason": "TryCatchStatement",
                                                                                                                                                                                            "id": 59,
                                                                                                                                                                                            "scriptId": 617,
                                                                                                                                                                                            "hitCount": 1,
                                                                                                                                                                                            "children": [
                                                                                                                                                                                              {
                                                                                                                                                                                                "functionName": "parse",
                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                "lineNumber": 901,
                                                                                                                                                                                                "callUID": 47,
                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                "id": 60,
                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                "children": [
                                                                                                                                                                                                  {
                                                                                                                                                                                                    "functionName": "parse",
                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                    "lineNumber": 1630,
                                                                                                                                                                                                    "callUID": 46,
                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                    "id": 61,
                                                                                                                                                                                                    "scriptId": 618,
                                                                                                                                                                                                    "hitCount": 1,
                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                      {
                                                                                                                                                                                                        "functionName": "pp.parseTopLevel",
                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                        "lineNumber": 1659,
                                                                                                                                                                                                        "callUID": 45,
                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                        "id": 62,
                                                                                                                                                                                                        "scriptId": 618,
                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                          {
                                                                                                                                                                                                            "functionName": "pp.parseStatement",
                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                            "lineNumber": 1687,
                                                                                                                                                                                                            "callUID": 44,
                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                            "id": 63,
                                                                                                                                                                                                            "scriptId": 618,
                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                              {
                                                                                                                                                                                                                "functionName": "pp.parseExpressionStatement",
                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                "lineNumber": 1967,
                                                                                                                                                                                                                "callUID": 24,
                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                "id": 64,
                                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                  {
                                                                                                                                                                                                                    "functionName": "pp.semicolon",
                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                    "lineNumber": 1478,
                                                                                                                                                                                                                    "callUID": 23,
                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                    "id": 65,
                                                                                                                                                                                                                    "scriptId": 618,
                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                      {
                                                                                                                                                                                                                        "functionName": "pp.eat",
                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                        "lineNumber": 1435,
                                                                                                                                                                                                                        "callUID": 22,
                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                        "id": 66,
                                                                                                                                                                                                                        "scriptId": 618,
                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                          {
                                                                                                                                                                                                                            "functionName": "pp.readWord1",
                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                            "lineNumber": 3087,
                                                                                                                                                                                                                            "callUID": 21,
                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                            "id": 67,
                                                                                                                                                                                                                            "scriptId": 618,
                                                                                                                                                                                                                            "hitCount": 1,
                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                "functionName": "pp.fullCharCodeAtPos",
                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                "lineNumber": 2493,
                                                                                                                                                                                                                                "callUID": 20,
                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                "id": 68,
                                                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                                                "hitCount": 1,
                                                                                                                                                                                                                                "children": [],
                                                                                                                                                                                                                                "lineTicks": [
                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                    "line": 2493,
                                                                                                                                                                                                                                    "hitCount": 1
                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                              }
                                                                                                                                                                                                                            ],
                                                                                                                                                                                                                            "lineTicks": [
                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                "line": 3087,
                                                                                                                                                                                                                                "hitCount": 1
                                                                                                                                                                                                                              }
                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                          }
                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                      }
                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                  }
                                                                                                                                                                                                                ]
                                                                                                                                                                                                              },
                                                                                                                                                                                                              {
                                                                                                                                                                                                                "functionName": "pp.parseExpression",
                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                "lineNumber": 83,
                                                                                                                                                                                                                "callUID": 43,
                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                "id": 101,
                                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                                "hitCount": 1,
                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                  {
                                                                                                                                                                                                                    "functionName": "pp.parseMaybeAssign",
                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                    "lineNumber": 99,
                                                                                                                                                                                                                    "callUID": 37,
                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                    "id": 102,
                                                                                                                                                                                                                    "scriptId": 618,
                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                      {
                                                                                                                                                                                                                        "functionName": "pp.parseMaybeConditional",
                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                        "lineNumber": 130,
                                                                                                                                                                                                                        "callUID": 36,
                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                        "id": 103,
                                                                                                                                                                                                                        "scriptId": 618,
                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                          {
                                                                                                                                                                                                                            "functionName": "pp.parseExprOps",
                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                            "lineNumber": 148,
                                                                                                                                                                                                                            "callUID": 35,
                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                            "id": 104,
                                                                                                                                                                                                                            "scriptId": 618,
                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                "functionName": "pp.parseMaybeUnary",
                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                "lineNumber": 183,
                                                                                                                                                                                                                                "callUID": 34,
                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                "id": 105,
                                                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                    "functionName": "pp.parseExprSubscripts",
                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                    "lineNumber": 213,
                                                                                                                                                                                                                                    "callUID": 41,
                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                    "id": 106,
                                                                                                                                                                                                                                    "scriptId": 618,
                                                                                                                                                                                                                                    "hitCount": 1,
                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                        "functionName": "pp.parseSubscripts",
                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                        "lineNumber": 222,
                                                                                                                                                                                                                                        "callUID": 42,
                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                        "id": 107,
                                                                                                                                                                                                                                        "scriptId": 618,
                                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                            "functionName": "pp.eat",
                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                            "lineNumber": 1435,
                                                                                                                                                                                                                                            "callUID": 22,
                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                            "id": 108,
                                                                                                                                                                                                                                            "scriptId": 618,
                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                "functionName": "pp.next",
                                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                "lineNumber": 0,
                                                                                                                                                                                                                                                "callUID": 32,
                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                "id": 109,
                                                                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                    "functionName": "pp.nextToken",
                                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                    "lineNumber": 0,
                                                                                                                                                                                                                                                    "callUID": 31,
                                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                                    "id": 110,
                                                                                                                                                                                                                                                    "scriptId": 618,
                                                                                                                                                                                                                                                    "hitCount": 1,
                                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                        "functionName": "pp.readToken",
                                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                        "lineNumber": 0,
                                                                                                                                                                                                                                                        "callUID": 30,
                                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                                        "id": 127,
                                                                                                                                                                                                                                                        "scriptId": 618,
                                                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                                            "functionName": "pp.getTokenFromCode",
                                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                            "lineNumber": 2692,
                                                                                                                                                                                                                                                            "callUID": 25,
                                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                                            "id": 128,
                                                                                                                                                                                                                                                            "scriptId": 618,
                                                                                                                                                                                                                                                            "hitCount": 1,
                                                                                                                                                                                                                                                            "children": [],
                                                                                                                                                                                                                                                            "lineTicks": [
                                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                                "line": 2692,
                                                                                                                                                                                                                                                                "hitCount": 1
                                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                                          },
                                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                                            "functionName": "pp.readWord",
                                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                            "lineNumber": 0,
                                                                                                                                                                                                                                                            "callUID": 29,
                                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                                            "id": 206,
                                                                                                                                                                                                                                                            "scriptId": 618,
                                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                                "functionName": "test",
                                                                                                                                                                                                                                                                "url": "native regexp.js",
                                                                                                                                                                                                                                                                "lineNumber": 260,
                                                                                                                                                                                                                                                                "callUID": 28,
                                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                "id": 207,
                                                                                                                                                                                                                                                                "scriptId": 12,
                                                                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                                    "functionName": "RegExpSubclassExec",
                                                                                                                                                                                                                                                                    "url": "native regexp.js",
                                                                                                                                                                                                                                                                    "lineNumber": 207,
                                                                                                                                                                                                                                                                    "callUID": 27,
                                                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                    "id": 208,
                                                                                                                                                                                                                                                                    "scriptId": 12,
                                                                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                                        "functionName": "exec",
                                                                                                                                                                                                                                                                        "url": "native regexp.js",
                                                                                                                                                                                                                                                                        "lineNumber": 116,
                                                                                                                                                                                                                                                                        "callUID": 26,
                                                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                        "id": 209,
                                                                                                                                                                                                                                                                        "scriptId": 12,
                                                                                                                                                                                                                                                                        "hitCount": 1,
                                                                                                                                                                                                                                                                        "children": [],
                                                                                                                                                                                                                                                                        "lineTicks": [
                                                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                                                            "line": 149,
                                                                                                                                                                                                                                                                            "hitCount": 1
                                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                    ],
                                                                                                                                                                                                                                                    "lineTicks": [
                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                        "line": 1435,
                                                                                                                                                                                                                                                        "hitCount": 1
                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                          },
                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                            "functionName": "pp.parseExprList",
                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                            "lineNumber": 635,
                                                                                                                                                                                                                                            "callUID": 38,
                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                            "id": 112,
                                                                                                                                                                                                                                            "scriptId": 618,
                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                "functionName": "pp.eat",
                                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                "lineNumber": 1435,
                                                                                                                                                                                                                                                "callUID": 22,
                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                "id": 113,
                                                                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                    "functionName": "pp.next",
                                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                    "lineNumber": 0,
                                                                                                                                                                                                                                                    "callUID": 32,
                                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                                    "id": 114,
                                                                                                                                                                                                                                                    "scriptId": 618,
                                                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                        "functionName": "pp.nextToken",
                                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                        "lineNumber": 0,
                                                                                                                                                                                                                                                        "callUID": 31,
                                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                                        "id": 115,
                                                                                                                                                                                                                                                        "scriptId": 618,
                                                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                                            "functionName": "pp.readToken",
                                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                            "lineNumber": 0,
                                                                                                                                                                                                                                                            "callUID": 30,
                                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                                            "id": 116,
                                                                                                                                                                                                                                                            "scriptId": 618,
                                                                                                                                                                                                                                                            "hitCount": 1,
                                                                                                                                                                                                                                                            "children": [],
                                                                                                                                                                                                                                                            "lineTicks": [
                                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                                "line": 1435,
                                                                                                                                                                                                                                                                "hitCount": 1
                                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                              },
                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                "functionName": "pp.parseMaybeAssign",
                                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                "lineNumber": 99,
                                                                                                                                                                                                                                                "callUID": 37,
                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                "id": 136,
                                                                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                    "functionName": "pp.parseMaybeConditional",
                                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                    "lineNumber": 0,
                                                                                                                                                                                                                                                    "callUID": 36,
                                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                                    "id": 137,
                                                                                                                                                                                                                                                    "scriptId": 618,
                                                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                        "functionName": "pp.parseExprOps",
                                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                        "lineNumber": 0,
                                                                                                                                                                                                                                                        "callUID": 35,
                                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                                        "id": 138,
                                                                                                                                                                                                                                                        "scriptId": 618,
                                                                                                                                                                                                                                                        "hitCount": 1,
                                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                                            "functionName": "pp.parseMaybeUnary",
                                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                            "lineNumber": 183,
                                                                                                                                                                                                                                                            "callUID": 34,
                                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                                            "id": 139,
                                                                                                                                                                                                                                                            "scriptId": 618,
                                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                                "functionName": "pp.parseExprSubscripts",
                                                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                "lineNumber": 213,
                                                                                                                                                                                                                                                                "callUID": 41,
                                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                "id": 140,
                                                                                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                                                                                "hitCount": 1,
                                                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                                    "functionName": "pp.parseExprAtom",
                                                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                    "lineNumber": 258,
                                                                                                                                                                                                                                                                    "callUID": 40,
                                                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                    "id": 141,
                                                                                                                                                                                                                                                                    "scriptId": 618,
                                                                                                                                                                                                                                                                    "hitCount": 1,
                                                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                                        "functionName": "pp.parseNew",
                                                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                        "lineNumber": 425,
                                                                                                                                                                                                                                                                        "callUID": 39,
                                                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                        "id": 219,
                                                                                                                                                                                                                                                                        "scriptId": 618,
                                                                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                                                            "functionName": "pp.parseExprList",
                                                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                            "lineNumber": 635,
                                                                                                                                                                                                                                                                            "callUID": 38,
                                                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                            "id": 220,
                                                                                                                                                                                                                                                                            "scriptId": 618,
                                                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                                                "functionName": "pp.parseMaybeAssign",
                                                                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                                "lineNumber": 99,
                                                                                                                                                                                                                                                                                "callUID": 37,
                                                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                                "id": 221,
                                                                                                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                                                    "functionName": "pp.parseMaybeConditional",
                                                                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                                    "lineNumber": 0,
                                                                                                                                                                                                                                                                                    "callUID": 36,
                                                                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                                    "id": 222,
                                                                                                                                                                                                                                                                                    "scriptId": 618,
                                                                                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                                                        "functionName": "pp.parseExprOps",
                                                                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                                        "lineNumber": 0,
                                                                                                                                                                                                                                                                                        "callUID": 35,
                                                                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                                        "id": 223,
                                                                                                                                                                                                                                                                                        "scriptId": 618,
                                                                                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                                                                            "functionName": "pp.parseMaybeUnary",
                                                                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                                            "lineNumber": 183,
                                                                                                                                                                                                                                                                                            "callUID": 34,
                                                                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                                            "id": 224,
                                                                                                                                                                                                                                                                                            "scriptId": 618,
                                                                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                                                                "functionName": "pp.checkExpressionErrors",
                                                                                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                                                "lineNumber": 1509,
                                                                                                                                                                                                                                                                                                "callUID": 33,
                                                                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                                                "id": 225,
                                                                                                                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                                                                                                                "hitCount": 1,
                                                                                                                                                                                                                                                                                                "children": [],
                                                                                                                                                                                                                                                                                                "lineTicks": [
                                                                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                                                                    "line": 1512,
                                                                                                                                                                                                                                                                                                    "hitCount": 1
                                                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                                    ],
                                                                                                                                                                                                                                                                    "lineTicks": [
                                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                                        "line": 287,
                                                                                                                                                                                                                                                                        "hitCount": 1
                                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                ],
                                                                                                                                                                                                                                                                "lineTicks": [
                                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                                    "line": 213,
                                                                                                                                                                                                                                                                    "hitCount": 1
                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                        ],
                                                                                                                                                                                                                                                        "lineTicks": [
                                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                                            "line": 99,
                                                                                                                                                                                                                                                            "hitCount": 1
                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                      },
                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                        "functionName": "pp.parseExprAtom",
                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                        "lineNumber": 258,
                                                                                                                                                                                                                                        "callUID": 40,
                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                        "id": 111,
                                                                                                                                                                                                                                        "scriptId": 618,
                                                                                                                                                                                                                                        "hitCount": 1,
                                                                                                                                                                                                                                        "children": [],
                                                                                                                                                                                                                                        "lineTicks": [
                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                            "line": 277,
                                                                                                                                                                                                                                            "hitCount": 1
                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                    ],
                                                                                                                                                                                                                                    "lineTicks": [
                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                        "line": 213,
                                                                                                                                                                                                                                        "hitCount": 1
                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                              }
                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                          }
                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                      }
                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                  }
                                                                                                                                                                                                                ],
                                                                                                                                                                                                                "lineTicks": [
                                                                                                                                                                                                                  {
                                                                                                                                                                                                                    "line": 86,
                                                                                                                                                                                                                    "hitCount": 1
                                                                                                                                                                                                                  }
                                                                                                                                                                                                                ]
                                                                                                                                                                                                              },
                                                                                                                                                                                                              {
                                                                                                                                                                                                                "functionName": "pp.parseMaybeAssign",
                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                "lineNumber": 99,
                                                                                                                                                                                                                "callUID": 37,
                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                "id": 246,
                                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                  {
                                                                                                                                                                                                                    "functionName": "pp.parseMaybeConditional",
                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                    "lineNumber": 0,
                                                                                                                                                                                                                    "callUID": 36,
                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                    "id": 247,
                                                                                                                                                                                                                    "scriptId": 618,
                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                      {
                                                                                                                                                                                                                        "functionName": "pp.parseExprOps",
                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                        "lineNumber": 0,
                                                                                                                                                                                                                        "callUID": 35,
                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                        "id": 248,
                                                                                                                                                                                                                        "scriptId": 618,
                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                          {
                                                                                                                                                                                                                            "functionName": "pp.parseMaybeUnary",
                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                            "lineNumber": 183,
                                                                                                                                                                                                                            "callUID": 34,
                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                            "id": 249,
                                                                                                                                                                                                                            "scriptId": 618,
                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                "functionName": "pp.parseExprSubscripts",
                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                "lineNumber": 213,
                                                                                                                                                                                                                                "callUID": 41,
                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                "id": 250,
                                                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                    "functionName": "pp.parseSubscripts",
                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                    "lineNumber": 222,
                                                                                                                                                                                                                                    "callUID": 42,
                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                    "id": 251,
                                                                                                                                                                                                                                    "scriptId": 618,
                                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                        "functionName": "pp.parseExprList",
                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                        "lineNumber": 635,
                                                                                                                                                                                                                                        "callUID": 38,
                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                        "id": 252,
                                                                                                                                                                                                                                        "scriptId": 618,
                                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                            "functionName": "pp.parseMaybeAssign",
                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                            "lineNumber": 99,
                                                                                                                                                                                                                                            "callUID": 37,
                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                            "id": 253,
                                                                                                                                                                                                                                            "scriptId": 618,
                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                "functionName": "pp.parseMaybeConditional",
                                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                "lineNumber": 0,
                                                                                                                                                                                                                                                "callUID": 36,
                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                "id": 254,
                                                                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                    "functionName": "pp.parseExprOps",
                                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                    "lineNumber": 0,
                                                                                                                                                                                                                                                    "callUID": 35,
                                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                                    "id": 255,
                                                                                                                                                                                                                                                    "scriptId": 618,
                                                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                        "functionName": "pp.parseMaybeUnary",
                                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                        "lineNumber": 183,
                                                                                                                                                                                                                                                        "callUID": 34,
                                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                                        "id": 256,
                                                                                                                                                                                                                                                        "scriptId": 618,
                                                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                                            "functionName": "pp.parseExprSubscripts",
                                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                            "lineNumber": 213,
                                                                                                                                                                                                                                                            "callUID": 41,
                                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                                            "id": 257,
                                                                                                                                                                                                                                                            "scriptId": 618,
                                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                                "functionName": "pp.parseExprAtom",
                                                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                "lineNumber": 258,
                                                                                                                                                                                                                                                                "callUID": 40,
                                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                "id": 258,
                                                                                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                                    "functionName": "pp.parseNew",
                                                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                    "lineNumber": 425,
                                                                                                                                                                                                                                                                    "callUID": 39,
                                                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                    "id": 259,
                                                                                                                                                                                                                                                                    "scriptId": 618,
                                                                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                                        "functionName": "pp.parseExprList",
                                                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                        "lineNumber": 635,
                                                                                                                                                                                                                                                                        "callUID": 38,
                                                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                        "id": 260,
                                                                                                                                                                                                                                                                        "scriptId": 618,
                                                                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                                                            "functionName": "pp.parseMaybeAssign",
                                                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                            "lineNumber": 99,
                                                                                                                                                                                                                                                                            "callUID": 37,
                                                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                            "id": 261,
                                                                                                                                                                                                                                                                            "scriptId": 618,
                                                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                                                "functionName": "pp.parseMaybeConditional",
                                                                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                                "lineNumber": 0,
                                                                                                                                                                                                                                                                                "callUID": 36,
                                                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                                "id": 262,
                                                                                                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                                                    "functionName": "pp.parseExprOps",
                                                                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                                    "lineNumber": 0,
                                                                                                                                                                                                                                                                                    "callUID": 35,
                                                                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                                    "id": 263,
                                                                                                                                                                                                                                                                                    "scriptId": 618,
                                                                                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                                                        "functionName": "pp.parseMaybeUnary",
                                                                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                                        "lineNumber": 183,
                                                                                                                                                                                                                                                                                        "callUID": 34,
                                                                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                                        "id": 264,
                                                                                                                                                                                                                                                                                        "scriptId": 618,
                                                                                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                                                                            "functionName": "pp.parseExprSubscripts",
                                                                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                                            "lineNumber": 213,
                                                                                                                                                                                                                                                                                            "callUID": 41,
                                                                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                                            "id": 265,
                                                                                                                                                                                                                                                                                            "scriptId": 618,
                                                                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                                                                "functionName": "pp.parseSubscripts",
                                                                                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                                                "lineNumber": 222,
                                                                                                                                                                                                                                                                                                "callUID": 42,
                                                                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                                                "id": 266,
                                                                                                                                                                                                                                                                                                "scriptId": 618,
                                                                                                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                                                                    "functionName": "pp.parseExpression",
                                                                                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/acorn.js",
                                                                                                                                                                                                                                                                                                    "lineNumber": 83,
                                                                                                                                                                                                                                                                                                    "callUID": 43,
                                                                                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                                                    "id": 267,
                                                                                                                                                                                                                                                                                                    "scriptId": 618,
                                                                                                                                                                                                                                                                                                    "hitCount": 1,
                                                                                                                                                                                                                                                                                                    "children": [],
                                                                                                                                                                                                                                                                                                    "lineTicks": [
                                                                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                                                                        "line": 83,
                                                                                                                                                                                                                                                                                                        "hitCount": 1
                                                                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                              }
                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                          }
                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                      }
                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                  }
                                                                                                                                                                                                                ]
                                                                                                                                                                                                              }
                                                                                                                                                                                                            ]
                                                                                                                                                                                                          }
                                                                                                                                                                                                        ]
                                                                                                                                                                                                      }
                                                                                                                                                                                                    ],
                                                                                                                                                                                                    "lineTicks": [
                                                                                                                                                                                                      {
                                                                                                                                                                                                        "line": 1632,
                                                                                                                                                                                                        "hitCount": 1
                                                                                                                                                                                                      }
                                                                                                                                                                                                    ]
                                                                                                                                                                                                  }
                                                                                                                                                                                                ]
                                                                                                                                                                                              }
                                                                                                                                                                                            ],
                                                                                                                                                                                            "lineTicks": [
                                                                                                                                                                                              {
                                                                                                                                                                                                "line": 23,
                                                                                                                                                                                                "hitCount": 1
                                                                                                                                                                                              }
                                                                                                                                                                                            ]
                                                                                                                                                                                          },
                                                                                                                                                                                          {
                                                                                                                                                                                            "functionName": "ancestor",
                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                            "lineNumber": 46,
                                                                                                                                                                                            "callUID": 56,
                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                            "id": 69,
                                                                                                                                                                                            "scriptId": 619,
                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                            "children": [
                                                                                                                                                                                              {
                                                                                                                                                                                                "functionName": "c",
                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                "lineNumber": 48,
                                                                                                                                                                                                "callUID": 50,
                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                "id": 70,
                                                                                                                                                                                                "scriptId": 619,
                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                "children": [
                                                                                                                                                                                                  {
                                                                                                                                                                                                    "functionName": "base.Program.base.BlockStatement",
                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                    "lineNumber": 178,
                                                                                                                                                                                                    "callUID": 55,
                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                    "id": 71,
                                                                                                                                                                                                    "scriptId": 619,
                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                      {
                                                                                                                                                                                                        "functionName": "c",
                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                        "lineNumber": 48,
                                                                                                                                                                                                        "callUID": 50,
                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                        "id": 72,
                                                                                                                                                                                                        "scriptId": 619,
                                                                                                                                                                                                        "hitCount": 2,
                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                          {
                                                                                                                                                                                                            "functionName": "skipThrough",
                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                            "lineNumber": 168,
                                                                                                                                                                                                            "callUID": 51,
                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                            "id": 73,
                                                                                                                                                                                                            "scriptId": 619,
                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                              {
                                                                                                                                                                                                                "functionName": "c",
                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                "lineNumber": 48,
                                                                                                                                                                                                                "callUID": 50,
                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                "id": 74,
                                                                                                                                                                                                                "scriptId": 619,
                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                  {
                                                                                                                                                                                                                    "functionName": "base.ExpressionStatement.base.ParenthesizedExpression",
                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                    "lineNumber": 185,
                                                                                                                                                                                                                    "callUID": 54,
                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                    "id": 75,
                                                                                                                                                                                                                    "scriptId": 619,
                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                      {
                                                                                                                                                                                                                        "functionName": "c",
                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                        "lineNumber": 48,
                                                                                                                                                                                                                        "callUID": 50,
                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                        "id": 76,
                                                                                                                                                                                                                        "scriptId": 619,
                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                          {
                                                                                                                                                                                                                            "functionName": "skipThrough",
                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                            "lineNumber": 168,
                                                                                                                                                                                                                            "callUID": 51,
                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                            "id": 77,
                                                                                                                                                                                                                            "scriptId": 619,
                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                "functionName": "c",
                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                                "lineNumber": 48,
                                                                                                                                                                                                                                "callUID": 50,
                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                "id": 78,
                                                                                                                                                                                                                                "scriptId": 619,
                                                                                                                                                                                                                                "hitCount": 2,
                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                    "functionName": "base.NewExpression.base.CallExpression",
                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                                    "lineNumber": 328,
                                                                                                                                                                                                                                    "callUID": 53,
                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                    "id": 79,
                                                                                                                                                                                                                                    "scriptId": 619,
                                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                        "functionName": "c",
                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                                        "lineNumber": 48,
                                                                                                                                                                                                                                        "callUID": 50,
                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                        "id": 80,
                                                                                                                                                                                                                                        "scriptId": 619,
                                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                            "functionName": "skipThrough",
                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                                            "lineNumber": 168,
                                                                                                                                                                                                                                            "callUID": 51,
                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                            "id": 81,
                                                                                                                                                                                                                                            "scriptId": 619,
                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                "functionName": "c",
                                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                                                "lineNumber": 48,
                                                                                                                                                                                                                                                "callUID": 50,
                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                "id": 82,
                                                                                                                                                                                                                                                "scriptId": 619,
                                                                                                                                                                                                                                                "hitCount": 2,
                                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                    "functionName": "base.MemberExpression",
                                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                                                    "lineNumber": 334,
                                                                                                                                                                                                                                                    "callUID": 52,
                                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                                    "id": 83,
                                                                                                                                                                                                                                                    "scriptId": 619,
                                                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                        "functionName": "c",
                                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                                                        "lineNumber": 48,
                                                                                                                                                                                                                                                        "callUID": 50,
                                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                                        "id": 84,
                                                                                                                                                                                                                                                        "scriptId": 619,
                                                                                                                                                                                                                                                        "hitCount": 1,
                                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                                            "functionName": "skipThrough",
                                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                                                            "lineNumber": 168,
                                                                                                                                                                                                                                                            "callUID": 51,
                                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                                            "id": 85,
                                                                                                                                                                                                                                                            "scriptId": 619,
                                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                                "functionName": "c",
                                                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                                                                "lineNumber": 48,
                                                                                                                                                                                                                                                                "callUID": 50,
                                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                "id": 86,
                                                                                                                                                                                                                                                                "scriptId": 619,
                                                                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                                    "functionName": "identifier",
                                                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/index.js",
                                                                                                                                                                                                                                                                    "lineNumber": 137,
                                                                                                                                                                                                                                                                    "callUID": 49,
                                                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                    "id": 87,
                                                                                                                                                                                                                                                                    "scriptId": 617,
                                                                                                                                                                                                                                                                    "hitCount": 1,
                                                                                                                                                                                                                                                                    "children": [],
                                                                                                                                                                                                                                                                    "lineTicks": [
                                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                                        "line": 142,
                                                                                                                                                                                                                                                                        "hitCount": 1
                                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                        ],
                                                                                                                                                                                                                                                        "lineTicks": [
                                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                                            "line": 48,
                                                                                                                                                                                                                                                            "hitCount": 1
                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                                  },
                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                    "functionName": "base.NewExpression.base.CallExpression",
                                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                                                    "lineNumber": 328,
                                                                                                                                                                                                                                                    "callUID": 53,
                                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                                    "id": 117,
                                                                                                                                                                                                                                                    "scriptId": 619,
                                                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                        "functionName": "c",
                                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                                                        "lineNumber": 48,
                                                                                                                                                                                                                                                        "callUID": 50,
                                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                                        "id": 118,
                                                                                                                                                                                                                                                        "scriptId": 619,
                                                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                                            "functionName": "skipThrough",
                                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                                                            "lineNumber": 168,
                                                                                                                                                                                                                                                            "callUID": 51,
                                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                                            "id": 119,
                                                                                                                                                                                                                                                            "scriptId": 619,
                                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                                "functionName": "c",
                                                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                                                                "lineNumber": 48,
                                                                                                                                                                                                                                                                "callUID": 50,
                                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                "id": 120,
                                                                                                                                                                                                                                                                "scriptId": 619,
                                                                                                                                                                                                                                                                "hitCount": 1,
                                                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                                    "functionName": "base.MemberExpression",
                                                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/node_modules/with/node_modules/acorn-globals/node_modules/acorn/dist/walk.js",
                                                                                                                                                                                                                                                                    "lineNumber": 334,
                                                                                                                                                                                                                                                                    "callUID": 52,
                                                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                                                    "id": 121,
                                                                                                                                                                                                                                                                    "scriptId": 619,
                                                                                                                                                                                                                                                                    "hitCount": 1,
                                                                                                                                                                                                                                                                    "children": [],
                                                                                                                                                                                                                                                                    "lineTicks": [
                                                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                                                        "line": 337,
                                                                                                                                                                                                                                                                        "hitCount": 1
                                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                ],
                                                                                                                                                                                                                                                                "lineTicks": [
                                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                                    "line": 48,
                                                                                                                                                                                                                                                                    "hitCount": 1
                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                ],
                                                                                                                                                                                                                                                "lineTicks": [
                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                    "line": 48,
                                                                                                                                                                                                                                                    "hitCount": 2
                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                ],
                                                                                                                                                                                                                                "lineTicks": [
                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                    "line": 49,
                                                                                                                                                                                                                                    "hitCount": 2
                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                              }
                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                          }
                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                      }
                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                  }
                                                                                                                                                                                                                ]
                                                                                                                                                                                                              }
                                                                                                                                                                                                            ]
                                                                                                                                                                                                          }
                                                                                                                                                                                                        ],
                                                                                                                                                                                                        "lineTicks": [
                                                                                                                                                                                                          {
                                                                                                                                                                                                            "line": 48,
                                                                                                                                                                                                            "hitCount": 2
                                                                                                                                                                                                          }
                                                                                                                                                                                                        ]
                                                                                                                                                                                                      }
                                                                                                                                                                                                    ]
                                                                                                                                                                                                  }
                                                                                                                                                                                                ]
                                                                                                                                                                                              }
                                                                                                                                                                                            ]
                                                                                                                                                                                          }
                                                                                                                                                                                        ]
                                                                                                                                                                                      }
                                                                                                                                                                                    ]
                                                                                                                                                                                  },
                                                                                                                                                                                  {
                                                                                                                                                                                    "functionName": "compile",
                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/compiler.js",
                                                                                                                                                                                    "lineNumber": 62,
                                                                                                                                                                                    "callUID": 63,
                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                    "id": 186,
                                                                                                                                                                                    "scriptId": 612,
                                                                                                                                                                                    "hitCount": 1,
                                                                                                                                                                                    "children": [
                                                                                                                                                                                      {
                                                                                                                                                                                        "functionName": "visit",
                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/compiler.js",
                                                                                                                                                                                        "lineNumber": 194,
                                                                                                                                                                                        "callUID": 61,
                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                        "id": 196,
                                                                                                                                                                                        "scriptId": 612,
                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                        "children": [
                                                                                                                                                                                          {
                                                                                                                                                                                            "functionName": "visitNode",
                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/compiler.js",
                                                                                                                                                                                            "lineNumber": 224,
                                                                                                                                                                                            "callUID": 60,
                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                            "id": 197,
                                                                                                                                                                                            "scriptId": 612,
                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                            "children": [
                                                                                                                                                                                              {
                                                                                                                                                                                                "functionName": "visitBlock",
                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/compiler.js",
                                                                                                                                                                                                "lineNumber": 281,
                                                                                                                                                                                                "callUID": 62,
                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                "id": 198,
                                                                                                                                                                                                "scriptId": 612,
                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                "children": [
                                                                                                                                                                                                  {
                                                                                                                                                                                                    "functionName": "visit",
                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/compiler.js",
                                                                                                                                                                                                    "lineNumber": 194,
                                                                                                                                                                                                    "callUID": 61,
                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                    "id": 199,
                                                                                                                                                                                                    "scriptId": 612,
                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                      {
                                                                                                                                                                                                        "functionName": "visitNode",
                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/compiler.js",
                                                                                                                                                                                                        "lineNumber": 224,
                                                                                                                                                                                                        "callUID": 60,
                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                        "id": 200,
                                                                                                                                                                                                        "scriptId": 612,
                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                          {
                                                                                                                                                                                                            "functionName": "visitTag",
                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/compiler.js",
                                                                                                                                                                                                            "lineNumber": 434,
                                                                                                                                                                                                            "callUID": 59,
                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                            "id": 201,
                                                                                                                                                                                                            "scriptId": 612,
                                                                                                                                                                                                            "hitCount": 1,
                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                              {
                                                                                                                                                                                                                "functionName": "visit",
                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/compiler.js",
                                                                                                                                                                                                                "lineNumber": 194,
                                                                                                                                                                                                                "callUID": 61,
                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                "id": 226,
                                                                                                                                                                                                                "scriptId": 612,
                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                  {
                                                                                                                                                                                                                    "functionName": "visitNode",
                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/compiler.js",
                                                                                                                                                                                                                    "lineNumber": 224,
                                                                                                                                                                                                                    "callUID": 60,
                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                    "id": 227,
                                                                                                                                                                                                                    "scriptId": 612,
                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                      {
                                                                                                                                                                                                                        "functionName": "visitBlock",
                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/compiler.js",
                                                                                                                                                                                                                        "lineNumber": 281,
                                                                                                                                                                                                                        "callUID": 62,
                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                        "id": 228,
                                                                                                                                                                                                                        "scriptId": 612,
                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                          {
                                                                                                                                                                                                                            "functionName": "visit",
                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/compiler.js",
                                                                                                                                                                                                                            "lineNumber": 194,
                                                                                                                                                                                                                            "callUID": 61,
                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                            "id": 229,
                                                                                                                                                                                                                            "scriptId": 612,
                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                "functionName": "visitNode",
                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/compiler.js",
                                                                                                                                                                                                                                "lineNumber": 224,
                                                                                                                                                                                                                                "callUID": 60,
                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                "id": 230,
                                                                                                                                                                                                                                "scriptId": 612,
                                                                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                                                                "children": [
                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                    "functionName": "visitBlock",
                                                                                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/compiler.js",
                                                                                                                                                                                                                                    "lineNumber": 281,
                                                                                                                                                                                                                                    "callUID": 62,
                                                                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                                                                    "id": 231,
                                                                                                                                                                                                                                    "scriptId": 612,
                                                                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                                                                    "children": [
                                                                                                                                                                                                                                      {
                                                                                                                                                                                                                                        "functionName": "visit",
                                                                                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/compiler.js",
                                                                                                                                                                                                                                        "lineNumber": 194,
                                                                                                                                                                                                                                        "callUID": 61,
                                                                                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                                                                                        "id": 232,
                                                                                                                                                                                                                                        "scriptId": 612,
                                                                                                                                                                                                                                        "hitCount": 0,
                                                                                                                                                                                                                                        "children": [
                                                                                                                                                                                                                                          {
                                                                                                                                                                                                                                            "functionName": "visitNode",
                                                                                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/compiler.js",
                                                                                                                                                                                                                                            "lineNumber": 224,
                                                                                                                                                                                                                                            "callUID": 60,
                                                                                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                                                                                            "id": 233,
                                                                                                                                                                                                                                            "scriptId": 612,
                                                                                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                                                                                            "children": [
                                                                                                                                                                                                                                              {
                                                                                                                                                                                                                                                "functionName": "visitTag",
                                                                                                                                                                                                                                                "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/jade/lib/compiler.js",
                                                                                                                                                                                                                                                "lineNumber": 434,
                                                                                                                                                                                                                                                "callUID": 59,
                                                                                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                                                                                "id": 234,
                                                                                                                                                                                                                                                "scriptId": 612,
                                                                                                                                                                                                                                                "hitCount": 1,
                                                                                                                                                                                                                                                "children": [],
                                                                                                                                                                                                                                                "lineTicks": [
                                                                                                                                                                                                                                                  {
                                                                                                                                                                                                                                                    "line": 487,
                                                                                                                                                                                                                                                    "hitCount": 1
                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                ]
                                                                                                                                                                                                                              }
                                                                                                                                                                                                                            ]
                                                                                                                                                                                                                          }
                                                                                                                                                                                                                        ]
                                                                                                                                                                                                                      }
                                                                                                                                                                                                                    ]
                                                                                                                                                                                                                  }
                                                                                                                                                                                                                ]
                                                                                                                                                                                                              }
                                                                                                                                                                                                            ],
                                                                                                                                                                                                            "lineTicks": [
                                                                                                                                                                                                              {
                                                                                                                                                                                                                "line": 456,
                                                                                                                                                                                                                "hitCount": 1
                                                                                                                                                                                                              }
                                                                                                                                                                                                            ]
                                                                                                                                                                                                          }
                                                                                                                                                                                                        ]
                                                                                                                                                                                                      }
                                                                                                                                                                                                    ]
                                                                                                                                                                                                  }
                                                                                                                                                                                                ]
                                                                                                                                                                                              }
                                                                                                                                                                                            ]
                                                                                                                                                                                          }
                                                                                                                                                                                        ]
                                                                                                                                                                                      }
                                                                                                                                                                                    ],
                                                                                                                                                                                    "lineTicks": [
                                                                                                                                                                                      {
                                                                                                                                                                                        "line": 70,
                                                                                                                                                                                        "hitCount": 1
                                                                                                                                                                                      }
                                                                                                                                                                                    ]
                                                                                                                                                                                  }
                                                                                                                                                                                ]
                                                                                                                                                                              }
                                                                                                                                                                            ]
                                                                                                                                                                          },
                                                                                                                                                                          {
                                                                                                                                                                            "functionName": "fs.readFileSync",
                                                                                                                                                                            "url": "fs.js",
                                                                                                                                                                            "lineNumber": 509,
                                                                                                                                                                            "callUID": 69,
                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                            "id": 132,
                                                                                                                                                                            "scriptId": 55,
                                                                                                                                                                            "hitCount": 1,
                                                                                                                                                                            "children": [
                                                                                                                                                                              {
                                                                                                                                                                                "functionName": "tryReadSync",
                                                                                                                                                                                "url": "fs.js",
                                                                                                                                                                                "lineNumber": 497,
                                                                                                                                                                                "callUID": 68,
                                                                                                                                                                                "bailoutReason": "TryFinallyStatement",
                                                                                                                                                                                "id": 133,
                                                                                                                                                                                "scriptId": 55,
                                                                                                                                                                                "hitCount": 0,
                                                                                                                                                                                "children": [
                                                                                                                                                                                  {
                                                                                                                                                                                    "functionName": "fs.readSync",
                                                                                                                                                                                    "url": "fs.js",
                                                                                                                                                                                    "lineNumber": 742,
                                                                                                                                                                                    "callUID": 67,
                                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                                    "id": 134,
                                                                                                                                                                                    "scriptId": 55,
                                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                                    "children": [
                                                                                                                                                                                      {
                                                                                                                                                                                        "functionName": "read",
                                                                                                                                                                                        "url": "",
                                                                                                                                                                                        "lineNumber": 0,
                                                                                                                                                                                        "callUID": 66,
                                                                                                                                                                                        "bailoutReason": "",
                                                                                                                                                                                        "id": 135,
                                                                                                                                                                                        "scriptId": 0,
                                                                                                                                                                                        "hitCount": 1,
                                                                                                                                                                                        "children": [],
                                                                                                                                                                                        "lineTicks": [
                                                                                                                                                                                          {
                                                                                                                                                                                            "line": 777,
                                                                                                                                                                                            "hitCount": 1
                                                                                                                                                                                          }
                                                                                                                                                                                        ]
                                                                                                                                                                                      }
                                                                                                                                                                                    ]
                                                                                                                                                                                  }
                                                                                                                                                                                ]
                                                                                                                                                                              }
                                                                                                                                                                            ],
                                                                                                                                                                            "lineTicks": [
                                                                                                                                                                              {
                                                                                                                                                                                "line": 569,
                                                                                                                                                                                "hitCount": 1
                                                                                                                                                                              }
                                                                                                                                                                            ]
                                                                                                                                                                          }
                                                                                                                                                                        ]
                                                                                                                                                                      }
                                                                                                                                                                    ]
                                                                                                                                                                  },
                                                                                                                                                                  {
                                                                                                                                                                    "functionName": "done",
                                                                                                                                                                    "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/response.js",
                                                                                                                                                                    "lineNumber": 955,
                                                                                                                                                                    "callUID": 75,
                                                                                                                                                                    "bailoutReason": "no reason",
                                                                                                                                                                    "id": 235,
                                                                                                                                                                    "scriptId": 152,
                                                                                                                                                                    "hitCount": 0,
                                                                                                                                                                    "children": [
                                                                                                                                                                      {
                                                                                                                                                                        "functionName": "send",
                                                                                                                                                                        "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/response.js",
                                                                                                                                                                        "lineNumber": 99,
                                                                                                                                                                        "callUID": 74,
                                                                                                                                                                        "bailoutReason": "no reason",
                                                                                                                                                                        "id": 236,
                                                                                                                                                                        "scriptId": 152,
                                                                                                                                                                        "hitCount": 1,
                                                                                                                                                                        "children": [
                                                                                                                                                                          {
                                                                                                                                                                            "functionName": "header",
                                                                                                                                                                            "url": "/Users/pmuellr/Projects/slides/2017/01-profiling-node/demos/express-demo/node_modules/express/lib/response.js",
                                                                                                                                                                            "lineNumber": 706,
                                                                                                                                                                            "callUID": 73,
                                                                                                                                                                            "bailoutReason": "no reason",
                                                                                                                                                                            "id": 237,
                                                                                                                                                                            "scriptId": 152,
                                                                                                                                                                            "hitCount": 0,
                                                                                                                                                                            "children": [
                                                                                                                                                                              {
                                                                                                                                                                                "functionName": "OutgoingMessage.setHeader",
                                                                                                                                                                                "url": "_http_outgoing.js",
                                                                                                                                                                                "lineNumber": 349,
                                                                                                                                                                                "callUID": 72,
                                                                                                                                                                                "bailoutReason": "no reason",
                                                                                                                                                                                "id": 238,
                                                                                                                                                                                "scriptId": 83,
                                                                                                                                                                                "hitCount": 1,
                                                                                                                                                                                "children": [],
                                                                                                                                                                                "lineTicks": [
                                                                                                                                                                                  {
                                                                                                                                                                                    "line": 364,
                                                                                                                                                                                    "hitCount": 1
                                                                                                                                                                                  }
                                                                                                                                                                                ]
                                                                                                                                                                              }
                                                                                                                                                                            ]
                                                                                                                                                                          }
                                                                                                                                                                        ],
                                                                                                                                                                        "lineTicks": [
                                                                                                                                                                          {
                                                                                                                                                                            "line": 99,
                                                                                                                                                                            "hitCount": 1
                                                                                                                                                                          }
                                                                                                                                                                        ]
                                                                                                                                                                      }
                                                                                                                                                                    ]
                                                                                                                                                                  }
                                                                                                                                                                ]
                                                                                                                                                              }
                                                                                                                                                            ]
                                                                                                                                                          }
                                                                                                                                                        ],
                                                                                                                                                        "lineTicks": [
                                                                                                                                                          {
                                                                                                                                                            "line": 124,
                                                                                                                                                            "hitCount": 1
                                                                                                                                                          }
                                                                                                                                                        ]
                                                                                                                                                      }
                                                                                                                                                    ]
                                                                                                                                                  }
                                                                                                                                                ]
                                                                                                                                              }
                                                                                                                                            ]
                                                                                                                                          }
                                                                                                                                        ]
                                                                                                                                      }
                                                                                                                                    ]
                                                                                                                                  }
                                                                                                                                ]
                                                                                                                              }
                                                                                                                            ]
                                                                                                                          }
                                                                                                                        ]
                                                                                                                      }
                                                                                                                    ]
                                                                                                                  }
                                                                                                                ]
                                                                                                              }
                                                                                                            ]
                                                                                                          }
                                                                                                        ]
                                                                                                      }
                                                                                                    ]
                                                                                                  }
                                                                                                ]
                                                                                              }
                                                                                            ]
                                                                                          }
                                                                                        ]
                                                                                      }
                                                                                    ]
                                                                                  }
                                                                                ]
                                                                              }
                                                                            ]
                                                                          }
                                                                        ]
                                                                      }
                                                                    ]
                                                                  }
                                                                ]
                                                              }
                                                            ]
                                                          }
                                                        ]
                                                      }
                                                    ]
                                                  }
                                                ]
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "functionName": "(idle)",
        "url": "",
        "lineNumber": 0,
        "callUID": 99,
        "bailoutReason": "",
        "id": 88,
        "scriptId": 0,
        "hitCount": 3672,
        "children": []
      },
      {
        "functionName": "onlookup",
        "url": "dns.js",
        "lineNumber": 74,
        "callUID": 104,
        "bailoutReason": "no reason",
        "id": 89,
        "scriptId": 164,
        "hitCount": 0,
        "children": [
          {
            "functionName": "asyncCallback",
            "url": "dns.js",
            "lineNumber": 59,
            "callUID": 103,
            "bailoutReason": "no reason",
            "id": 90,
            "scriptId": 164,
            "hitCount": 0,
            "children": [
              {
                "functionName": "",
                "url": "net.js",
                "lineNumber": 991,
                "callUID": 102,
                "bailoutReason": "no reason",
                "id": 91,
                "scriptId": 70,
                "hitCount": 0,
                "children": [
                  {
                    "functionName": "connect",
                    "url": "net.js",
                    "lineNumber": 817,
                    "callUID": 101,
                    "bailoutReason": "no reason",
                    "id": 92,
                    "scriptId": 70,
                    "hitCount": 0,
                    "children": [
                      {
                        "functionName": "connect",
                        "url": "",
                        "lineNumber": 0,
                        "callUID": 100,
                        "bailoutReason": "",
                        "id": 93,
                        "scriptId": 0,
                        "hitCount": 1,
                        "children": [],
                        "lineTicks": [
                          {
                            "line": 864,
                            "hitCount": 1
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "functionName": "(garbage collector)",
        "url": "",
        "lineNumber": 0,
        "callUID": 105,
        "bailoutReason": "",
        "id": 129,
        "scriptId": 0,
        "hitCount": 3,
        "children": []
      },
      {
        "functionName": "listOnTimeout",
        "url": "timers.js",
        "lineNumber": 161,
        "callUID": 109,
        "bailoutReason": "no reason",
        "id": 130,
        "scriptId": 40,
        "hitCount": 2,
        "children": [
          {
            "functionName": "now",
            "url": "",
            "lineNumber": 0,
            "callUID": 106,
            "bailoutReason": "",
            "id": 131,
            "scriptId": 0,
            "hitCount": 1,
            "children": [],
            "lineTicks": [
              {
                "line": 167,
                "hitCount": 1
              }
            ]
          },
          {
            "functionName": "tryOnTimeout",
            "url": "timers.js",
            "lineNumber": 233,
            "callUID": 108,
            "bailoutReason": "TryFinallyStatement",
            "id": 274,
            "scriptId": 40,
            "hitCount": 0,
            "children": [
              {
                "functionName": "ontimeout",
                "url": "timers.js",
                "lineNumber": 361,
                "callUID": 107,
                "bailoutReason": "no reason",
                "id": 275,
                "scriptId": 40,
                "hitCount": 1,
                "children": [],
                "lineTicks": [
                  {
                    "line": 361,
                    "hitCount": 1
                  }
                ]
              }
            ]
          }
        ],
        "lineTicks": [
          {
            "line": 165,
            "hitCount": 1
          },
          {
            "line": 167,
            "hitCount": 1
          }
        ]
      },
      {
        "functionName": "afterConnect",
        "url": "net.js",
        "lineNumber": 1051,
        "callUID": 116,
        "bailoutReason": "no reason",
        "id": 142,
        "scriptId": 70,
        "hitCount": 0,
        "children": [
          {
            "functionName": "emit",
            "url": "events.js",
            "lineNumber": 136,
            "callUID": 96,
            "bailoutReason": "no reason",
            "id": 143,
            "scriptId": 36,
            "hitCount": 0,
            "children": [
              {
                "functionName": "emitNone",
                "url": "events.js",
                "lineNumber": 84,
                "callUID": 115,
                "bailoutReason": "no reason",
                "id": 144,
                "scriptId": 36,
                "hitCount": 0,
                "children": [
                  {
                    "functionName": "g",
                    "url": "events.js",
                    "lineNumber": 287,
                    "callUID": 114,
                    "bailoutReason": "no reason",
                    "id": 145,
                    "scriptId": 36,
                    "hitCount": 0,
                    "children": [
                      {
                        "functionName": "",
                        "url": "net.js",
                        "lineNumber": 669,
                        "callUID": 113,
                        "bailoutReason": "no reason",
                        "id": 146,
                        "scriptId": 70,
                        "hitCount": 0,
                        "children": [
                          {
                            "functionName": "Socket._writeGeneric",
                            "url": "net.js",
                            "lineNumber": 662,
                            "callUID": 112,
                            "bailoutReason": "no reason",
                            "id": 147,
                            "scriptId": 70,
                            "hitCount": 0,
                            "children": [
                              {
                                "functionName": "WritableState.onwrite",
                                "url": "_stream_writable.js",
                                "lineNumber": 89,
                                "callUID": 111,
                                "bailoutReason": "no reason",
                                "id": 148,
                                "scriptId": 59,
                                "hitCount": 0,
                                "children": [
                                  {
                                    "functionName": "onwrite",
                                    "url": "_stream_writable.js",
                                    "lineNumber": 356,
                                    "callUID": 110,
                                    "bailoutReason": "no reason",
                                    "id": 149,
                                    "scriptId": 59,
                                    "hitCount": 1,
                                    "children": [],
                                    "lineTicks": [
                                      {
                                        "line": 379,
                                        "hitCount": 1
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "functionName": "onconnection",
        "url": "net.js",
        "lineNumber": 1434,
        "callUID": 125,
        "bailoutReason": "no reason",
        "id": 150,
        "scriptId": 70,
        "hitCount": 0,
        "children": [
          {
            "functionName": "emit",
            "url": "events.js",
            "lineNumber": 136,
            "callUID": 96,
            "bailoutReason": "no reason",
            "id": 151,
            "scriptId": 36,
            "hitCount": 0,
            "children": [
              {
                "functionName": "emitOne",
                "url": "events.js",
                "lineNumber": 94,
                "callUID": 120,
                "bailoutReason": "no reason",
                "id": 152,
                "scriptId": 36,
                "hitCount": 0,
                "children": [
                  {
                    "functionName": "connectionListener",
                    "url": "_http_server.js",
                    "lineNumber": 264,
                    "callUID": 119,
                    "bailoutReason": "no reason",
                    "id": 153,
                    "scriptId": 84,
                    "hitCount": 1,
                    "children": [
                      {
                        "functionName": "Readable.on",
                        "url": "_stream_readable.js",
                        "lineNumber": 686,
                        "callUID": 118,
                        "bailoutReason": "no reason",
                        "id": 268,
                        "scriptId": 57,
                        "hitCount": 0,
                        "children": [
                          {
                            "functionName": "_addListener",
                            "url": "events.js",
                            "lineNumber": 210,
                            "callUID": 117,
                            "bailoutReason": "no reason",
                            "id": 269,
                            "scriptId": 36,
                            "hitCount": 1,
                            "children": [],
                            "lineTicks": [
                              {
                                "line": 215,
                                "hitCount": 1
                              }
                            ]
                          }
                        ]
                      }
                    ],
                    "lineTicks": [
                      {
                        "line": 320,
                        "hitCount": 1
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            "functionName": "Socket",
            "url": "net.js",
            "lineNumber": 125,
            "callUID": 124,
            "bailoutReason": "no reason",
            "id": 192,
            "scriptId": 70,
            "hitCount": 0,
            "children": [
              {
                "functionName": "Duplex",
                "url": "_stream_duplex.js",
                "lineNumber": 23,
                "callUID": 123,
                "bailoutReason": "no reason",
                "id": 193,
                "scriptId": 60,
                "hitCount": 0,
                "children": [
                  {
                    "functionName": "Readable",
                    "url": "_stream_readable.js",
                    "lineNumber": 104,
                    "callUID": 122,
                    "bailoutReason": "no reason",
                    "id": 194,
                    "scriptId": 57,
                    "hitCount": 0,
                    "children": [
                      {
                        "functionName": "ReadableState",
                        "url": "_stream_readable.js",
                        "lineNumber": 35,
                        "callUID": 121,
                        "bailoutReason": "no reason",
                        "id": 195,
                        "scriptId": 57,
                        "hitCount": 1,
                        "children": [],
                        "lineTicks": [
                          {
                            "line": 35,
                            "hitCount": 1
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "functionName": "_tickCallback",
        "url": "internal/process/next_tick.js",
        "lineNumber": 87,
        "callUID": 135,
        "bailoutReason": "no reason",
        "id": 156,
        "scriptId": 45,
        "hitCount": 0,
        "children": [
          {
            "functionName": "_combinedTickCallback",
            "url": "internal/process/next_tick.js",
            "lineNumber": 65,
            "callUID": 134,
            "bailoutReason": "no reason",
            "id": 157,
            "scriptId": 45,
            "hitCount": 0,
            "children": [
              {
                "functionName": "finish",
                "url": "_http_outgoing.js",
                "lineNumber": 592,
                "callUID": 129,
                "bailoutReason": "no reason",
                "id": 158,
                "scriptId": 83,
                "hitCount": 0,
                "children": [
                  {
                    "functionName": "emit",
                    "url": "events.js",
                    "lineNumber": 136,
                    "callUID": 96,
                    "bailoutReason": "no reason",
                    "id": 159,
                    "scriptId": 36,
                    "hitCount": 1,
                    "children": [
                      {
                        "functionName": "emitNone",
                        "url": "events.js",
                        "lineNumber": 84,
                        "callUID": 115,
                        "bailoutReason": "no reason",
                        "id": 210,
                        "scriptId": 36,
                        "hitCount": 0,
                        "children": [
                          {
                            "functionName": "resOnFinish",
                            "url": "_http_server.js",
                            "lineNumber": 499,
                            "callUID": 128,
                            "bailoutReason": "no reason",
                            "id": 211,
                            "scriptId": 84,
                            "hitCount": 0,
                            "children": [
                              {
                                "functionName": "ServerResponse.detachSocket",
                                "url": "_http_server.js",
                                "lineNumber": 144,
                                "callUID": 127,
                                "bailoutReason": "no reason",
                                "id": 212,
                                "scriptId": 84,
                                "hitCount": 0,
                                "children": [
                                  {
                                    "functionName": "removeListener",
                                    "url": "events.js",
                                    "lineNumber": 315,
                                    "callUID": 126,
                                    "bailoutReason": "no reason",
                                    "id": 213,
                                    "scriptId": 36,
                                    "hitCount": 1,
                                    "children": [],
                                    "lineTicks": [
                                      {
                                        "line": 367,
                                        "hitCount": 1
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ],
                    "lineTicks": [
                      {
                        "line": 193,
                        "hitCount": 1
                      }
                    ]
                  }
                ]
              },
              {
                "functionName": "afterWrite",
                "url": "_stream_writable.js",
                "lineNumber": 384,
                "callUID": 133,
                "bailoutReason": "no reason",
                "id": 239,
                "scriptId": 59,
                "hitCount": 0,
                "children": [
                  {
                    "functionName": "finishMaybe",
                    "url": "_stream_writable.js",
                    "lineNumber": 0,
                    "callUID": 132,
                    "bailoutReason": "no reason",
                    "id": 240,
                    "scriptId": 59,
                    "hitCount": 0,
                    "children": [
                      {
                        "functionName": "emit",
                        "url": "events.js",
                        "lineNumber": 136,
                        "callUID": 96,
                        "bailoutReason": "no reason",
                        "id": 241,
                        "scriptId": 36,
                        "hitCount": 0,
                        "children": [
                          {
                            "functionName": "emitNone",
                            "url": "events.js",
                            "lineNumber": 84,
                            "callUID": 115,
                            "bailoutReason": "no reason",
                            "id": 242,
                            "scriptId": 36,
                            "hitCount": 0,
                            "children": [
                              {
                                "functionName": "g",
                                "url": "events.js",
                                "lineNumber": 287,
                                "callUID": 114,
                                "bailoutReason": "no reason",
                                "id": 243,
                                "scriptId": 36,
                                "hitCount": 0,
                                "children": [
                                  {
                                    "functionName": "Socket.destroy",
                                    "url": "net.js",
                                    "lineNumber": 522,
                                    "callUID": 131,
                                    "bailoutReason": "no reason",
                                    "id": 244,
                                    "scriptId": 70,
                                    "hitCount": 0,
                                    "children": [
                                      {
                                        "functionName": "Socket._destroy",
                                        "url": "net.js",
                                        "lineNumber": 464,
                                        "callUID": 130,
                                        "bailoutReason": "no reason",
                                        "id": 245,
                                        "scriptId": 70,
                                        "hitCount": 1,
                                        "children": [],
                                        "lineTicks": [
                                          {
                                            "line": 464,
                                            "hitCount": 1
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "functionName": "onread",
        "url": "net.js",
        "lineNumber": 530,
        "callUID": 148,
        "bailoutReason": "no reason",
        "id": 160,
        "scriptId": 70,
        "hitCount": 0,
        "children": [
          {
            "functionName": "Readable.push",
            "url": "_stream_readable.js",
            "lineNumber": 123,
            "callUID": 140,
            "bailoutReason": "no reason",
            "id": 161,
            "scriptId": 57,
            "hitCount": 0,
            "children": [
              {
                "functionName": "readableAddChunk",
                "url": "_stream_readable.js",
                "lineNumber": 147,
                "callUID": 139,
                "bailoutReason": "no reason",
                "id": 162,
                "scriptId": 57,
                "hitCount": 0,
                "children": [
                  {
                    "functionName": "emit",
                    "url": "events.js",
                    "lineNumber": 136,
                    "callUID": 96,
                    "bailoutReason": "no reason",
                    "id": 163,
                    "scriptId": 36,
                    "hitCount": 0,
                    "children": [
                      {
                        "functionName": "emitOne",
                        "url": "events.js",
                        "lineNumber": 94,
                        "callUID": 120,
                        "bailoutReason": "no reason",
                        "id": 164,
                        "scriptId": 36,
                        "hitCount": 0,
                        "children": [
                          {
                            "functionName": "socketOnData",
                            "url": "_http_client.js",
                            "lineNumber": 356,
                            "callUID": 138,
                            "bailoutReason": "no reason",
                            "id": 165,
                            "scriptId": 86,
                            "hitCount": 0,
                            "children": [
                              {
                                "functionName": "execute",
                                "url": "",
                                "lineNumber": 0,
                                "callUID": 137,
                                "bailoutReason": "",
                                "id": 166,
                                "scriptId": 0,
                                "hitCount": 0,
                                "children": [
                                  {
                                    "functionName": "parserOnMessageComplete",
                                    "url": "_http_common.js",
                                    "lineNumber": 129,
                                    "callUID": 136,
                                    "bailoutReason": "no reason",
                                    "id": 167,
                                    "scriptId": 81,
                                    "hitCount": 1,
                                    "children": [],
                                    "lineTicks": [
                                      {
                                        "line": 149,
                                        "hitCount": 1
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            "functionName": "emit",
            "url": "events.js",
            "lineNumber": 136,
            "callUID": 96,
            "bailoutReason": "no reason",
            "id": 168,
            "scriptId": 36,
            "hitCount": 0,
            "children": [
              {
                "functionName": "emitNone",
                "url": "events.js",
                "lineNumber": 84,
                "callUID": 115,
                "bailoutReason": "no reason",
                "id": 169,
                "scriptId": 36,
                "hitCount": 0,
                "children": [
                  {
                    "functionName": "onSocketEnd",
                    "url": "net.js",
                    "lineNumber": 259,
                    "callUID": 147,
                    "bailoutReason": "no reason",
                    "id": 170,
                    "scriptId": 70,
                    "hitCount": 0,
                    "children": [
                      {
                        "functionName": "Socket.destroySoon",
                        "url": "net.js",
                        "lineNumber": 453,
                        "callUID": 146,
                        "bailoutReason": "no reason",
                        "id": 171,
                        "scriptId": 70,
                        "hitCount": 1,
                        "children": [
                          {
                            "functionName": "Socket.end",
                            "url": "net.js",
                            "lineNumber": 427,
                            "callUID": 145,
                            "bailoutReason": "no reason",
                            "id": 172,
                            "scriptId": 70,
                            "hitCount": 0,
                            "children": [
                              {
                                "functionName": "Writable.end",
                                "url": "_stream_writable.js",
                                "lineNumber": 467,
                                "callUID": 144,
                                "bailoutReason": "no reason",
                                "id": 173,
                                "scriptId": 59,
                                "hitCount": 0,
                                "children": [
                                  {
                                    "functionName": "endWritable",
                                    "url": "_stream_writable.js",
                                    "lineNumber": 523,
                                    "callUID": 143,
                                    "bailoutReason": "no reason",
                                    "id": 174,
                                    "scriptId": 59,
                                    "hitCount": 0,
                                    "children": [
                                      {
                                        "functionName": "finishMaybe",
                                        "url": "_stream_writable.js",
                                        "lineNumber": 0,
                                        "callUID": 132,
                                        "bailoutReason": "no reason",
                                        "id": 175,
                                        "scriptId": 59,
                                        "hitCount": 0,
                                        "children": [
                                          {
                                            "functionName": "emit",
                                            "url": "events.js",
                                            "lineNumber": 136,
                                            "callUID": 96,
                                            "bailoutReason": "no reason",
                                            "id": 176,
                                            "scriptId": 36,
                                            "hitCount": 0,
                                            "children": [
                                              {
                                                "functionName": "emitNone",
                                                "url": "events.js",
                                                "lineNumber": 84,
                                                "callUID": 115,
                                                "bailoutReason": "no reason",
                                                "id": 177,
                                                "scriptId": 36,
                                                "hitCount": 0,
                                                "children": [
                                                  {
                                                    "functionName": "onSocketFinish",
                                                    "url": "net.js",
                                                    "lineNumber": 209,
                                                    "callUID": 142,
                                                    "bailoutReason": "no reason",
                                                    "id": 178,
                                                    "scriptId": 70,
                                                    "hitCount": 0,
                                                    "children": [
                                                      {
                                                        "functionName": "Socket.destroy",
                                                        "url": "net.js",
                                                        "lineNumber": 522,
                                                        "callUID": 131,
                                                        "bailoutReason": "no reason",
                                                        "id": 179,
                                                        "scriptId": 70,
                                                        "hitCount": 0,
                                                        "children": [
                                                          {
                                                            "functionName": "Socket._destroy",
                                                            "url": "net.js",
                                                            "lineNumber": 464,
                                                            "callUID": 130,
                                                            "bailoutReason": "no reason",
                                                            "id": 180,
                                                            "scriptId": 70,
                                                            "hitCount": 0,
                                                            "children": [
                                                              {
                                                                "functionName": "close",
                                                                "url": "",
                                                                "lineNumber": 0,
                                                                "callUID": 141,
                                                                "bailoutReason": "",
                                                                "id": 181,
                                                                "scriptId": 0,
                                                                "hitCount": 1,
                                                                "children": [],
                                                                "lineTicks": [
                                                                  {
                                                                    "line": 500,
                                                                    "hitCount": 1
                                                                  }
                                                                ]
                                                              }
                                                            ]
                                                          }
                                                        ]
                                                      }
                                                    ]
                                                  }
                                                ]
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ],
                        "lineTicks": [
                          {
                            "line": 455,
                            "hitCount": 1
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "functionName": "_handle.close",
        "url": "net.js",
        "lineNumber": 496,
        "callUID": 151,
        "bailoutReason": "no reason",
        "id": 187,
        "scriptId": 70,
        "hitCount": 0,
        "children": [
          {
            "functionName": "emit",
            "url": "events.js",
            "lineNumber": 136,
            "callUID": 96,
            "bailoutReason": "no reason",
            "id": 188,
            "scriptId": 36,
            "hitCount": 0,
            "children": [
              {
                "functionName": "emitOne",
                "url": "events.js",
                "lineNumber": 94,
                "callUID": 120,
                "bailoutReason": "no reason",
                "id": 189,
                "scriptId": 36,
                "hitCount": 1,
                "children": [
                  {
                    "functionName": "onClose",
                    "url": "_http_agent.js",
                    "lineNumber": 215,
                    "callUID": 150,
                    "bailoutReason": "no reason",
                    "id": 190,
                    "scriptId": 85,
                    "hitCount": 0,
                    "children": [
                      {
                        "functionName": "Agent.removeSocket",
                        "url": "_http_agent.js",
                        "lineNumber": 239,
                        "callUID": 149,
                        "bailoutReason": "no reason",
                        "id": 191,
                        "scriptId": 85,
                        "hitCount": 2,
                        "children": [],
                        "lineTicks": [
                          {
                            "line": 256,
                            "hitCount": 1
                          },
                          {
                            "line": 248,
                            "hitCount": 1
                          }
                        ]
                      }
                    ]
                  }
                ],
                "lineTicks": [
                  {
                    "line": 100,
                    "hitCount": 1
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  "startTime": 744466,
  "endTime": 744471,
}

},{}],4:[function(require,module,exports){
(function (__filename){
'use strict'

const GraphViz = window.Viz
const FileReader = window.FileReader

const CallGraph = require('../callGraph')

const logger = require('../logger').getLogger(__filename)

setTimeout(renderSample, 100)

window.ct2cgOnDragEnter = onDragEnter
window.ct2cgOnDragOver = onDragOver
window.ct2cgOnDrop = onDrop

// sample: https://jsbin.com/hiqasek/edit?html,js,output
// when drag entered
function onDragEnter () {
  const event = window.event
  logger.log('drag entered')
  event.stopPropagation()
  event.preventDefault()
}

// when dragged over
function onDragOver () {
  const event = window.event
  logger.log('drag overred')
  event.stopPropagation()
  event.preventDefault()
}

// when dropped
function onDrop () {
  const event = window.event
  event.stopPropagation()
  event.preventDefault()

  const dt = event.dataTransfer
  const file = dt.files[0]
  logger.log(`drag dropped file: ${file.name}`)

  const fileReader = new FileReader()
  fileReader.onabort = (e) => cb(new Error('interrupted'))
  fileReader.onerror = (e) => cb(new Error('some error'))
  fileReader.onload = (e) => cb(null, e)
  fileReader.readAsText(file)

  function cb (err, event) {
    if (err) return logger(`error loading ${file.name}: ${err}`)

    const cpuProfile = JSON.parse(event.target.result)
    renderCpuProfile(file.name, cpuProfile)
  }
}

// render the sample call graph
function renderSample () {
  logger.log('generating sample graph')

  const cpuProfile = require('./data/shortish.cpuprofile.json')
  renderCpuProfile('shortish.cpuprofile', cpuProfile)
}

// render a cpu profile object
function renderCpuProfile (fileName, cpuProfile) {
  logger.log('renderCpuProfile: start')

  const callGraph = CallGraph.create()
  callGraph.process(cpuProfile.head)
  callGraph.calculateSelfTime()

  const dotContent = callGraph.generateGraphviz()
  const svg = GraphViz(dotContent)

  logger.log('renderCpuProfile: done')

  const fileNameDiv = document.querySelectorAll('.file-name')[0]
  fileNameDiv.innerText = fileName

  const renderBox = document.querySelectorAll('.render-box')[0]
  renderBox.innerHTML = svg
}

}).call(this,"/lib/web/index.js")

},{"../callGraph":1,"../logger":2,"./data/shortish.cpuprofile.json":3}],5:[function(require,module,exports){
'use strict';
module.exports = function () {
	return /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PRZcf-nqry=><]/g;
};

},{}],6:[function(require,module,exports){
'use strict';

function assembleStyles () {
	var styles = {
		modifiers: {
			reset: [0, 0],
			bold: [1, 22], // 21 isn't widely supported and 22 does the same thing
			dim: [2, 22],
			italic: [3, 23],
			underline: [4, 24],
			inverse: [7, 27],
			hidden: [8, 28],
			strikethrough: [9, 29]
		},
		colors: {
			black: [30, 39],
			red: [31, 39],
			green: [32, 39],
			yellow: [33, 39],
			blue: [34, 39],
			magenta: [35, 39],
			cyan: [36, 39],
			white: [37, 39],
			gray: [90, 39]
		},
		bgColors: {
			bgBlack: [40, 49],
			bgRed: [41, 49],
			bgGreen: [42, 49],
			bgYellow: [43, 49],
			bgBlue: [44, 49],
			bgMagenta: [45, 49],
			bgCyan: [46, 49],
			bgWhite: [47, 49]
		}
	};

	// fix humans
	styles.colors.grey = styles.colors.gray;

	Object.keys(styles).forEach(function (groupName) {
		var group = styles[groupName];

		Object.keys(group).forEach(function (styleName) {
			var style = group[styleName];

			styles[styleName] = group[styleName] = {
				open: '\u001b[' + style[0] + 'm',
				close: '\u001b[' + style[1] + 'm'
			};
		});

		Object.defineProperty(styles, groupName, {
			value: group,
			enumerable: false
		});
	});

	return styles;
}

Object.defineProperty(module, 'exports', {
	enumerable: true,
	get: assembleStyles
});

},{}],7:[function(require,module,exports){
(function (process){
'use strict';
var escapeStringRegexp = require('escape-string-regexp');
var ansiStyles = require('ansi-styles');
var stripAnsi = require('strip-ansi');
var hasAnsi = require('has-ansi');
var supportsColor = require('supports-color');
var defineProps = Object.defineProperties;
var isSimpleWindowsTerm = process.platform === 'win32' && !/^xterm/i.test(process.env.TERM);

function Chalk(options) {
	// detect mode if not set manually
	this.enabled = !options || options.enabled === undefined ? supportsColor : options.enabled;
}

// use bright blue on Windows as the normal blue color is illegible
if (isSimpleWindowsTerm) {
	ansiStyles.blue.open = '\u001b[94m';
}

var styles = (function () {
	var ret = {};

	Object.keys(ansiStyles).forEach(function (key) {
		ansiStyles[key].closeRe = new RegExp(escapeStringRegexp(ansiStyles[key].close), 'g');

		ret[key] = {
			get: function () {
				return build.call(this, this._styles.concat(key));
			}
		};
	});

	return ret;
})();

var proto = defineProps(function chalk() {}, styles);

function build(_styles) {
	var builder = function () {
		return applyStyle.apply(builder, arguments);
	};

	builder._styles = _styles;
	builder.enabled = this.enabled;
	// __proto__ is used because we must return a function, but there is
	// no way to create a function with a different prototype.
	/* eslint-disable no-proto */
	builder.__proto__ = proto;

	return builder;
}

function applyStyle() {
	// support varags, but simply cast to string in case there's only one arg
	var args = arguments;
	var argsLen = args.length;
	var str = argsLen !== 0 && String(arguments[0]);

	if (argsLen > 1) {
		// don't slice `arguments`, it prevents v8 optimizations
		for (var a = 1; a < argsLen; a++) {
			str += ' ' + args[a];
		}
	}

	if (!this.enabled || !str) {
		return str;
	}

	var nestedStyles = this._styles;
	var i = nestedStyles.length;

	// Turns out that on Windows dimmed gray text becomes invisible in cmd.exe,
	// see https://github.com/chalk/chalk/issues/58
	// If we're on Windows and we're dealing with a gray color, temporarily make 'dim' a noop.
	var originalDim = ansiStyles.dim.open;
	if (isSimpleWindowsTerm && (nestedStyles.indexOf('gray') !== -1 || nestedStyles.indexOf('grey') !== -1)) {
		ansiStyles.dim.open = '';
	}

	while (i--) {
		var code = ansiStyles[nestedStyles[i]];

		// Replace any instances already present with a re-opening code
		// otherwise only the part of the string until said closing code
		// will be colored, and the rest will simply be 'plain'.
		str = code.open + str.replace(code.closeRe, code.open) + code.close;
	}

	// Reset the original 'dim' if we changed it to work around the Windows dimmed gray issue.
	ansiStyles.dim.open = originalDim;

	return str;
}

function init() {
	var ret = {};

	Object.keys(styles).forEach(function (name) {
		ret[name] = {
			get: function () {
				return build.call(this, [name]);
			}
		};
	});

	return ret;
}

defineProps(Chalk.prototype, init());

module.exports = new Chalk();
module.exports.styles = ansiStyles;
module.exports.hasColor = hasAnsi;
module.exports.stripColor = stripAnsi;
module.exports.supportsColor = supportsColor;

}).call(this,require('_process'))

},{"_process":11,"ansi-styles":6,"escape-string-regexp":8,"has-ansi":9,"strip-ansi":12,"supports-color":13}],8:[function(require,module,exports){
'use strict';

var matchOperatorsRe = /[|\\{}()[\]^$+*?.]/g;

module.exports = function (str) {
	if (typeof str !== 'string') {
		throw new TypeError('Expected a string');
	}

	return str.replace(matchOperatorsRe, '\\$&');
};

},{}],9:[function(require,module,exports){
'use strict';
var ansiRegex = require('ansi-regex');
var re = new RegExp(ansiRegex().source); // remove the `g` flag
module.exports = re.test.bind(re);

},{"ansi-regex":5}],10:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe =
    /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
var splitPath = function(filename) {
  return splitPathRe.exec(filename).slice(1);
};

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : process.cwd();

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
  var isAbsolute = exports.isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isAbsolute ? '/' : '') + path;
};

// posix version
exports.isAbsolute = function(path) {
  return path.charAt(0) === '/';
};

// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
};


// path.relative(from, to)
// posix version
exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

exports.sep = '/';
exports.delimiter = ':';

exports.dirname = function(path) {
  var result = splitPath(path),
      root = result[0],
      dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
};


exports.basename = function(path, ext) {
  var f = splitPath(path)[2];
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPath(path)[3];
};

function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b'
    ? function (str, start, len) { return str.substr(start, len) }
    : function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    }
;

}).call(this,require('_process'))

},{"_process":11}],11:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],12:[function(require,module,exports){
'use strict';
var ansiRegex = require('ansi-regex')();

module.exports = function (str) {
	return typeof str === 'string' ? str.replace(ansiRegex, '') : str;
};

},{"ansi-regex":5}],13:[function(require,module,exports){
(function (process){
'use strict';
var argv = process.argv;

var terminator = argv.indexOf('--');
var hasFlag = function (flag) {
	flag = '--' + flag;
	var pos = argv.indexOf(flag);
	return pos !== -1 && (terminator !== -1 ? pos < terminator : true);
};

module.exports = (function () {
	if ('FORCE_COLOR' in process.env) {
		return true;
	}

	if (hasFlag('no-color') ||
		hasFlag('no-colors') ||
		hasFlag('color=false')) {
		return false;
	}

	if (hasFlag('color') ||
		hasFlag('colors') ||
		hasFlag('color=true') ||
		hasFlag('color=always')) {
		return true;
	}

	if (process.stdout && !process.stdout.isTTY) {
		return false;
	}

	if (process.platform === 'win32') {
		return true;
	}

	if ('COLORTERM' in process.env) {
		return true;
	}

	if (process.env.TERM === 'dumb') {
		return false;
	}

	if (/^screen|^xterm|^vt100|color|ansi|cygwin|linux/i.test(process.env.TERM)) {
		return true;
	}

	return false;
})();

}).call(this,require('_process'))

},{"_process":11}],14:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],15:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],16:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./support/isBuffer":15,"_process":11,"inherits":14}],17:[function(require,module,exports){
module.exports={
  "name": "cp2cg",
  "version": "0.0.1",
  "description": "converts cpuprofile files to call graphs",
  "license": "MIT",
  "author": "Patrick Mueller <pmuellr@apache.org> (https://github.com/pmuellr)",
  "homepage": "https://github.com/pmuellr/cp2cg",
  "main": "cp2cg.js",
  "bin": {
    "cp2cg": "./bin/cp2cg.js"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/pmuellr/cp2cg.git"
  },
  "bugs": {
    "url": "https://github.com/pmuellr/cp2cg/issues"
  },
  "scripts": {
    "build": "node tools/build",
    "sample": "cd test/fixtures && ../../cp2cg.js express-jade.cpuprofile",
    "standard": "echo 'running standard' && standard -v",
    "testU": "npm -s run utest",
    "test": "npm -s run utest && npm -s run standard",
    "utest": "node test/index.js | FORCE_COLOR=1 tap-spec",
    "watch": "nodemon --exec 'node tools/watch-task'"
  },
  "standard": {
    "ignore": [
      "/tmp/",
      "/docs/app.js",
      "/docs/app.js.map.json",
      "/docs/viz.js",
      "/node_modules/"
    ]
  },
  "dependencies": {
    "chalk": "~1.1.3",
    "minimist": "~1.2.0",
    "viz.js": "~1.7.1"
  },
  "devDependencies": {
    "browserify": "~14.1.0",
    "cat-source-map": "~0.1.2",
    "chalk": "~1.1.3",
    "nodemon": "~1.11.0",
    "shelljs": "~0.7.6",
    "st": "~1.2.0",
    "standard": "~9.0.0",
    "tap-spec": "~4.1.1",
    "tape": "~4.6.0",
    "yield-callback": "~1.0.0"
  }
}

},{}]},{},[4])
// sourceMappingURL annotation removed by cat-source-map

//# sourceMappingURL=app.js.map.json