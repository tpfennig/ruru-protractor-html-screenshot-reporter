# s4-protractor-html-screenshot-reporter
Protractor test results in HTML format with screen captures. 

Will work with multi-capabilities and spec file sharding.

##BETA BETA BETA BETA

Needs more tests, more use in different configurations.

## Installation
`npm install s4-protractor-html-screenshot-reporter`

## Usage
Place the following in your Protractor configuration file
```javascript
var HTMLScreenshotReporter = require('s4-protractor-html-screenshot-reporter');
```
Create an instance of the reporter passing (optional) configuration parameters
```javascript
var htmlReporter = new HTMLScreenshotReporter({
	title : 'My Protractor End to End Test Report',
	targetPath : 'target',
	screenshotsFolder : 'screenshots-folder',
	fileName : 'protractor-e2e-report.html'
});
```
Place the following in your Protractor configuration file
```javascript
exports.config = {

	framework : 'jasmine2',
	
	//You MUST define the resultJsonOutputFile configuration so it can be post processed
	resultJsonOutputFile : 'my-protractor-e2e-results.json',

	...
	
	//Place an onPrepare function similar to:
	onPrepare : function () {

		// Assign the test reporters to each running instance
		jasmine.getEnv().addReporter(htmlReporter);

		//Provide browser with capability information so that all specs can access it
		return browser.getProcessedConfig().then(function (config) {
			return browser.getCapabilities().then(function (cap) {
				browser.version = cap.get('version');
				browser.browserName = cap.get('browserName');
				browser.baseUrl  = config.baseUrl;
			});
		});
	},
	
	//Place an afterLaunch function similar to:
	afterLaunch : function (exitCode) {
		return new Promise(function (resolve) {
			htmlReporter.generateHtmlReport(exports.config.resultJsonOutputFile);
		});
	}
}
```

## Development
If you want to build and test this project you will be able to by:
```
npm install
npm test
```
