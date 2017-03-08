cp2cg - converts cpuprofile files to call graphs
================================================================================

Generates package/module-scoped call graph information based on `.cpuprofile`
files generated from V8's CPU profiler.

<img src='https://rawgit.com/pmuellr/cp2cg/master/test/fixtures/express-jade.cpuprofile.svg'>

Generates SVG via [viz.js](https://npmjs.org/package/viz.js).

Partitions the call graph by "packages" which contain "modules".
Partitioning is determined by the location of the string `node_modules` in
the script name, so probably won't work well in a browser, and is far from
perfect for Node.js apps as well.

Colors of modules are based on the hitCount of functions in the module.

Intra-package calls between modules are not shown, nor are calls to Node.js
built-in modules, to reduce clutter.


example usage
================================================================================

    cp2cg blorg.cpuprofile

Generates a `blorg.cpuprofile.svg` file in the current directory.


install
================================================================================

    npm install -g https://github.com/pmuellr/cp2cg


reference
================================================================================

* [viz.js](https://npmjs.org/package/viz.js)
* [Graphviz](http://www.graphviz.org/Documentation.php)
* [V8 CPU profiling](https://developers.google.com/web/tools/chrome-devtools/rendering-tools/js-execution?hl=en)
* [V8 Inspector for Node.js](https://nodejs.org/dist/latest-v6.x/docs/api/debugger.html#debugger_v8_inspector_integration_for_node_js)


license
================================================================================

This package is licensed under the MIT license.  See the
[LICENSE.md](LICENSE.md) file for more information.


contributing
================================================================================

Awesome!  We're happy that you want to contribute.

Please read the [CONTRIBUTING.md](CONTRIBUTING.md) file for more information.
