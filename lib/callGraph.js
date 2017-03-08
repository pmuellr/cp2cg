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
      const mods = Array.from(pkg.modules.values())
      mods.sort((mod1, mod2) => stringCompare(mod1.name, mod2.name))

      out.push(`    "${pkg.name}" [`)
      out.push('        shape = "plain"')

      const tdAttrs = 'align="left" border="1"'

      let href = ''
      if (pkg.name !== '(app)') {
        href = `href="https://npmjs.org/package/${pkg.name}"`
      }

      let packageCpu = 0
      for (let mod of mods) {
        packageCpu += Math.round(mod.selfTime * 100)
      }

      const tip = `title="package ${pkg.name} -- ${packageCpu}%"`
      const thAttrs = `${tdAttrs} cellpadding="8" bgcolor="cadetblue1" ${href} ${tip}`

      const label = []
      label.push('<table border="0" cellspacing="0">')
      label.push(`<tr><td ${thAttrs} ><b>${pkg.name}</b></td></tr>`)

      for (let mod of mods) {
        const cpup = Math.round(mod.selfTime * 100)
        const color = `bgcolor="${selfTimeColor(mod.selfTime)}"`
        const tip = `title="${cpup}% -- ${mod.node.url}" href="#"`
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
          const tooltip = `${pkg.name}:${mod.name} -> ${call.pkg.name}:${call.name}`
          const edge = `"${pkg.name}":"${mod.name}" -> "${call.pkg.name}":"${call.name}" [tooltip="${tooltip}"];`
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
