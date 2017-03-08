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
    renderCpuProfile(cpuProfile)
  }
}

// render the sample call graph
function renderSample () {
  logger.log('generating sample graph')

  const cpuProfile = require('./data/shortish.cpuprofile.json')
  renderCpuProfile(cpuProfile)
}

// render a cpu profile object
function renderCpuProfile (cpuProfile) {
  logger.log('renderCpuProfile: start')

  const callGraph = CallGraph.create()
  callGraph.process(cpuProfile.head)
  callGraph.calculateSelfTime()

  const dotContent = callGraph.generateGraphviz()
  const svg = GraphViz(dotContent)

  logger.log('renderCpuProfile: done')

  const renderBox = document.querySelectorAll('.render-box')[0]
  renderBox.innerHTML = svg
}
