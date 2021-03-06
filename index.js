var fs = require('fs');
var path = require('path');
var reporter = require('./reporter.js');
var UNDEFINED;

var mkdirp = require('mkdirp');

var hasOwnProperty = Object.prototype.hasOwnProperty;


const __featureDenominator = 'Feature ';
const __scenarioDenominator = ' Scenario ';

function HTMLScreenshotReporter(options) {

    options = options || {};
    var self = this;
    self.started = false;
    self.finished = false;
    self.tsStart = new Date();


    function isFailed(obj) { return obj.status === "failed"; }
    function isSkipped(obj) { return obj.status === "pending"; }
    function isDisabled(obj) { return obj.status === "disabled"; }
    function pad(n) { return n < 10 ? '0'+n : n; }
    function padThree(n) { return n < 10 ? '00'+n : n < 100 ? '0'+n : n; }
    function extend(dupe, obj) { // performs a shallow copy of all props of `obj` onto `dupe`
        for (var prop in obj) {
            if (obj.hasOwnProperty(prop)) {
                dupe[prop] = obj[prop];
            }
        }
        return dupe;
    }
    function ISODateString(d) {
        return d.getUTCFullYear() + '-' +
            pad(d.getUTCMonth()+1) + '-' +
            pad(d.getUTCDate()) + 'T' +
            pad(d.getUTCHours()) + ':' +
            pad(d.getUTCMinutes()) + ':' +
            pad(d.getUTCSeconds()) + '.' +
            // TeamCity wants ss.SSS
            padThree(d.getUTCMilliseconds());
    }
    function log(str) {
        var con = global.console || console;
        if (con && con.log) {
            con.log(str);
        }
    }

    if(options.modifySuiteName && typeof options.modifySuiteName !== 'function') {
        throw new Error('option "modifySuiteName" must be a function');
    }

    var delegates = {};
    delegates.modifySuiteName = options.modifySuiteName;

    var currentSuite = null,
        totalSpecsDefined,
        // when use use fit, jasmine never calls suiteStarted / suiteDone, so make a fake one to use
        fakeFocusedSuite = {
            id: 'focused',
            description: 'focused specs',
            fullName: 'focused specs'
        };

    var __suites = {}, __specs = {};
    function getSuite(suite) {
        __suites[suite.id] = extend(__suites[suite.id] || {}, suite);
        return __suites[suite.id];
    }
    function getSpec(spec) {
        __specs[spec.id] = extend(__specs[spec.id] || {}, spec);
        return __specs[spec.id];
    }



    options.title = options.title || 'Protractor End to End Test Report';
    options.screenshotsFolder = options.screenshotsFolder || 'screenshots';
    options.fileName = options.fileName || 'protractor-e2e-report.html';
    options.targetPath = options.targetPath || 'target';

    self.jasmineStarted = function (summary) {
        totalSpecsDefined = summary && summary.totalSpecsDefined || NaN;
        self.started = true;
        tclog("progressStart 'Running Tests'");
    };

    self.suiteStarted = function (suite) {
        suite = getSuite(suite);
        suite._parent = currentSuite;
        currentSuite = suite;
        tclog("testSuiteStarted", {
            name: suite.description
        });
    };

    self.specStarted = function (spec) {
        if (!currentSuite) {
            // focused spec (fit) -- suiteStarted was never called
            self.suiteStarted(fakeFocusedSuite);
        }
        tcSpec = getSpec(spec);
        tclog("testStarted", {
            name: tcSpec.description,
            captureStandardOutput: 'true'
        });

        var featureName = spec.fullName.replace(spec.description, '');
        spec.description = __featureDenominator + featureName + __scenarioDenominator + spec.description;
        browser.currentTest = spec.description;
        if (browser.browserName) {
            spec.description += '__' + browser.browserName;
            browser.currentTest += '__' + browser.browserName;
        }
        spec.fullName = spec.description;
    };

    self.specDone = function (spec) {
        browser.takeScreenshot().then(function (png) {
            var filePath = path.join(options.targetPath, options.screenshotsFolder);
            mkdirp(filePath, function(err) {
                if(err) {
                    throw new Error('Could not create directory ' + filePath);
                } else {
                    writeScreenShot(png, path.join(filePath, sanitizeFilename(spec.description)) + '.png');
                }
            });

        });

        tcSpec = getSpec(spec);
        if (isSkipped(spec) || isDisabled(spec)) {
            tclog("testIgnored", {
                name: tcSpec.description
            });
        }
        // TeamCity specifies there should only be a single `testFailed`
        // message, so we'll only grab the first failedExpectation
        if (isFailed(spec) && tcSpec.failedExpectations.length) {
            var failure = tcSpec.failedExpectations[0];
            tclog("testFailed", {
                name: tcSpec.description,
                message: failure.message,
                details: failure.stack
            });
        }
        tclog("testFinished", {
            name: tcSpec.description
        });


    };

    self.suiteDone = function (suite) {
        suite = getSuite(suite);
        if (suite._parent === UNDEFINED) {
            // disabled suite (xdescribe) -- suiteStarted was never called
            self.suiteStarted(suite);
        }
        tclog("testSuiteFinished", {
            name: suite.description
        });
        currentSuite = suite._parent;
    };

    self.jasmineDone = function () {
        if (currentSuite) {
            // focused spec (fit) -- suiteDone was never called
            self.suiteDone(fakeFocusedSuite);
        }
        tclog("progressFinish 'Running Tests'");

        self.finished = true;
    };

    self.generateHtmlReport = function (inputFile) {
        var jsonResult = require(path.resolve(inputFile));
        var result = generateReport(jsonResult, options.title, elapsedTime(self.tsStart, Date.now()));
        fs.writeFileSync(path.resolve(options.targetPath, options.fileName), result);
    };

    var writeScreenShot = function (data, filePath) {
        var stream = fs.createWriteStream(filePath);
        stream.write(new Buffer(data, 'base64'));
        stream.end();
    };

    var sanitizeFilename = function (name) {
        if(typeof name !== "undefined"){
            name = name.replace(/\s+/g, '-'); // Replace white space with dash
            return name.replace(/[^0-9a-zA-Z\-_]/gi, ''); // Strip any special characters except the dash
        }
    };

    function generateReport(jsonstr, automationHeader, elapsedTime) {
        var allResults = [];
        var testArray = [];
        var browserArrayUnique = reporter.getUniqueBrowserNames(jsonstr);

        for (var q = 0; q < jsonstr.length; q++) {
            var browserName = reporter.getBrowserNameFromResult(jsonstr[q]);
            var testName = reporter.getTestNameFromResult(jsonstr[q]);
            var passed = reporter.determineTestStatus(jsonstr[q]);
            var stack = [];
            stack = consolidateAllStackTraces(jsonstr[q]);
            allResults.push(passed);
            testArray.push({
                testName: testName,
                browser: browserName,
                res: passed,
                duration: jsonstr[q].duration,
                stackTrace: stack
            });
        }

        var result = '';
        result += '<!-- saved from url=(0014)about:internet -->';
        result += '<!DOCTYPE html>';
        result += '<html>';
        result += concatHeadSection();
        result += '<body>';
        result += concatReportHeaderSection(automationHeader);
        result += concatRunInfoSection(elapsedTime);
        result += concatReportSummary(allResults);
        result += concatKnownIssues();
        result += concatSpecResults(testArray, browserArrayUnique);
        result += '</body>';
        result += '</html>';
        return result;
    }

    function consolidateAllStackTraces(run) {
        var assertions = (run.assertions) ? run.assertions : [];
        var stk = [];
        for (var i = 0; i < assertions.length; i++) {
            if (assertions[i].passed == false) {
                if (assertions[i].errorMsg) {
                    stk.push(assertions[i].errorMsg);
                }
                if (assertions[i].stackTrace) {
                    var stckTrc = assertions[i].stackTrace.split('\n');
                    for (var j = 0; j < stckTrc.length; j++) {
                        stk.push(stckTrc[j]);
                    }
                }
            }
        }
        return stk;
    }

    function concatSpecResults(testArray, browsers) {

        var features = copyResultsToFeatureCollection(testArray);
        var countIndex = 0;
        var result = '';
        var timeTrack = {};
        browsers.sort();

        for (var b = 0; b < browsers.length; b++) {
            timeTrack[browsers[b]] = {};
        }

        for (var f in features) {
            result += '<table class="testlist">';

            result += concatSpecTableHeader(f, browsers);

            var featureDuration = {};

            for (var scen in features[f]) {

                if (features[f].hasOwnProperty(scen)) {
                    countIndex++;
                }

                result += '<tr><td>' + countIndex + '</td><td class="testname">' + scen + '</td>';

                var exceptions = [];
                for (var b = 0; b < browsers.length; b++) {
                    var browserName = browsers[b];
                    if (featureDuration[browserName] == undefined) {
                        featureDuration[browserName] = 0;
                    }
                    for (var run in features[f][scen]) {
                        if (browserName === features[f][scen][run].name) {
                            featureDuration[browserName] += features[f][scen][run].duration;

                            if (timeTrack[browserName][f] == undefined) {
                                timeTrack[browserName][f] = 0;
                            }

                            timeTrack[browserName][f] += features[f][scen][run].duration;

                            if (features[f][scen][run].status == "true") {
                                result += '<td class="pass">' + linkToScreenshot(scen, browserName) + 'PASS</a>' +
                                    ' <span class="miliss">' + (features[f][scen][run].duration / 1000).toFixed(2) + 's.</span></td>';
                            }
                            if (features[f][scen][run].status == "false") {
                                result += '<td class="fail">FAIL - <a href="javascript:void(0)" onclick="showhide(\'' + sanitizeFilename(scen) + '\', \'' +
                                    sanitizeFilename(browserName) + '\')">stack trace</a> - ' + linkToScreenshot(scen, browserName) +
                                    'screen shot</a> <span class="miliss">' + (features[f][scen][run].duration / 1000).toFixed(2) + 's.</span></td>';
                                exceptions.push(concatStackTrace(runId(scen, browserName), features[f][scen][run], browsers.length + 2));
                            }
                            if (features[f][scen][run].status == "Skipped") {
                                result += '<td class="skip">Skipped (test duration ' + features[f][scen][run].duration + ' ms.)</td>';
                            }
                        }
                    }
                }
                result += '</tr>';
                if (exceptions.length > 0) {
                    for (var i = 0; i < exceptions.length; i++) {
                        result += exceptions[i];
                    }
                }

            }
            result += '</tr>';

            result += concatSpecTotalDuration(browsers, featureDuration);

            result += '</table>';
        }

        result += concatTimeAnalysisTable(timeTrack);

        return result;
    }

    function concatTimeAnalysisTable(timeTrack) {
        var result = '';
        result += '<div class="header">Feature Performance Report</div>';
        result += '<table class="testlist">';
        result += '<tr><th>Feature</th><th>Browser</th><th>Duration</th><th>Comparison</th></tr>';
        var largest = 0;
        for (var b in timeTrack) {
            for (var f in timeTrack[b]) {
                if (timeTrack[b][f] > largest) {
                    largest = timeTrack[b][f];
                }
            }
        }
        for (var b in timeTrack) {
            var browserName = b;
            for (var f in timeTrack[b]) {
                result += '<tr>';
                var featureName = f;
                result += '<td>' + featureName + '</td>';
                result += '<td>' + browserName + '</td>';
                result += '<td>' + timeTrack[b][f] + ' ms.</td>';
                var percentage = (timeTrack[b][f] / largest * 100).toFixed();
                result += '<td><div style="width:100%;background-color: #CCCCCC"><div style="width: ' + percentage +
                    '%;background-color: #1c94c4"><span>' + timeTrack[b][f] + '</span></div></div></td>';
                result += '</tr>';
            }
        }
        result += '</table>';
        return result;
    }

    function concatStackTrace(id, run, colspan) {
        var result = '';
        if (run.stackTrace) {
            if (run.stackTrace.length > 0) {
                result += '<tr class="stack" style="display:none" id="' + id + '">' +
                    '<td colspan="' + colspan + '" style="background-color: #FFBBBB">' +
                    '<table class="stacker">' +
                    '<tr><td class="error">' + reporter.encodeEntities(run.stackTrace[0]) + '</td></tr>';
                for (var i = 1; i < run.stackTrace.length; i++) {
                    result += '<tr><td'
                    if (run.stackTrace[i].indexOf('    at ') == 0) {
                        if (run.stackTrace[i].indexOf('node_modules') == -1 && run.stackTrace[i].indexOf('process._tickCallback') == -1) {
                            result += ' class="atstrong"';
                        } else {
                            result += ' class="at"';
                        }
                    }
                    result += '>' + reporter.encodeEntities(run.stackTrace[i]) + '</td></tr>'
                }
                result += '</table></td></tr>';
            }

        }
        return result;
    }

    function concatSpecTableHeader(featureName, sortedBrowsers) {
        var result = '<tr><th>Test#</th><th>' + featureName + '</th>';
        for (var i = 0; i < sortedBrowsers.length; i++) {
            result += '<th>' + sortedBrowsers[i] + '</th>';
        }
        result += '</tr>';
        return result;
    }

    function concatSpecTotalDuration(browsers, featureDuration) {
        var result = '<tr><td>Total Duration:</td><td></td>';
        for (var b = 0; b < browsers.length; b++) {
            var tElapseBegin = new Date();
            var tElapseEnd = new Date().setSeconds(new Date().getSeconds() + featureDuration[browsers[b]] / 1000);
            result += '<td>' + elapsedTime(tElapseBegin, tElapseEnd) + '</td>';
        }
        result += '</tr>';
        return result;
    }

    function linkToScreenshot(scenarioName, browserName) {
        return '<a href="' + options.screenshotsFolder + '/' + runId(scenarioName, browserName) + '.png">';
    }

    function runId(scenarioName, browserName) {
        return sanitizeFilename(scenarioName) + "__"+  sanitizeFilename(browserName);
    }

    function copyResultsToFeatureCollection(resultArray) {
        var featuresDummy = {};
        for (var i = 0; i < resultArray.length; i++) {
            var offset = __featureDenominator.length;
            var featureName = resultArray[i].testName.substr(offset, resultArray[i].testName.indexOf(__scenarioDenominator) - offset);
            if (!featuresDummy[featureName]) {
                featuresDummy[featureName] = {};
            }

            if (!featuresDummy[featureName][resultArray[i].testName]) {
                featuresDummy[featureName][resultArray[i].testName] = {};
            }

            if (!featuresDummy[featureName][resultArray[i].testName][resultArray[i].browser]) {
                featuresDummy[featureName][resultArray[i].testName][resultArray[i].browser] = {};
            }

            featuresDummy[featureName][resultArray[i].testName][resultArray[i].browser] = {
                name: resultArray[i].browser,
                duration: resultArray[i].duration,
                status: resultArray[i].res,
                stackTrace: resultArray[i].stackTrace
            };
        }
        return featuresDummy;
    }

    function concatHeadSection() {
        var result = '<head><meta http-equiv="Content-Type" content="text/html" />';
        result += concatCssSection();
        result += concatScriptSection();
        result += '</head>';
        return result;
    }

    function concatScriptSection() {
        var result = '<script type="text/javascript">';
        result += 'function showhide(scenarioName, browserName) {';
        result += '	var e = document.getElementById(scenarioName+"__"+browserName);';
        result += '	var s = e.style.display;';
        result += '	var divs = document.getElementsByTagName("tr"), item;';
        result += '	for (var i = 0, len = divs.length; i < len; i++) {';
        result += '		item = divs[i];';
        result += '		if (item.id){';
        result += '			if(item.id.indexOf(scenarioName) == 0) {';
        result += '				item.style.display = "none"';
        result += '			}';
        result += '		}';
        result += '	}';
        result += '	e.style.display = (s == "none") ? "table-row" : "none";';
        result += '}';
        result += '</script>';
        return result;
    }

    function concatCssSection() {
        var result = '<style type="text/css">';
        result += 'body{';
        result += '	font-family: verdana, arial, sans-serif;';
        result += '}';
        result += 'table {';
        result += '	border-collapse: collapse;';
        result += '	display: table;';
        result += '}';
        result += '.header {';
        result += '	font-size: 21px;';
        result += '	margin-top: 21px;';
        result += '	text-decoration: underline;';
        result += '	margin-bottom:21px;';
        result += '}';
        result += 'table.runInfo tr {';
        result += '	border-bottom-width: 1px;';
        result += '	border-bottom-style: solid;';
        result += '	border-bottom-color: #d0d0d0;';
        result += '	font-size: 10px;';
        result += '	color: #999999;';
        result += '}';
        result += 'table.runInfo td {';
        result += '	padding-right: 6px;';
        result += '	text-align: left';
        result += '}';
        result += 'table.runInfo th {';
        result += '	padding-right: 6px;';
        result += '	text-align: left';
        result += '}';
        result += 'table.runInfo img {';
        result += '	vertical-align:text-bottom;';
        result += '}';
        result += 'table.summary {';
        result += '	font-size: 9px;';
        result += '	color: #333333;';
        result += '	border-width: 1px;';
        result += '	border-color: #999999;';
        result += '	margin-top: 21px;';
        result += '}';
        result += 'table.summary tr {';
        result += '	background-color: #EFEFEF';
        result += '}';
        result += 'table.summary th {';
        result += '	background-color: #DEDEDE;';
        result += '	border-width: 1px;';
        result += '	padding: 6px;';
        result += '	border-style: solid;';
        result += '	border-color: #B3B3B3;';
        result += '}';
        result += 'table.summary td {';
        result += '	border-width: 1px;';
        result += '	padding: 6px;';
        result += '	border-style: solid;';
        result += '	border-color: #CFCFCF;';
        result += '	text-align: center';
        result += '}';
        result += 'table.testlist {';
        result += '	font-size: 10px;';
        result += '	color: #666666;';
        result += '	border-width: 1px;';
        result += '	border-color: #999999;';
        result += '	margin-top: 21px;';
        result += '	width: 100%;';
        result += '}';
        result += 'table.testlist th {';
        result += '	background-color: #CDCDCD;';
        result += '	border-width: 1px;';
        result += '	padding: 6px;';
        result += '	border-style: solid;';
        result += '	border-color: #B3B3B3;';
        result += '}';
        result += 'table.testlist tr {';
        result += '	background-color: #EFEFEF';
        result += '}';
        result += 'table.testlist td {';
        result += '	border-width: 1px;';
        result += '	padding: 6px;';
        result += '	border-style: solid;';
        result += '	border-color: #CFCFCF;';
        result += '	text-align: center';
        result += '}';
        result += 'table.testlist td.pass {';
        result += '	background-color: #BBFFBB;';
        result += '}';
        result += 'table.testlist td.clean a {';
        result += '	text-decoration: none;';
        result += '}';
        result += 'table.testlist td.fail {';
        result += '	background-color: #FFBBBB;';
        result += '}';
        result += 'table.testlist td.skip {';
        result += '	color: #787878;';
        result += '}';
        result += 'table.testlist td.testname {';
        result += '	text-align: left;';
        result += '}';
        result += 'table.testlist td.totals {';
        result += '	background-color: #CDCDCD;';
        result += '	border-color: #B3B3B3;';
        result += '	color: #666666;';
        result += '	padding: 2px;';
        result += '}';
        result += 'tr.stack {';
        result += '	display : none';
        result += '}';
        result += 'table.stacker {';
        result += '	font-size: 10px;';
        result += '	width: 100%;';
        result += '	border-style: solid;';
        result += '	border-width: 1px;';
        result += '	border-color: #CFCFCF;';
        result += '}';
        result += 'table.stacker td {';
        result += '	text-align: left;';
        result += '	padding: 3px;';
        result += '	padding-left:43px;';
        result += '	color: #888888;';
        result += '	border-style: none;';
        result += '}';
        result += 'table.stacker td.error {';
        result += '	text-align: left;';
        result += '	color: #FF0000;';
        result += '	padding: 3px;';
        result += '	padding-left:13px;';
        result += '	border-style: none;';
        result += '}';
        result += 'table.stacker td.at {';
        result += '	padding-left:63px;';
        result += '	color: #888888;';
        result += '}';
        result += 'table.stacker td.atstrong {';
        result += '	padding-left:63px;';
        result += '	color: #333333;';
        result += '}';
        result += 'table.stacker tr:nth-child(odd) {';
        result += '	background-color: #F8F8F8;';
        result += '}';
        result += '.miliss {';
        result += '	color: #9B9B9B;';
        result += '}';
        result += '</style>';
        return result;
    }

    function concatReportHeaderSection(automationHeader) {
        return '<div class="header">' + automationHeader + '</div>';
    }

    function concatRunInfoSection(elapsedTime) {
        return '<table class="runInfo"><tr><td>Elapsed time</td><td>' + elapsedTime + '</td></tr></table>';
    }

    function concatReportSummary(allResults) {
        var pass = reporter.countPassed(allResults);
        var fail = reporter.countFailed(allResults);
        var skipped = reporter.countSkipped(allResults);
        var result = '';
        var total = pass + fail + skipped;
        if (skipped > 0) {
            result += '<table class="summary"><tr><th>Total</th><th>Executed</th><th>Pending</th><th>Pass</th><th>Fail</th><th>Pass%</th></tr><tr><td>';
        } else {
            result += '<table class="summary"><tr><th>Total</th><th>Pass</th><th>Fail</th><th>Pass%</th></tr><tr><td>';
        }
        result += total + '</td><td>';
        if (skipped > 0) {
            result += (pass + fail) + '</td><td>';
            result += (skipped) + '</td><td>';
        }
        result += pass + '</td><td>';
        result += fail + '</td><td>';
        result += calculatePassPercentage(pass, fail) + '</td></tr></table>';
        return result;
    }

    function concatKnownIssues() {
        var result = '';
        var tempFiles = fs.readdirSync(path.resolve(options.targetPath));
        var filterFn = function (fname) {
            return fname.match('.*\.tmp$');
        };
        tempFiles = tempFiles.filter(filterFn);
        if (tempFiles.length) {
            result += '<div class="header">Known Issues</div>';
            result += '<table class="runInfo' +
                ' knownIssues"><tr><th>Type</th><th>Severity</th><th>Key</th><th>Description</th></tr>';
        }
        for (var i = 0; i < tempFiles.length; i++) {
            var bugPath = path.join(path.resolve(options.targetPath), tempFiles[i]);
            var raw = fs.readFileSync(bugPath);
            var bug = JSON.parse(raw);
            var key = bug.key;
            var type = '<img src="' + bug.fields.issuetype.iconUrl + '" title="' + bug.fields.issuetype.description + '">';
            var description = bug.fields.summary;
            var severity = '<img src="' + bug.fields.priority.iconUrl + '" title="' + bug.fields.priority.name + '">';
            result += '<tr><td>' + type + '</td><td>' + severity + '</td><td>' + key + '</td><td>' + description + '</td></tr>';
        }
        if (tempFiles.length) {
            result += '</table>';
        }
        return result;
    }

    function calculatePassPercentage(pass, fail) {
        return Math.floor((pass / (pass + fail)) * 100);
    }

    function elapsedTime(tsStart, tsEnd) {
        var timeDiff = tsEnd - tsStart;
        timeDiff /= 1000;
        var seconds = Math.round(timeDiff % 60);
        timeDiff = Math.floor(timeDiff / 60);
        var minutes = Math.round(timeDiff % 60);
        timeDiff = Math.floor(timeDiff / 60);
        var hours = Math.round(timeDiff % 24);
        timeDiff = Math.floor(timeDiff / 24);
        var days = timeDiff;
        var str = '';
        str += (days > 0) ? days + ' days ' : '';
        str += (days > 0 || hours > 0) ? hours + ' hs. ' : '';
        str += (days > 0 || hours > 0 || minutes > 0) ? minutes + ' mins. ' : '';
        str += seconds + ' secs.';
        return str;
    }

    function tclog(message, attrs) {
        var str = "##teamcity[" + message;
        if (typeof(attrs) === "object") {
            if (!("timestamp" in attrs)) {
                attrs.timestamp = new Date();
            }
            for (var prop in attrs) {
                if (attrs.hasOwnProperty(prop)) {
                    if(delegates.modifySuiteName && message.indexOf('testSuite') === 0 && prop === 'name') {
                        attrs[prop] = delegates.modifySuiteName(attrs[prop]);
                    }
                    str += " " + prop + "='" + escapeTeamCityString(attrs[prop]) + "'";
                }
            }
        }
        str += "]";
        log(str);
    }

    function escapeTeamCityString(str) {
        if(!str) {
            return "";
        }
        if (Object.prototype.toString.call(str) === '[object Date]') {
            return ISODateString(str);
        }

        return str.replace(/\|/g, "||")
            .replace(/\'/g, "|'")
            .replace(/\n/g, "|n")
            .replace(/\r/g, "|r")
            .replace(/\u0085/g, "|x")
            .replace(/\u2028/g, "|l")
            .replace(/\u2029/g, "|p")
            .replace(/\[/g, "|[")
            .replace(/]/g, "|]");
    }


    return this;
}

module.exports = HTMLScreenshotReporter;
