#!/usr/bin/env node

'use strict'

exports.cli = cli

const fs = require('fs')
const path = require('path')

const Graphviz = require('viz.js')

const pkg = require('./package.json')
const CallGraph = require('./lib/callGraph')

const logger = require('./lib/logger').getLogger(__filename)

// invoked as cli
function cli () {
  const cpFile = process.argv[2]

  if (cpFile == null) help()

  const cpuProfile = readCpuProfile(cpFile)

  if (cpuProfile.typeId !== 'CPU') {
    logger.log(`file ${cpFile} is not a CPU profile`)
    process.exit(1)
  }

  const callGraph = CallGraph.create()
  callGraph.process(cpuProfile.head)
  callGraph.calculateSelfTime()

  const dotContent = callGraph.generateGraphviz()

  const dotFile = `${path.basename(cpFile)}.dot`
  fs.writeFileSync(dotFile, dotContent)
  logger.log(`wrote file: "${dotFile}"`)

  const svg = Graphviz(dotContent)

  const svgFile = `${path.basename(cpFile)}.svg`
  fs.writeFileSync(svgFile, svg)
  logger.log(`wrote file: "${svgFile}"`)

  // for (let pkg of callGraph.packages.values()) {
  //   console.log(pkg.name)
  //   for (let mod of pkg.modules.values()) {
  //     console.log(`    ${mod.name}`)
  //     for (let call of mod.calls) {
  //       console.log(`        ${call.pkg.name}::${call.name}`)
  //     }
  //   }
  // }
}

// read and parse cpuprofile
function readCpuProfile (fileName) {
  let cpuProfileContents

  try {
    cpuProfileContents = fs.readFileSync(fileName, 'utf8')
  } catch (err) {
    logger.log(`error reading file ${fileName}: ${err}`)
    process.exit(1)
  }

  let cpuProfile
  try {
    cpuProfile = JSON.parse(cpuProfileContents)
  } catch (err) {
    logger.log(`error parsing JSON in file ${fileName}: ${err}`)
    process.exit(1)
  }

  return cpuProfile
}

// print help and exit
function help () {
  console.log(getHelp())
  process.exit(0)
}

// get help text
function getHelp () {
  const helpFile = path.join(__dirname, 'HELP.md')
  let helpText = fs.readFileSync(helpFile, 'utf8')

  helpText = helpText.replace(/%%program%%/g, pkg.name)
  helpText = helpText.replace(/%%version%%/g, pkg.version)

  return helpText
}

// run cli if invoked as main module
if (require.main === module) cli()
