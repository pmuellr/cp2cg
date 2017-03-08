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
