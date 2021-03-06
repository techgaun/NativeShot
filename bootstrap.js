// Imports
const {classes: Cc, interfaces: Ci, manager: Cm, results: Cr, utils: Cu, Constructor: CC} = Components;
Cm.QueryInterface(Ci.nsIComponentRegistrar);

const PromiseWorker = Cu.import('resource://gre/modules/PromiseWorker.jsm').BasePromiseWorker;
Cu.import('resource:///modules/CustomizableUI.jsm');
Cu.import('resource://gre/modules/osfile.jsm');
Cu.import('resource://gre/modules/Services.jsm');
Cu.import('resource://gre/modules/XPCOMUtils.jsm');
Cu.import('resource://gre/modules/AddonManager.jsm');

const COMMONJS_URI = 'resource://gre/modules/commonjs';
const { require } = Cu.import(COMMONJS_URI + '/toolkit/require.js', {});
var CLIPBOARD = require('sdk/clipboard');

// Globals
var core = { // core has stuff added into by MainWorker (currently MainWorker) and then it is updated
	addon: {
		name: 'NativeShot',
		id: 'NativeShot@jetpack',
		path: {
			name: 'nativeshot',
			content: 'chrome://nativeshot/content/',
			content_accessible: 'chrome://nativeshot-accessible/content/',
			images: 'chrome://nativeshot/content/resources/images/',
			locale: 'chrome://nativeshot/locale/',
			modules: 'chrome://nativeshot/content/modules/',
			resources: 'chrome://nativeshot/content/resources/',
			scripts: 'chrome://nativeshot/content/resources/scripts/',
			styles: 'chrome://nativeshot/content/resources/styles/'
		},
		prefbranch: 'extensions.NativeShot@jetpack.',
		prefs: {},
		cache_key: Math.random() // set to version on release
	},
	os: {
		name: OS.Constants.Sys.Name.toLowerCase(),
		toolkit: Services.appinfo.widgetToolkit.toLowerCase(),
		xpcomabi: Services.appinfo.XPCOMABI
	},
	firefox: {
		pid: Services.appinfo.processID,
		version: Services.appinfo.version
	}
};
core.os.mname = core.os.toolkit.indexOf('gtk') == 0 ? 'gtk' : core.os.name; // mname stands for modified-name // this will treat solaris, linux, unix, *bsd systems as the same. as they are all gtk based

var bootstrap = this;
var BOOTSTRAP = this;
const NS_HTML = 'http://www.w3.org/1999/xhtml';
const NS_XUL = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';

const TWITTER_URL = 'https://twitter.com/';
const TWITTER_IMG_SUFFIX = ':large';

var OSStuff = {};

var gFonts;
var gEditorStateStr;

var gCuiCssFilename;

// Lazy Imports
const myServices = {};
XPCOMUtils.defineLazyGetter(myServices, 'as', function () { return Cc['@mozilla.org/alerts-service;1'].getService(Ci.nsIAlertsService) });
XPCOMUtils.defineLazyGetter(myServices, 'hph', function () { return Cc['@mozilla.org/network/protocol;1?name=http'].getService(Ci.nsIHttpProtocolHandler); });
XPCOMUtils.defineLazyGetter(myServices, 'mm', function () { return Cc['@mozilla.org/globalmessagemanager;1'].getService(Ci.nsIMessageBroadcaster).QueryInterface(Ci.nsIFrameScriptLoader); });

// start - pref stuff
// Initialize the prefs object in core - this needs to be done first in the mainthread as then core gets sent to workers
// no validation is done on the defaultValue, i assume the devuser sets it right
var gPrefMeta = { // short for pref meta data // dictates dom structure in options.xhmtl crossfile-link44375677
	// each MUST HAVE defaultValue, values, type
	// type Custom MUST HAVE getter, setter can be null
	// setter and getter are for setting and getting into the environement they are got from. the js environment here which is core.addon.prefs[aPrefName] is updated on every set and get in prefSet and prefGet with approprate validation done there link3838375435343
		// but do not set the value of core.addon.prefs from the getter/setter
		// async getter, should return a promise, and the value resolved is what is used
	quick_save_dir: {
		defaultValue: quickSaveDirDefaultValue(),
		values: [quickSaveDirValidator],
		type: 'Char' // type is string - Char,Int,Bool,Custom // if custom it then needs a setter and getter. setter can be null then it is never written anywhere.
	},
	print_preview: {
		defaultValue: false,
		values: [false, true],
		type: 'Bool'
	},
	system_hotkey: {
		defaultValue: true,
		values: [false, true],
		type: 'Bool'
	},
	autoupdate: {
		defaultValue: true,
		values: [false, true], // false off, true on
		type: 'Custom',
		setter: function(aNewVal) {
			// i dont care to return promise on succesful set, even though it is async, because the core.addon.prefs[aPrefName] is updated right away and thats what the addon uses. and promise is only for the addon to know when done
			AddonManager.getAddonByID(core.addon.id, function(addon) {
				if (aNewVal) {
					addon.applyBackgroundUpdates  = 2;
				} else {
					addon.applyBackgroundUpdates  = 0;
				}
			});
		},
		getter: function() {
			// do no validation on gotten val, just report it back to devuser, validation is done after it is got
			var mainDeferred_getAutoupdate = new Deferred();
			
			AddonManager.getAddonByID(core.addon.id, function(addon) {
				// start - set lastUpdatedDate into core, this is bad, as getter is meant only for specific stuff. but on startup this gets called, and i need last updated date which is available here so this is unrelated to the pref system
				if (!core.addon.lastUpdatedDate) {
					core.addon.lastUpdatedGetTime = addon.updateDate.getTime();
				}
				// end - set lastUpdatedDate into core, this is bad, as getter is meant only for specific stuff. but on startup this gets called, and i need last updated date which is available here so this is unrelated to the pref system
				var gotVal = parseInt(addon.applyBackgroundUpdates);
				if (gotVal === 0) {
					mainDeferred_getAutoupdate.resolve(false);
				} else if (gotVal === 2) {
					mainDeferred_getAutoupdate.resolve(true);
				} else {
					// its 1, so default value, lets see what that is
					var gotValOfDefault = AddonManager.autoUpdateDefault; // true for on, false for off
					if (gotValOfDefault) {
						// default is on
						mainDeferred_getAutoupdate.resolve(true);
					} else {
						// default is off
						mainDeferred_getAutoupdate.resolve(false);
					}
				}
			});
			
			return mainDeferred_getAutoupdate.promise;
		}
	}
};

// only use prefGet function if you want to get fresh, otherwise just use core.addon.prefs[aPrefName] for the value
function prefGet(aPrefName) {
	
	var prefType = gPrefMeta[aPrefName].type;
	var gotVal;
	switch (prefType) {
		case 'Custom':
			
				gotVal = gPrefMeta[aPrefName].getter();
			
			break;
		case 'Char':
		case 'Int':
		case 'Bool':
			
				try {
					gotVal = Services.prefs['get' + prefType + 'Pref'](core.addon.prefbranch + aPrefName);
				} catch(ex) {
					// pref probably doesnt exist, so set it to defaultValue
					gotVal = gPrefMeta[aPrefName].defaultValue;
				}
			
			break;
		default:
			console.error('could not set because, invalid type set by devuser in gPrefMeta for aPrefName:', aPrefName);
			throw new Error('could not set because, invalid type set by devuser in gPrefMeta for aPrefName');
	}
	
	if (gotVal.constructor.name == 'Promise') {
		var deferred_waitGetter = new Deferred();
		
		// actually on error it returns the default value, because you wanted it fresh right, meaning the devuser thinks current value is defunct?? maybe so im going with this  decided against ----> // on error, it resolves with the current value, if no current value, then it resolves with the default value link444522952112
		
		gotVal.then(
			function(aVal) {
				console.log('Fullfilled - gotVal - ', aVal);
				// start - copy block1029221000
				if (isValidPrefVal(aPrefName, aVal)) {
					core.addon.prefs[aPrefName] = { // link3838375435343
						value: aVal,
						defaultValue: gPrefMeta[aPrefName].defaultValue
					};
					deferred_waitGetter.resolve(aVal);
				} else {
					console.error('got invalid value for pref name:', aPrefName, 'value got was:', '"' + aVal + '"', 'so returning default');
					core.addon.prefs[aPrefName] = { // link3838375435343
						value: gPrefMeta[aPrefName].defaultValue,
						defaultValue: gPrefMeta[aPrefName].defaultValue
					};
					// deferred_waitGetter.resolve(getFromCore_curValOrDefault(aPrefName)); // link444522952112
					deferred_waitGetter.resolve(gPrefMeta[aPrefName].defaultValue); // link444522952112
				}
				// end - copy block1029221000
			},
			function(aReason) {
				var rejObj = {
					name: 'gotVal',
					aReason: aReason
				};
				console.error('Rejected - gotVal - ', rejObj);
				core.addon.prefs[aPrefName] = { // link3838375435343
					value: gPrefMeta[aPrefName].defaultValue,
					defaultValue: gPrefMeta[aPrefName].defaultValue
				};
				// deferred_waitGetter.resolve(getFromCore_curValOrDefault(aPrefName)); // link444522952112
				deferred_waitGetter.resolve(gPrefMeta[aPrefName].defaultValue); // link444522952112
			}
		).catch(
			function(aCaught) {
				var rejObj = {
					name: 'gotVal',
					aCaught: aCaught
				};
				console.error('Caught - gotVal - ', rejObj);
				core.addon.prefs[aPrefName] = gPrefMeta[aPrefName].defaultValue; // link3838375435343
				// deferred_waitGetter.resolve(getFromCore_curValOrDefault(aPrefName)); // link444522952112
				deferred_waitGetter.resolve(gPrefMeta[aPrefName].defaultValue); // link444522952112
			}
		);
		
		return deferred_waitGetter.promise;
	} else {
		// start - copy block1029221000
		if (isValidPrefVal(aPrefName, gotVal)) {
			core.addon.prefs[aPrefName] = { // link3838375435343
				value: gotVal,
				defaultValue: gPrefMeta[aPrefName].defaultValue
			};
			return gotVal;
		}
		// end - copy block1029221000
	}
}

function getFromCore_curValOrDefault(aPrefName) {
	if (aPrefName in core.addon.prefs) {
		return core.addon.prefs[aPrefName];
	} else {
		return gPrefMeta[aPrefName].defaultValue;
	}
}

function prefSet(aPrefName, aNewVal) {
	// returns the prefName obj from core.addon.prefs on set. for non custom and custom sync the return true is valid statement that it succesfully was set. for custom async it is not valid as it will return true before set is complete. 
	
	if (isValidPrefVal(aPrefName, aNewVal)) {
		var prefType = gPrefMeta[aPrefName].type;
		switch (prefType) {
			case 'Custom':
				
					gPrefMeta[aPrefName].setter(aNewVal);
				
				break;
			case 'Char':
			case 'Int':
			case 'Bool':
				
					Services.prefs['set' + prefType + 'Pref'](core.addon.prefbranch + aPrefName, aNewVal);
				
				break;
			default:
				console.error('could not set because, invalid type set by devuser in gPrefMeta for aPrefName:', aPrefName);
				throw new Error('could not set because, invalid type set by devuser in gPrefMeta for aPrefName');
		}
		core.addon.prefs[aPrefName] = { // link3838375435343
			value: aNewVal,
			defaultValue: gPrefMeta[aPrefName].defaultValue
		};
		return core.addon.prefs[aPrefName];
	}
}

function isValidPrefVal(aPrefName, aVal) {
	// aVal is something you want to test if it is valid for setting to pref value
	// RETURNS
		// true
		// false
	
	var cValues = gPrefMeta[aPrefName].values;
	if (!cValues) {
		console.error('valid values not set for aPrefName:', aPrefName);
		throw new Error('valid values not set for aPrefName!');
	}
	for (var i=0; i<cValues.length; i++) {
		if (typeof(cValues[i]) == 'function') {
			if (cValues[i](aVal)) {
				return true;
			}
		} else {
			if (aVal == cValues[i]) {
				return true;
			}
		}
	}
	
	return false;
}

function quickSaveDirDefaultValue() {
	try {
		return Services.dirsvc.get('XDGPict', Ci.nsIFile).path; // works on linux
	} catch (ex) {
		try {
			return Services.dirsvc.get('Pict', Ci.nsIFile).path; // works on windows
		} catch (ex) {
			try {
				return Services.dirsvc.get('Pct', Ci.nsIFile).path; // works on mac
			} catch (ex) {
				return OS.Constants.Path.desktopDir;
			}
		}
	}
}

function quickSaveDirValidator(aNewVal) {
	return true; // :todo: for now i just return true
}

function refreshCoreForPrefs() {
	// updates all the values in core.addon.prefs
	// RETURNS
		// promise telling you when complete. resolve value is core.addon.prefs
	var mainDeferred_refreshCoreForPrefs = new Deferred();
	
	var promiseAllArr_getterRequests = [];
	for (var aPrefName in gPrefMeta) {
		var fetchFresh = prefGet(aPrefName);
		if (fetchFresh.constructor.name == 'Promise') {
			promiseAllArr_getterRequests.push(fetchFresh);
		}
	}
	
	if (!promiseAllArr_getterRequests.length) {
		mainDeferred_refreshCoreForPrefs.resolve(core.addon.prefs);
	} else {
		var promiseAll_getterRequests = Promise.all(promiseAllArr_getterRequests);
		promiseAll_getterRequests.then(
			function(aVal) {
				console.log('Fullfilled - promiseAll_getterRequests - ', aVal);
				mainDeferred_refreshCoreForPrefs.resolve(core.addon.prefs);
			},
			genericReject.bind(null, 'promiseAll_getterRequests', mainDeferred_refreshCoreForPrefs)
		).catch(genericCatch.bind(null, 'promiseAll_getterRequests', mainDeferred_refreshCoreForPrefs));
	}
	
	return mainDeferred_refreshCoreForPrefs.promise;
}
// end - pref stuff

// start - beutify stuff

var devtools;
try {
	var { devtools } = Cu.import('resource://devtools/shared/Loader.jsm', {});
} catch(ex) {
	var { devtools } = Cu.import('resource://gre/modules/devtools/Loader.jsm', {});
}
var beautify1 = {};
var beautify2 = {};
devtools.lazyRequireGetter(beautify1, 'beautify', 'devtools/jsbeautify');
devtools.lazyRequireGetter(beautify2, 'beautify', 'devtools/shared/jsbeautify/beautify');

function BEAUTIFY() {
	try {
		beautify1.beautify.js('""');
		return beautify1.beautify;
	} catch (ignore) {}
	try {
		beautify2.beautify.js('""');
		return beautify2.beautify;
	} catch (ignore) {}
}
// end - beutify stuff

function extendCore() {
	// adds some properties i use to core based on the current operating system, it needs a switch, thats why i couldnt put it into the core obj at top
	switch (core.os.name) {
		case 'winnt':
		case 'winmo':
		case 'wince':
			core.os.version = parseFloat(Services.sysinfo.getProperty('version'));
			// http://en.wikipedia.org/wiki/List_of_Microsoft_Windows_versions
			if (core.os.version == 6.0) {
				core.os.version_name = 'vista';
			}
			if (core.os.version >= 6.1) {
				core.os.version_name = '7+';
			}
			if (core.os.version == 5.1 || core.os.version == 5.2) { // 5.2 is 64bit xp
				core.os.version_name = 'xp';
			}
			break;
			
		case 'darwin':
			var userAgent = myServices.hph.userAgent;

			var version_osx = userAgent.match(/Mac OS X 10\.([\d\.]+)/);

			
			if (!version_osx) {
				throw new Error('Could not identify Mac OS X version.');
			} else {
				var version_osx_str = version_osx[1];
				var ints_split = version_osx[1].split('.');
				if (ints_split.length == 1) {
					core.os.version = parseInt(ints_split[0]);
				} else if (ints_split.length >= 2) {
					core.os.version = ints_split[0] + '.' + ints_split[1];
					if (ints_split.length > 2) {
						core.os.version += ints_split.slice(2).join('');
					}
					core.os.version = parseFloat(core.os.version);
				}
				// this makes it so that 10.10.0 becomes 10.100
				// 10.10.1 => 10.101
				// so can compare numerically, as 10.100 is less then 10.101
				
				//core.os.version = 6.9; // note: debug: temporarily forcing mac to be 10.6 so we can test kqueue
			}
			break;
		default:
			// nothing special
	}
	

}

//start obs stuff
// start - last selection stuff
var gUsedSelections = []; // array of arrays. each child is [subcutout1, subcutout2, ...]
function indexOfSelInG(aSel) {
	// aSel is an array of subcutouts
	// will return the index it is found in gUsedSelections
	// -1 if not found
	
	var l = gUsedSelections.length;
	
	if (!l) {
		return -1;
	} else {
		
		for (var i=l-1; i>=0; i--) {
			var tSel = gUsedSelections[i]; // testSelection
			var l2 = tSel.length;
			if (l2 === aSel.length) {
				var tSelMatches = true;
				for (var j=0; j<l2; j++) {
					var tSubcutout = tSel[j];
					var cSubcutout = aSel[j];
					console.log('comparing', 'tSel:', tSel, 'aSel:', aSel);
					if (tSubcutout.x !== cSubcutout.x || tSubcutout.y !== cSubcutout.y || tSubcutout.w !== cSubcutout.w || tSubcutout.h !== cSubcutout.h) {
						// tSel does not match aSel
						tSelMatches = false;
						break;
					}
				}
				if (tSelMatches) {
					return i;
				}
			}
		}
		
		return -1; // not found
	}
}
// break - last selection stuff

var EditorFuncs = {
	// resume - last selection stuff
	addSelectionToHistory: function(aData) {
		// aData.cutoutsArr is an array of cutouts
		console.log('incoming addSelectionToHistory:', aData);
		var cSel = aData.cutoutsArr;
		var ix = indexOfSelInG(cSel);
		if (ix == -1) {
			gUsedSelections.push(aData.cutoutsArr)
		} else {
			// it was found in history, so lets move this to the most recent selection made
			// most recent selection is the last most element in gUsedSelections array
			gUsedSelections.push(gUsedSelections.splice(ix, 1)[0]);
		}
		console.log('added sel, now gUsedSelections:', gUsedSelections);
	},
	selectPreviousSelection: function(aData) {
		// aData.curSelection is an array of the currently selected cutouts

		if (!gUsedSelections.length) {
			return;
		}
		
		var cSel = aData.cutoutsArr; // cutouts of the current selection
		
		// figure out the selection to make
		var selToMake;
		if (cSel) {
			// check to see if this sel is in the history, and select the one before this one
			var ix = indexOfSelInG(cSel);
			if (ix > 0) {
				selToMake = gUsedSelections[ix - 1];
			} else if (ix == -1) {
				// select the most recent one
				selToMake = gUsedSelections[gUsedSelections.length - 1];
			} // else if 0, then no previous selection obviously
		} else {
			// select the most recent one
			selToMake = gUsedSelections[gUsedSelections.length - 1];
		}

		// send message to make the selection
		if (selToMake) {
			colMon[aData.iMon].E.DOMWindow.postMessage({
				topic: 'makeSelection',
				cutoutsArr: selToMake
			}, '*');
		}
	},
	// end - last selection stuff
	callInBootstrap: function(aData) {
		if (aData.argsArr) {
			BOOTSTRAP[aData.method].apply(null, aData.argsArr)
		} else {
			BOOTSTRAP[aData.method]();
		}
	},
	insertTextFromClipboard: function(aData) {
		if (CLIPBOARD.currentFlavors.indexOf('text') > -1) {
			colMon[aData.iMon].E.DOMWindow.postMessage({
				topic: 'insertTextFromClipboard',
				text: CLIPBOARD.get('text')
			}, '*');
		}
	},
	broadcastToOthers: function(aData) {
		// aData requires the key postMsgObj
		// broadcasts to all other aEditorDOMWindow except for aData.iMon
		
		if (!aData.postMsgObj) {
			console.error('aData missing "postMsgObj" key');
			throw new Error('aData missing "postMsgObj" key');
		}
		for (var i=0; i<colMon.length; i++) {
			if (i != aData.iMon) {
				// if (aData.postMsgObj.topic == 'reactSetState') {
					// // console.log('colMon[i].E.DOMWindow.gBrowser.contentWindow:', colMon[i].E.DOMWindow.document.body.innerHTML);
					// colMon[i].E.DOMWindow[aData.postMsgObj.topic](aData.postMsgObj);
				// } else {
					colMon[i].E.DOMWindow.postMessage(aData.postMsgObj, '*');
				// }
			}
		}
	},
	broadcastToSpecific: function(aData) {
		// aData requires the key postMsgObj and toMon (which is target iMon)
		console.log('incoming broadcastToSpecific, aData:', aData);
		if (!aData.postMsgObj) {
			console.error('aData missing "postMsgObj" key');
			throw new Error('aData missing "postMsgObj" key');
		}
		if (!('toMon' in aData)) { // because toMon is a number
			console.error('aData missing "toMon" key');
			throw new Error('aData missing "toMon" key');
		}
		// no need to parseInt(aData.toMon) because it is already a number due to aData being JSON.parse ed
		colMon[aData.toMon].E.DOMWindow.postMessage(aData.postMsgObj, '*');
	},
	updateEditorState: function(aData) {
		gEditorStateStr = aData.editorstateStr;
		console.log('set gEditorStateStr to:', gEditorStateStr);
		var promise_updateEditorstate = MainWorker.post('updateEditorState', [gEditorStateStr]);
	},
	init: function(aData) {
		// does the platform dependent stuff to make the window be position on the proper monitor and full screened covering all things underneeath
		// also transfer the screenshot data to the window
		
		var iMon = aData.iMon; // iMon is my rename of colMonIndex. so its the i in the collMoninfos object
		
		var aEditorDOMWindow = colMon[iMon].E.DOMWindow;
		
		if (!aEditorDOMWindow || aEditorDOMWindow.closed) {
			throw new Error('wtf how is window not existing, the on load observer notifier of panel.xul just sent notification that it was loaded');
		}

		var aHwndPtrStr = getNativeHandlePtrStr(aEditorDOMWindow);
		colMon[iMon].hwndPtrStr = aHwndPtrStr;

		// if (core.os.name != 'darwin') {
			// aEditorDOMWindow.moveTo(colMon[iMon].x, colMon[iMon].y);
			// aEditorDOMWindow.resizeTo(colMon[iMon].w, colMon[iMon].h);
		// }
		
		aEditorDOMWindow.focus();
		
		// if (core.os.name != 'darwin') {
			// aEditorDOMWindow.fullScreen = true;
		// }
		
		// set window on top:
		var aArrHwndPtr = [aHwndPtrStr];
		var aArrHwndPtrOsParams = {};
		aArrHwndPtrOsParams[aHwndPtrStr] = {
			left: colMon[iMon].x,
			top: colMon[iMon].y,
			right: colMon[iMon].x + colMon[iMon].w,
			bottom: colMon[iMon].y + colMon[iMon].h,
			width: colMon[iMon].w,
			height: colMon[iMon].h
		};
		
		// if (core.os.name != 'darwinAAAA') {
		var promise_setWinAlwaysTop = ScreenshotWorker.post('setWinAlwaysOnTop', [aArrHwndPtr, aArrHwndPtrOsParams]);
		promise_setWinAlwaysTop.then(
			function(aVal) {
				console.log('Fullfilled - promise_setWinAlwaysTop - ', aVal, core.os.name);
				if (core.os.name == 'darwin') {
					initOstypes();
					// link98476884
					OSStuff.NSMainMenuWindowLevel = aVal;
					
					var NSWindowString = getNativeHandlePtrStr(aEditorDOMWindow);							
					var NSWindowPtr = ostypes.TYPE.NSWindow(ctypes.UInt64(NSWindowString));

					var rez_setLevel = ostypes.API('objc_msgSend')(NSWindowPtr, ostypes.HELPER.sel('setLevel:'), ostypes.TYPE.NSInteger(OSStuff.NSMainMenuWindowLevel + 1)); // have to do + 1 otherwise it is ove rmneubar but not over the corner items. if just + 0 then its over menubar, if - 1 then its under menu bar but still over dock. but the interesting thing is, the browse dialog is under all of these  // link847455111
					console.log('rez_setLevel:', rez_setLevel.toString());
					
					var newSize = ostypes.TYPE.NSSize(colMon[iMon].w, colMon[iMon].h);
					var rez_setContentSize = ostypes.API('objc_msgSend')(NSWindowPtr, ostypes.HELPER.sel('setContentSize:'), newSize);
					console.log('rez_setContentSize:', rez_setContentSize.toString());
					
					aEditorDOMWindow.moveTo(colMon[iMon].x, colMon[iMon].y); // must do moveTo after setContentsSize as that sizes from bottom left and moveTo moves from top left. so the sizing will change the top left.
				}
			},
			genericReject.bind(null, 'promise_setWinAlwaysTop', 0)
		).catch(genericCatch.bind(null, 'promise_setWinAlwaysTop', 0));
		
		if (!gFonts) {
				var fontsEnumerator = Cc['@mozilla.org/gfx/fontenumerator;1'].getService(Ci.nsIFontEnumerator);
				gFonts = fontsEnumerator.EnumerateAllFonts({});
		}
		
		colMon[aData.iMon].E.DOMWindow.postMessage({
			from: 'bootstrap',
			topic: 'init',
			screenshotArrBuf: colMon[iMon].screenshotArrBuf,
			core: core,
			fonts: gFonts,
			editorstateStr: gEditorStateStr
		}, '*', [colMon[iMon].screenshotArrBuf]);
		
		// set windowtype attribute
		// colMon[aData.iMon].E.DOMWindow.document.documentElement.setAttribute('windowtype', 'nativeshot:canvas');
		
		// check to see if all monitors inited, if they have been, the fetch all win
		var allWinInited = true;
		var l = colMon.length;
		for (var i=0; i<l; i++) {
			if (!colMon[i].hwndPtrStr) {
				allWinInited = false;
				break;
			}
		}
		if (allWinInited) {
			// var macDesktopDims = [];
			// if (core.os.mname == 'darwin') {
			// 	for (var i=0; i<l; i++) {
			// 		macDesktopDims.push
			// 			allWinInited = false;
			// 			break;
			// 		}
			// 	}
			// }
			var promise_fetchWin = ScreenshotWorker.post('getAllWin', [{
				getPid: true,
				getBounds: true,
				getTitle: true,
				filterVisible: true
			}]);
			promise_fetchWin.then(
				function(aVal) {
					console.log('Fullfilled - promise_fetchWin - ', aVal);
					// Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(JSON.stringify(aVal)); // :debug:
					
					// build hwndPtrStr arr for nativeshot_canvas windows
					var hwndPtrStrArr = [];
					for (var i=0; i<colMon.length; i++) {
						hwndPtrStrArr.push(colMon[i].hwndPtrStr);
					}
					
					// remove nativeshot_canvas windows
					for (var i=0; i<aVal.length; i++) {
						if (aVal[i].title == 'nativeshot_canvas' || hwndPtrStrArr.indexOf(aVal[i].hwndPtrStr) > -1) {
							// need to do the hwndPtrStr check as on windows, sometimes the page isnt loaded yet, so the title of the window isnt there yet
							// aVal.splice(i, 1);
							aVal[i].left = -10000;
							aVal[i].right = -10000;
							aVal[i].width = 0;
							aVal[i].NATIVESHOT_CANVAS = true;
							// i--;
						}
					}
					
					for (var i=0; i<colMon.length; i++) {
						colMon[i].E.DOMWindow.postMessage({
							topic: 'receiveWinArr',
							winArr: aVal
						}, '*');
					}
				},
				genericReject.bind(null, 'promise_fetchWin', 0)
			).catch(genericCatch.bind(null, 'promise_fetchWin', 0));
		}
	}
};

function reRaiseCanvasWins() {
	// goes through colMon and raises them again, useful really only for Linux
	
	var aArrHwndPtr = [];
	var aArrHwndPtrOsParams = {};
	
	var l = colMon.length;
	for (var i=0; i<l; i++) {
		var hwndPtrStr = colMon[i].hwndPtrStr;
		aArrHwndPtr.push(hwndPtrStr);
		// aArrHwndPtrOsParams[hwndPtrStr] = {
			// left: colMon[i].x,
			// top: colMon[i].y,
			// right: colMon[i].x + colMon[i].w,
			// bottom: colMon[i].y + colMon[i].h,
			// width: colMon[i].w,
			// height: colMon[i].h
		// };
	}

	// var promise_reTop = ScreenshotWorker.post('setWinAlwaysOnTop', [aArrHwndPtr, aArrHwndPtrOsParams]);
	var promise_reTop = ScreenshotWorker.post('gtkRaiseWindow', [aArrHwndPtr]);
	promise_reTop.then(
		function(aVal) {
			console.log('Fullfilled - promise_reTop - ', aVal);			
		},
		genericReject.bind(null, 'promise_reTop', 0)
	).catch(genericCatch.bind(null, 'promise_reTop', 0));
	
}

function nscomm(aEvent) {
	// console.log('incoming nscomm, aEvent.detail:', aEvent.detail);

	// aEvent.detail must be in format:
	/*
		{
			topic: 'func to call in bootstrap',
			iMon: 'the iMon of the calling editor window',
			// whatever else
		}
	*/

	var aData = aEvent.detail;
	
	var requiredKeys = ['topic', 'iMon'];
	for (var i=0; i<requiredKeys.length; i++) {
		if (!(requiredKeys[i] in aData)) {
			console.error('missing required keys in nativeshot-editor-request aData arg, aData:', aData);
			throw new Error('missing required keys in nativeshot-editor-request aData arg');
		}
	}
	
	if (!(aData.topic in EditorFuncs)) {
		console.error('aData.topic of "' + aData.topic + '" is not in EditorFuncs');
		throw new Error('aData.topic of "' + aData.topic + '" is not in EditorFuncs');
	}
	EditorFuncs[aData.topic](aData);
}
//end obs stuff
// start - about module
var aboutFactory_instance;
function AboutPage() {}

function initAndRegisterAbout() {
	// init it
	AboutPage.prototype = Object.freeze({
		classDescription: justFormatStringFromName(core.addon.l10n.bootstrap.about_page_desc),
		contractID: '@mozilla.org/network/protocol/about;1?what=nativeshot',
		classID: Components.ID('{2079bd20-3369-11e5-a2cb-0800200c9a66}'),
		QueryInterface: XPCOMUtils.generateQI([Ci.nsIAboutModule]),

		getURIFlags: function(aURI) {
			return Ci.nsIAboutModule.ALLOW_SCRIPT;
		},

		newChannel: function(aURI, aSecurity_or_aLoadInfo) {
			var redirUrl;
			if (aURI.path.toLowerCase().indexOf('?options') > -1) {
				redirUrl = core.addon.path.content + 'app/options.xhtml';
			} else if (aURI.path.toLowerCase().indexOf('?text') > -1) {
				redirUrl = core.addon.path.content + 'app/ocr.xhtml' + aURI.path.substr(aURI.path.indexOf('?text'));
			} else {
				redirUrl = core.addon.path.content + 'app/main.xhtml';
			}
			
			var channel;
			if (Services.vc.compare(core.firefox.version, '47.*') > 0) {
				var redirURI = Services.io.newURI(redirUrl, null, null);
				channel = Services.io.newChannelFromURIWithLoadInfo(redirURI, aSecurity_or_aLoadInfo);
			} else {
				channel = Services.io.newChannel(redirUrl, null, null);
			}
			channel.originalURI = aURI;
			
			return channel;
		}
	});
	
	// register it
	aboutFactory_instance = new AboutFactory(AboutPage);
	
	console.log('aboutFactory_instance:', aboutFactory_instance);
}

function AboutFactory(component) {
	this.createInstance = function(outer, iid) {
		if (outer) {
			throw Cr.NS_ERROR_NO_AGGREGATION;
		}
		return new component();
	};
	this.register = function() {
		Cm.registerFactory(component.prototype.classID, component.prototype.classDescription, component.prototype.contractID, this);
	};
	this.unregister = function() {
		Cm.unregisterFactory(component.prototype.classID, this);
	}
	Object.freeze(this);
	this.register();
}
// end - about module

// START - Addon Functionalities					
// global editor values
var colMon; // rename of collMonInfos
/* holds
{
	x: origin x
	y: origin y
	w: width mon
	h: height mon
	screenshotArrBuf: ImageData of monitor screenshot
	E: { editor props
		DOMWindow: xul dom window
	}
}
*/

// start - canvas functions to act across all canvases

var gPostPrintRemovalFunc;

var userAckPending = [ // object holding on to data till user is notified of the tabs, images have succesfully been dropped into tabs, and user ancknolwedges by makeing focus to tabs (as i may need to hold onto the data, if user is not signed in, or if user want to use another account [actually i dont think ill bother with other account thing, just signed in])
// {gEditorSessionId:,tab:,fs:,imgDatas:{dataURL,uploadedURL,attachedToTweet,sentToFS}} // array of objects, weak reference to tab, framescript, the 4 (because thats max allowed by twitter per tweet) data uri of imgs for that tab, and then after upload it holds the image urls for copy to clipboard
];

const fsComServer = {
	serverId: Math.random(),
	// start - twitter framescript specific
	twitterListenerRegistered: false,
	twitterClientMessageListener: {
		// listens to messages sent from clients (child framescripts) to me/server
		// also from old server, to listen when to trigger updated register
		receiveMessage: function(aMsg) {

			if ((aMsg.json.subServer == 'twitter') && (!('serverId' in aMsg.json) || aMsg.json.serverId == fsComServer.serverId)) {
				switch (aMsg.json.aTopic) {
					/* // i dont need this because the sendMessage is sync event though sendAsync, so if i do load and do sendAsync message it will get that message
					case 'clientRequest_clientBorn':
							
							
							
						break;
					*/
					case 'clientNotify_twitterNotSignedIn':
							
							var refUAPEntry = getUAPEntry_byUserAckId(aMsg.json.userAckId);
							for (var imgId in refUAPEntry.imgDatas) {
								refUAPEntry.imgDatas[imgId].attachedToTweet = false;
							}
							// set button to reopen tweet with attachments, which should just do fsComServer.twitter_IfFSReadyToAttach_sendNextUnattached()
							
							// NBs_updateGlobal_updateTwitterBtn(refUAPEntry, 'Not Signed In - Focus this tab and sign in, or sign into Twitter in another tab then reload this tab', 'nativeshot-twitter-bad', 'focus-tab'); // :todo: framescript should open the login box, and on succesfull login it should notify all other tabs that were waiting for login, that login happend and they should reload. but if user logs into a non watched twitter tab, then i wont get that automated message
							NBs_updateGlobal_updateTwitterBtn(refUAPEntry, justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-btn-imgs-awaiting-but-not-signed-in']) + ' (' + Object.keys(refUAPEntry.imgDatas).length + ')', 'nativeshot-twitter-bad', 'focus-tab'); // :todo: framescript should open the login box, and on succesfull login it should notify all other tabs that were waiting for login, that login happend and they should reload. but if user logs into a non watched twitter tab, then i wont get that automated message
							
							
						break;
					case 'clientNotify_tweetClosedWithoutSubmit':
							
							var refUAPEntry = getUAPEntry_byUserAckId(aMsg.json.userAckId);
							for (var imgId in refUAPEntry.imgDatas) {
								refUAPEntry.imgDatas[imgId].attachedToTweet = false;
							}
							// set button to reopen tweet with attachments, which should just do fsComServer.twitter_IfFSReadyToAttach_sendNextUnattached()
							
							// NBs_updateGlobal_updateTwitterBtn(refUAPEntry, 'Tweet Dialog Closed - Twitter auto detached imgs - Click to reopen/reattach', 'nativeshot-twitter-bad', 'reopen-tweet-modal')
							NBs_updateGlobal_updateTwitterBtn(refUAPEntry, justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-btn-imgs-awaiting-but-dialog-closed']) + ' (' + Object.keys(refUAPEntry.imgDatas).length + ')', 'nativeshot-twitter-bad', 'reopen-tweet-modal');
							
						break;
					case 'clientNotify_signedInShowAwaitingMsg':
							
							var refUAPEntry = getUAPEntry_byUserAckId(aMsg.json.userAckId);
							NBs_updateGlobal_updateTwitterBtn(refUAPEntry, justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-btn-imgs-awaiting-user-tweet']) + ' (' + Object.keys(refUAPEntry.imgDatas).length + ')', 'nativeshot-twitter-neutral', 'focus-tab');
							
						break;
					case 'clientNotify_imgDeleted':
							
							// :todo: not yet set up as of sept 19 2015
							// when user clicks the x button from the tweet dialog
							var refUAPEntry = getUAPEntry_byUserAckId(aMsg.json.userAckId);
							delete refUAPEntry.imgDatas[aMsg.json.imgId];
							
						break;
					case 'clientNotify_clientUnregistered':
					

							var refUAPEntry = getUAPEntry_byUserAckId(aMsg.json.userAckId);
							switch (aMsg.json.unregReason) {
								case 'error-loading':
								case 'non-twitter-load':
								case 'tab-closed':
								case 'twitter-page-unloaded':
								
										// note that none of the images were attached
										for (var imgId in refUAPEntry.imgDatas) {
											refUAPEntry.imgDatas[imgId].attachedToTweet = false;
										}
										
										switch (aMsg.json.unregReason) {
											case 'error-loading':
													
													// aMsg = 'Error loading Twitter - You may be offline - Click to open new tab and try again';
													aMsg = justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-btn-imgs-awaiting-but-error-loading']);
													
												break;
											case 'non-twitter-load':
											case 'twitter-page-unloaded':
													
													// aMsg = 'Navigated away from Twitter.com - Click to open new tab with Twitter';
													aMsg = justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-btn-imgs-awaiting-but-twitter-unloaded']);
													
												break;
											case 'tab-closed':
													
													// aMsg = 'Tab Closed - Click to reopen';
													aMsg = justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-btn-imgs-awaiting-but-tab-closed']);
													
												break;
											default:
												throw new Error('unrecongized uregReason in sub block - should never get here');
										}
										
										NBs_updateGlobal_updateTwitterBtn(refUAPEntry, aMsg + ' (' + Object.keys(refUAPEntry.imgDatas).length + ')', 'nativeshot-twitter-bad', 'open-new-tab');

										
									break;
								case 'tweet-success':
										
										refUAPEntry.tweeted = true;
										
										// set urls to userAckId so can offer clipboard										
										var other_info = aMsg.json.clips.other_info;
										delete aMsg.json.clips.other_info;
										
										refUAPEntry.tweetURL = TWITTER_URL + other_info.permlink.substr(1); // because permlink is preceded by slash
										

										
										for (var imgId in refUAPEntry.imgDatas) {
											delete refUAPEntry.imgDatas[imgId].dataURL;
											refUAPEntry.imgDatas[imgId].uploadedURL = aMsg.json.clips[imgId];
										}
										
										var crossWinId = refUAPEntry.gEditorSessionId + '-twitter';
										var aBtnInfos = NBs.crossWin[crossWinId].btns;
										var aBtnInfo;
										var cntBtnsTweeted = 0;
										for (var i=0; i<aBtnInfos.length; i++) {
											if (aBtnInfos[i].btn_id == refUAPEntry.userAckId) {
												aBtnInfo = aBtnInfos[i];
												cntBtnsTweeted++;
											} else {
												if (aBtnInfos[i].tweeted) {
													cntBtnsTweeted++;
												}
											}
										}
										if (cntBtnsTweeted == aBtnInfos.length) {
											// NBs.crossWin[crossWinId].msg = 'All images were succesfully tweeted!'; //:l10n:
											NBs.crossWin[crossWinId].msg = justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-msg-imgs-tweeted']);
										}
										
										if (!aBtnInfo) {

											throw new Error('this should never happen');
										}
										
										// no need to delete aBtnInfo.actionOnBtn as its not type menu so it wont have any affect
										aBtnInfo.tweeted = true;
										// aBtnInfo.label = 'Successfully Tweeted - Image URLs Copied';
										aBtnInfo.label = justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-btn-imgs-tweeted']) + ' (' + Object.keys(refUAPEntry.imgDatas).length + ')';
										aBtnInfo.class = 'nativeshot-twitter-good';
										aBtnInfo.type = 'menu';
										aBtnInfo.popup = ['xul:menupopup', {},
															// ['xul:menuitem', {label:'Tweet URL', oncommand:copyTextToClip.bind(null, refUAPEntry.tweetURL, null) }] // :l10n:
															['xul:menuitem', {label:justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-menu-copy-tweet-link']), oncommand:copyTextToClip.bind(null, refUAPEntry.tweetURL, null) }]
														 ];

										var arrOfImgUrls = [];
										for (var imgId in refUAPEntry.imgDatas) {
											arrOfImgUrls.push(aMsg.json.clips[imgId]);
											// aBtnInfo.popup.push(['xul:menuitem', {label:'Image ' + arrOfImgUrls.length + ' URL', oncommand:copyTextToClip.bind(null, aMsg.json.clips[imgId], null)}]); // :l10n:
											aBtnInfo.popup.push(['xul:menuitem', {label:justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-menu-copy-single-image-link'], [arrOfImgUrls.length]), oncommand:copyTextToClip.bind(null, aMsg.json.clips[imgId] + TWITTER_IMG_SUFFIX, null)}]);
										}
										
										if (arrOfImgUrls.length > 1) {
											// aBtnInfo.popup.push(['xul:menuitem', {label:'All ' + arrOfImgUrls.length + ' Image URLs', oncommand:copyTextToClip.bind(null, arrOfImgUrls.join('\n'), null)}]); // :l10n:
											aBtnInfo.popup.push(['xul:menuitem', {label:justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-menu-copy-all-image-links'], [arrOfImgUrls.length]), oncommand:copyTextToClip.bind(null, arrOfImgUrls.join(TWITTER_IMG_SUFFIX + '\n') + TWITTER_IMG_SUFFIX, null)}]);
										}
										
										// copy all img urls to clipboard:
										copyTextToClip(arrOfImgUrls.join(TWITTER_IMG_SUFFIX + '\n') + TWITTER_IMG_SUFFIX);
										
										// get those uploaded urls
										// add in update to log file
										for (var i=0; i<arrOfImgUrls.length; i++) {
											addEntryToLog('twitter', {
												u: other_info.user_id,
												s: other_info.screen_name,
												p: other_info.permlink,
												l: arrOfImgUrls[i]
											});
										}
										
										NBs.updateGlobal(crossWinId, {
											lbl:1, // in case it was updated
											btns:{
												label: [refUAPEntry.userAckId],
												class: [refUAPEntry.userAckId],
												popup: [refUAPEntry.userAckId],
												type: [refUAPEntry.userAckId]
											}
										});
										
									break;
								case 'server-command':
								default:
									// nothing special
							}
							
							/*
							// check if the currently unregistering fs was succesfully tweeted and update notif bar accordingly
							if (aMsg.json.gTweeted) {
								// was successfully tweeted, so set this refUAPEntry to completed AND framescript: inactive
								refUAPEntry.tweeted = true;
								refUAPEntry.actionOnBtn = 'show-clips-popup';
								// :todo: make notif-bar green
							} else {
								// set refUAPEntry to failed tweet (either tab closed, twitter page navigated away from, ), and make its notif button, on click to open a new tab and reattach
								// refUAPEntry.tweeted = false; // it should already be false, no need to set it
								// :todo: make notif-bar red
								refUAPEntry.actionOnBtn = 'open-tab';
							}
							*/
							
							// check if any other twitter fs are active (meaning a succesful tweet is pending), if none found remove the twitterClientMessageListener
							var refUAP = userAckPending;
							var untweetedUAPFound = false;

							for (var i=0; i<refUAP.length; i++) {
								// :todo: apparently i found here somethign that had no refUAP.uaGroup, investigate why this was - i was just getting back to nativeshot after doing other work so i dont recall at this time what all intricacies
								if (refUAP[i].uaGroup && refUAP[i].uaGroup == 'twitter' && !refUAP[i].tweeted) {
									untweetedUAPFound = true;
									break;
								}
							}
							if (!untweetedUAPFound) {
								fsComServer.twitterListenerRegistered = false;
								myServices.mm.removeMessageListener(core.addon.id + '_twitter', fsComServer.twitterClientMessageListener);

							}
							
						break;
					case 'clientNotify_FSReadyToAttach':
							
							// notification that the FS with this UAP is ready to accept another image
							var refUAPEntry = getUAPEntry_byUserAckId(aMsg.json.userAckId);
							
							// check if something was attached by this notification, and mark it so
							if ('justAttachedImgId' in aMsg.json) {
								refUAPEntry.imgDatas[aMsg.json.justAttachedImgId].attachedToTweet = true;
							}
							
							refUAPEntry.FSReadyToAttach = true; // short for frameScript_isReadyToAttachAnother, basically ready to accept another send

							
							fsComServer.twitter_IfFSReadyToAttach_sendNextUnattached(aMsg.json.userAckId);
							
						break;
					case 'clientResponse_imgAttached':
							
							
							
						break;
					case 'clientRequest_clientShutdownComplete':
							
							
							
						break;
					// start - devuser edit - add your personal message topics to listen to from clients
						
					// end - devuser edit - add your personal message topics to listen to from clients
					default:

				}
			} // else {

			//}
		}
	},
	twitterInitFS: function(userAckId) {
		var refUAPEntry = getUAPEntry_byUserAckId(userAckId);
		refUAPEntry.tab.get().linkedBrowser.messageManager.sendAsyncMessage(core.addon.id + '_twitter', {aTopic:'serverCommand_clientInit', serverId:fsComServer.serverId, userAckId:userAckId, core:core})
	},
	twitterSendDataToAttach: function(userAckId) {
		var refUAPEntry = getUAPEntry_byUserAckId(userAckId);
	},
	twitter_focusContentWindow: function(userAckId) {
		var refUAPEntry = getUAPEntry_byUserAckId(userAckId);
		refUAPEntry.tab.get().linkedBrowser.messageManager.sendAsyncMessage(core.addon.id + '_twitter', {
			aTopic: 'serverCommand_focusContentWindow',
			serverId: fsComServer.serverId,
			userAckId: refUAPEntry.userAckId
		});
	},
	twitter_IfFSReadyToAttach_sendNextUnattached: function(userAckId) {
		// returns true, if something was found unattached and sent, returns false if nothing found unnatached or FS wasnt ready
		var refUAPEntry = getUAPEntry_byUserAckId(userAckId);

		if (refUAPEntry.FSReadyToAttach) {

			// its available to attach, so send it
			// check if any imgs are waiting to be attached
			for (var imgId in refUAPEntry.imgDatas) {

				if (!refUAPEntry.imgDatas[imgId].attachedToTweet) {
					// send command to client to attached
					refUAPEntry.FSReadyToAttach = false;

					refUAPEntry.tab.get().linkedBrowser.messageManager.sendAsyncMessage(core.addon.id + '_twitter', {
						aTopic: 'serverCommand_attachImgToTweet',
						serverId: fsComServer.serverId,
						imgId: imgId,
						dataURL: refUAPEntry.imgDatas[imgId].dataURL,
						userAckId: refUAPEntry.userAckId
					});
					return true;
				}
			}

			// NBs_updateGlobal_updateTwitterBtn(refUAPEntry, 'Tweet dialog opened and images attached - awaiting user input', 'nativeshot-twitter-neutral', 'focus-tab'); // i can show this, but i am not showing "'Waiting to for progrmattic attach'" so not for right now, but i guess would be nice maybe, but maybe too much info
			NBs_updateGlobal_updateTwitterBtn(refUAPEntry, justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-btn-imgs-awaiting-user-tweet']) + ' (' + Object.keys(refUAPEntry.imgDatas).length + ')', 'nativeshot-twitter-neutral', 'focus-tab'); // this is good, because if was found not signed in, then on signed in load it opens up and is waiting for attach, but needs user focus
		} else {

			// not yet availble to attach so do nothing. because when fs is ready to attach it will send me a clientNotify_readyToAttach, and i run this function of twitter_IfFSReadyToAttach_sendNextUnattached there
			return false;
		}
	}
	// end - twitter framescript specific
}

function getUAPEntry_byUserAckId(userAckId) {
	// THROWS if not found
	var refUAP = userAckPending;
	var refUAPEntry;
	for (var i=0; i<refUAP.length; i++) {
		if (refUAP[i].userAckId == userAckId) {
			return refUAP[i];
		}
	}

	throw new Error('could not find aUAPEntry with userAckId - should not happen i think');
}
/* // used only in one place so removed this
function getUAPEntry_byGEditorSessionId(gEditorSessionId, throwOnNotFound) {
	// does NOT throw if not found
	var refUAP = userAckPending;
	var refUAPEntry;
	for (var i=0; i<refUAP.length; i++) {
		if (refUAP[i].gEditorSessionId == gEditorSessionId) {
			return refUAP[i];
		}
	}
	if (throwOnNotFound) {

		throw new Error('could not find aUAPEntry with userAckId - should not happen i think');
	}
}
*/

//// start - button interaction with gEditor system AB system FHR system and OAuth system
// all data must be stored in the gEditorABData_* objects link947444544
var gEditorABData_Bar = {
	//	gEditor.sessionId: {
			// link8888776 - see this link for details on the keys
		// }
};
var gEditorABData_Btn = {
	//	some_generated_id: {
			// see link11114 for more info on keys
		// }
};
var gEditorABData_BtnId = 0;

function gEditorABData_setBtnState(aNewState) { // is binded to gEditorABData_Btn[gEditorABData_BtnId]
	// returns nothing
	// aNewState - keys are same as what goes in BtnRef

	for (var p in aNewState) {
		this.BtnRef[p] = aNewState[p];
	}
	
	// go through and find any bClick and replace it with the callback
	replaceClickNameWithClickCallback(this.BtnRef, this);
	
	// go through the menu items to see if any of them have a cClick
	if (this.BtnRef.bMenu) {
		iterMenuForNameToCbs(this.BtnRef.bMenu, this);
	}
	
	if (gEditorABData_Bar[this.sessionId].shown) {
		AB.setState(gEditorABData_Bar[this.sessionId].ABRef);
	}
	else { console.error('bar not yet shown') }
	
	// return gEditorABData_Btn[gEditorABData_BtnId];
}

function iterMenuForNameToCbs(jMenu, a_gEditorABData_BtnENTRY) {
	jMenu.forEach(function(jEntry, jIndex, jArr) {
		replaceClickNameWithClickCallback(jEntry, a_gEditorABData_BtnENTRY);
		if (jEntry.cMenu) {
			iterMenuForNameToCbs(jEntry.cMenu);
		}
	});
}

function replaceClickNameWithClickCallback(aObjEntryForRep, a_gEditorABData_BtnENTRY) {
	if (!aObjEntryForRep.bClick && !aObjEntryForRep.cClick) {
		return; // this has no click name
	}
	var keyClick = aObjEntryForRep.bClick ? 'bClick' : 'cClick';
	// if i ever change bClick or cClick to a func, it gets taken out, so i dont have to check if it changed or its type is string, because its type for sure is string, but i just do it to show my future self
	if (typeof(aObjEntryForRep[keyClick]) != 'string') {
		console.error('this should never ever happen, typeof is:', typeof(aObjEntryForRep[keyClick]));
		return;
	}
	
	var keyClickName = aObjEntryForRep[keyClick];
	var gEditorABData_BtnENTRY = this;
	aObjEntryForRep[keyClick] = function(sentByABAPI_doClose, sentByABAPI_browser) { gEditorABClickCallbacks_Btn[keyClickName].bind(this, a_gEditorABData_BtnENTRY, sentByABAPI_doClose, sentByABAPI_browser)() };
}

function gEditorABData_addBtn() { // is binded to gEditorABData_Bar[this.sessionId]
	// returns gEditorABData_Btn object for the added btn
	
	var cSessionId = this.sessionId;
	gEditorABData_BtnId++;
	gEditorABData_Btn[gEditorABData_BtnId] = { // link11114
		BtnRef: {}, // this is the react object for each btn, that is reference to what is within the react object of owning bar in gEditorABData_Bar
		// ABRef: this.ABRef, // so I can go AB.setState(.ABRef)
		sessionId: cSessionId, // so I can go AB.setState(gEditorABData_Bar[.sessionId]) - as having ABRef is causing a "TypeError: cyclic object value"
		btnId: gEditorABData_BtnId, // because of link888778 - so i can tell worker do work on this guy. and when worker needs, he can say to update this guy, and when worker needs, worker can fetch data from this guy
		// setBtnState: gEditorABData_setBtnState.bind(gEditorABData_Btn[gEditorABData_BtnId]), // obvious why this is needed // :todo: :learn: :verify: gEditorABData_Btn[gEditorABData_BtnId] isnt created at the time of this bind so lets see if it really binds to it not sure
		data: {}, // link947444544
		meta: {}, // holds meta data, like group of dropbox/twitter/gdrive/imgur etc. and other info to help work with this button
		getBtnFHR: gEditorABData_getBtnFhr.bind(null, gEditorABData_BtnId)
	};
	this.ABRef.aBtns.push(gEditorABData_Btn[gEditorABData_BtnId].BtnRef);
	this.btnIds.push(gEditorABData_BtnId);
	gEditorABData_Btn[gEditorABData_BtnId].setBtnState = gEditorABData_setBtnState.bind(gEditorABData_Btn[gEditorABData_BtnId]);
	
	return gEditorABData_Btn[gEditorABData_BtnId];
}

function retryForBtnId(aBtnId, aServiceName) {
	// aServiceName is optional, if it is not provided it uses cBtnStore.meta.service
	
	var cBtnStore = gEditorABData_Btn[aBtnId];
	
	aServiceName = aServiceName ? aServiceName : cBtnStore.meta.service;
	if (!aServiceName) {
		// then this means cBtnStore.meta.service is undefined, this is a huge error
		console.error('should never happen deverror - then this means cBtnStore.meta.service is undefined, this is a huge error');
		throw new Error('should never happen')
	}
	
	
	cBtnStore.setBtnState({
		bTxt: 'Waiting...', // :l10n:
		bType: 'button',
		bIcon: core.addon.path.images + aServiceName + '16.png',
		bMenu: undefined
	});

	doServiceForBtnId(cBtnStore.btnId, aServiceName);
}

function gEditorABData_getBtnFhr(aBtnId) {
	// creates fhr for this btn if it doesnt have one. if it has one then it returns that
	// if created, it adds to the unloaders
	var cFHR;
	if (!gEditorABData_Btn[aBtnId].data.fhr) {
		cFHR = new FHR();
		gEditorABData_Btn[aBtnId].data.fhr = cFHR;
		gEditorABData_Bar[gEditorABData_Btn[aBtnId].sessionId].unloaders.push(function() {
			if (cFHR.destroy) { // test this, because it might have already been destroyed
				cFHR.destroy();
			} // else it was already destroyed
		});
	} else {
		cFHR = gEditorABData_Btn[aBtnId].data.fhr;
	}
	return cFHR;
}

var gEditorABClickCallbacks_Btn = { // each callback gets passed a param to its gEditorABData_Btn obj
	copy: function(gEditorABData_BtnENTRY, doClose, aBrowser) {
		// console.log('this:', this, 'gEditorABData_BtnENTRY:', gEditorABData_BtnENTRY, 'doClose:', doClose, 'aBrowser:', aBrowser);
		copyTextToClip(gEditorABData_BtnENTRY.data.copyTxt);
	},
	openInFinder: function(gEditorABData_BtnENTRY, doClose, aBrowser) {
		// console.log('this:', this, 'gEditorABData_BtnENTRY:', gEditorABData_BtnENTRY, 'doClose:', doClose, 'aBrowser:', aBrowser);
		var nsifileOfCopyTxt = new nsIFile(gEditorABData_BtnENTRY.data.copyTxt); // i can do this because for save-quick save-browse copyTxt is platform path
		showFileInOSExplorer(nsifileOfCopyTxt);
	},
	showOcrResults: function(gEditorABData_BtnENTRY, doClose, aBrowser) {
		var newtab = aBrowser.ownerDocument.defaultView.gBrowser.loadOneTab('about:nativeshot?text=' + gEditorABData_BtnENTRY.btnId, {
			inBackground: false,
			relatedToCurrent: false
		});
	},
	retry: function(gEditorABData_BtnENTRY, doClose, aBrowser) {
		// uses menudata if it is present, else it uses meta.action
		retryForBtnId(gEditorABData_BtnENTRY.btnId, (this.menuitem ? this.menuitem.menudata : undefined)); // if menudata is undefined, retryForBtnId uses cBtnStore.meta.action so retries itself
	},
	abort_autoretry_then_retry: function(gEditorABData_BtnENTRY, doClose, aBrowser) {
		// same as retry, but first it aborts
		gEditorABData_BtnENTRY.setBtnState({
			bTxt: 'Aborting...',
			bType: 'button',
			bMenu: undefined
		});
		gEditorABData_BtnENTRY.autoretryAborting = true; // set to true, and while true any updates via updateAttnBar are ignored
		var promise_abortAutoretry = MainWorker.post('abortAutoretryForBtnId', [gEditorABData_BtnENTRY.btnId]); // abort a autoretry in case one was in progress
		promise_abortAutoretry.then(function() {
			
			delete gEditorABData_BtnENTRY.autoretryAborting;
			
			// uses menudata if it is present, else it uses meta.action
			retryForBtnId(gEditorABData_BtnENTRY.btnId, (this.menuitem ? this.menuitem.menudata : undefined)); // if menudata is undefined, retryForBtnId uses cBtnStore.meta.action so retries itself
			
		});
	},
	focus_tab: function(gEditorABData_BtnENTRY, doClose, aBrowser) {
		var tabToFocus = gEditorABData_BtnENTRY.data.tabWk.get();
		tabToFocus.ownerDocument.defaultView.focus(); // focus browser window
		tabToFocus.ownerDocument.defaultView.gBrowser.selectedTab = tabToFocus; // focus tab
	},
	showerror: function(gEditorABData_BtnENTRY, doClose, aBrowser) {
		Services.prompt.alert(aBrowser.ownerDocument.defaultView, 'NativeShot - Error', BEAUTIFY().js(JSON.stringify(gEditorABData_BtnENTRY.data.errordets)));
	},
	pick_acct: function(gEditorABData_BtnENTRY, doClose, aBrowser) {
		// Services.prompt.alert(aBrowser.ownerDocument.defaultView, 'NativeShot - Pick Acct', JSON.stringify(this.menuitem.menudata));
		gEditorABData_BtnENTRY.setBtnState({
			bTxt: 'Waiting...',
			bType: 'button',
			bMenu: undefined
		});
		var promise_pickAcct = MainWorker.post('authorizeAppForBtnId', [gEditorABData_BtnENTRY.btnId, gEditorABData_BtnENTRY.meta.service, 'get_from_store_only_time_this_is_needed_is_for_multi_acct_picker', this.menuitem.menudata.uid]);
		promise_pickAcct.then(
			function(aVal) {
				console.log('Fullfilled - promise_pickAcct - ', aVal)
			},
			genericReject.bind(null, 'promise_pickAcct', 0)
		).catch(genericCatch.bind(null, 'promise_pickAcct', 0));
	},
	open_login: function(gEditorABData_BtnENTRY, doClose, aBrowser) {
		var newtab = aBrowser.ownerDocument.defaultView.gBrowser.loadOneTab(this.btn.buttondata, {
			inBackground: false,
			relatedToCurrent: false
		});
		gEditorABData_BtnENTRY.setBtnState({
			bTxt: 'Click to retry after logging in',
			bType: 'button',
			bClick: 'retry',
			bMenu: undefined,
			buttondata: null
		});
	},
	none: function() {
		// used for removing a callback
	}
};
//// end - button interaction with gEditor system AB system FHR system and OAuth system
var gEditor = {
	gBrowserDOMWindow: null, // used for clipboard context
	sessionId: null,
	printPrevWins: null, // holds array of windows waiting to get focus on close of gEditor
	forceFocus: null, // set to true like when user does twitter as that needs user focus
	cleanUp: function() {
		// reset all globals

		
		colMon = null;

		gEditor.gBrowserDOMWindow = null;
				
		gEditor.sessionId = null;
		
		gEditor.printPrevWins = null;
		gEditor.forceFocus = null;
	},
	shareToTwitter: function(aDataUrl) {
		// opens new tab, loads twitter, and attaches up to 4 images, after 4 imgs it makes a new tab, tabs are then focused, so user can type tweet, tag photos, then click Tweet
		
		// this.compositeSelection();
		
		var refUAP = userAckPending;
		
		//var refUAPEntry = getUAPEntry_byGEditorSessionId(this.sessionId);

		var refUAPEntry;
		for (var i=0; i<refUAP.length; i++) {
			console.log('refUAP[i].gEditorSessionId:', refUAP[i].gEditorSessionId);
			if (refUAP[i].gEditorSessionId == gEditor.sessionId && refUAP[i].imgDatasCount < 4) {
				refUAPEntry = refUAP[i];
			}
		}
		
		var cImgDataUri = aDataUrl;
		
		var crossWinId = gEditor.sessionId + '-twitter'; // note: make every crossWinId start with gEditor.sessionId
		
		if (!refUAPEntry) {
			if (!fsComServer.twitterListenerRegistered) {
				myServices.mm.addMessageListener(core.addon.id + '_twitter', fsComServer.twitterClientMessageListener, true);
				fsComServer.twitterListenerRegistered = true;
			}
			var newtab = gEditor.gBrowserDOMWindow.gBrowser.loadOneTab(TWITTER_URL, {
				inBackground: false,
				relatedToCurrent: false
			});
			newtab.linkedBrowser.messageManager.loadFrameScript(core.addon.path.scripts + 'fs_twitter.js?' + core.addon.cache_key, false);
			refUAPEntry = refUAP[refUAP.push({
				gEditorSessionId: gEditor.sessionId,
				userAckId: Math.random(),
				tab: Cu.getWeakReference(newtab),
				imgDatas: {},
				FSReadyToAttach: false,
				imgDatasCount: 0, // will get ++'ed in very next lines out of this block. reason is so i dont hav eto have a custom ++ if not first push
				uaGroup: 'twitter',
				actionOnBtn: 'focus-tab'
					/*
						focus-tab: default (meaning if invaild actionOnBtn it will do this), it focuses tab of this framescript
						open-new-tab: opens new tab, loads twitter, and starts the attaching process
					*/
			}) - 1];
			
			fsComServer.twitterInitFS(refUAPEntry.userAckId);
			if (crossWinId in NBs.crossWin) {
				NBs.crossWin[crossWinId].btns.push({
					// label: justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-btn-imgs-awaiting-user-tweet'], [1]) + '-ID:' + refUAPEntry.userAckId, // :l10n:
					label: justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-btn-imgs-awaiting-user-tweet']) + ' (' + 1 + ')' + '-ID:' + refUAPEntry.userAckId,
					// label: 'Waiting to for progrmattic attach (1)-ID:' + refUAPEntry.userAckId,
					btn_id: refUAPEntry.userAckId,
					class: 'nativeshot-twitter-neutral',
					accessKey: 'T',
					callback: twitterNotifBtnCB.bind(null, refUAPEntry)
				});
			} else {
				NBs.crossWin[crossWinId] = {
					// msg: 'Images have been prepared for Tweeting. User interaction needed in order to complete:', // :l10n:
					msg: justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-msg-imgs-awaiting-user-action']),
					img: core.addon.path.images + 'twitter16.png',
					p: 6,
					btns: [{
						// label: 'Image Pending Tweet (1)-ID:' + refUAPEntry.userAckId,
						// label: 'Waiting to for progrmattic attach (1)-ID:' + refUAPEntry.userAckId,
						label: justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-btn-imgs-awaiting-user-tweet']) + ' (' + 1 + ')' + '-ID:' + refUAPEntry.userAckId,
						btn_id: refUAPEntry.userAckId,
						class: 'nativeshot-twitter-neutral',
						accessKey: 'T',
						callback: twitterNotifBtnCB.bind(null, refUAPEntry) // :todo: test what the arguments on click of button are
					}]
				};
			}
		} else {
			var btnEntryInCrossWin;
			for (var i=0; i<NBs.crossWin[crossWinId].btns.length; i++) {
				if (NBs.crossWin[crossWinId].btns[i].btn_id == refUAPEntry.userAckId) {
					btnEntryInCrossWin = NBs.crossWin[crossWinId].btns[i];
					break;
				}
			}
			// btnEntryInCrossWin.label = 'Images Pending Tweet (' + (refUAPEntry.imgDatasCount + 1) + ')-ID:' + refUAPEntry.userAckId;  // :l10n:
			if (btnEntryInCrossWin.label.indexOf(justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-btn-imgs-awaiting-user-tweet'])) == 0) { // cuz page loads in bg before notif is shown, so if user is doing multi stuff, the btn may have been updated to "not signed in" error msg or something
				btnEntryInCrossWin.label = justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-btn-imgs-awaiting-user-tweet']) + ' (' + (refUAPEntry.imgDatasCount + 1) + ')' + '-ID:' + refUAPEntry.userAckId;
			}
		}
		
		// twitter allows maximum 4 attachment, so if 
		
		refUAPEntry.imgDatas[refUAPEntry.imgDatasCount] = {
			dataURL: cImgDataUri,
			attachedToTweet: false,
			uploadedURL: null
		};
		refUAPEntry.imgDatasCount++;
		// refUAPEntry.imgDataUris.push(cImgDataUri);
		
		fsComServer.twitter_IfFSReadyToAttach_sendNextUnattached(refUAPEntry.userAckId);
		
		gEditor.forceFocus = true; // as user needs browser focus so they can tweet it
		// this.closeOutEditor(e);
	},
	uploadOauthDataUrl: function(aOAuthService, aDataUrl) {
		// print
		// copy
		
		// this.compositeSelection();
		
		var cDOMWindow = gEditor.gBrowserDOMWindow;
		var cSessionId = gEditor.sessionId; // sessionId is time of screenshot
		
		var cBtn = createNewBtnStore(cSessionId, aOAuthService);
		
		cBtn.data.dataurl = aDataUrl; // this.canComp.toDataURL('image/png', '');

		// gEditor.closeOutEditor(e); // noit 042616 to restore this as needed
		
		addEntryToLog(aOAuthService);
		
		doServiceForBtnId(cBtn.btnId, aOAuthService);
	},
	uploadOauth: function(aOAuthService, aArrBuf, aWidth, aHeight) {
		// aOAuthService - string
			// dropbox
			// gdrive
			// imgur
			// imguranon
			// etc see link64098756794556
			
		// gEditor.closeOutEditor(e); // noit 042616 i have to bring this back as i need it for twitter // as i cant close out yet as i need this.canComp see line above this one: `(this.canComp.toBlobHD || this.canComp.toBlob).call(this.canComp, function(b) {`
		
		var cDOMWindow = gEditor.gBrowserDOMWindow;
		var cSessionId = gEditor.sessionId; // sessionId is time of screenshot
		
		var storeServiceAs = aOAuthService;
		if (storeServiceAs == 'save-browse-canvas') {
			storeServiceAs = 'save-browse';
		} 
		var cBtn = createNewBtnStore(cSessionId, storeServiceAs);
		
		cBtn.data.arrbuf = aArrBuf; // link947444544
		cBtn.data.width = aWidth;
		cBtn.data.height = aHeight;
				
		doServiceForBtnId(cBtn.btnId, aOAuthService);

	}
};

var uploadOauthDataUrl = gEditor.uploadOauthDataUrl;
var uploadOauth = gEditor.uploadOauth;
var shareToTwitter = gEditor.shareToTwitter;

function createNewBtnStore(aSessionId, aService) {
	var cBtn = gEditorABData_Bar[aSessionId].addBtn();
	cBtn.setBtnState({
		bTxt: 'Waiting...', // :l10n:
		bIcon: core.addon.path.images + aService + '16.png'
	});
	cBtn.meta.service = aService;
	return cBtn;
}

function doServiceForBtnId(aBtnId, aOAuthService) {
	// must have arrbuf or appropriate data in button data store object
		// if not provided, the service is calculated and set in the meta data
	
	var cBtnStore = gEditorABData_Btn[aBtnId];
	
	var cMethodForService;
	// var saveBrowseCanvas;
	// if (aOAuthService == 'save-browse-canvas') {
		// aOAuthService = 'save-browse';
		// saveBrowseCanvas = true;
	// }
	cBtnStore.meta.service = aOAuthService;
	switch (aOAuthService) { // link64098756794556
		case 'dropbox':
		case 'imgur':
		case 'gdrive':
		case 'imguranon':
			
				cMethodForService = 'uploadImgArrBufForBtnId';
			
			break;
		case 'save-quick':
		case 'save-browse':
		case 'save-browse-canvas':
			
				cMethodForService = 'saveToDiskImgArrBufForBtnId';
			
			break;
		case 'tineye':
		case 'google-images':
		// case 'bingimages':
			
				cMethodForService = 'reverseSearchImgArrBufForBtnId';
			
			break;
		case 'copy':
			
				cMethodForService = 'bootstrap_copyForBtnId';
			
			break;
		case 'print':
			
				cMethodForService = 'bootstrap_printForBtnId';
			
			break;
		case 'ocrall':
		case 'tesseract':
		case 'gocr':
		case 'ocrad':
			
				cMethodForService = 'bootstrap_ocrForBtnId';
			
			break;
		default:
			console.error('invalid aOAuthService:', aOAuthService);
			throw new Error('invalid aOAuthService!!');
	}
	cBtnStore.meta.action = cMethodForService;
	
	if (cMethodForService.indexOf('bootstrap_') === 0) {
		BOOTSTRAP[cMethodForService.substr(10)](cBtnStore.btnId);
	} else {
		// var postArr = [cBtnStore.btnId, aOAuthService, cBtnStore.sessionId];
		// if (saveBrowseCanvas) {
			// postArr.push(null);
			// postArr.push(true);
		// }
		var promise_methodForService = MainWorker.post(cMethodForService, [cBtnStore.btnId, aOAuthService, cBtnStore.sessionId]); // link888778
		promise_methodForService.then(
			function(aVal) {
				console.log('Fullfilled - promise_methodForService - ', aVal);
			},
			genericReject.bind(null, 'promise_methodForService', 0)
		).catch(genericCatch.bind(null, 'promise_methodForService', 0));
	}
}

function printForBtnId(aBtnId) {
	var cBtnStore = gEditorABData_Btn[aBtnId];
	if (!prefGet('print_preview')) {
		// print method link678321212
		var win = Services.wm.getMostRecentWindow('navigator:browser'); //Services.appShell.hiddenDOMWindow;
		var doc = win.document;
		var iframe = doc.createElementNS(NS_HTML, 'iframe');
		iframe.addEventListener('load', function() {
			iframe.removeEventListener('load', arguments.callee, true);


			gPostPrintRemovalFunc = function() {
				iframe.parentNode.removeChild(iframe);

				gPostPrintRemovalFunc = null;
			};
			iframe.contentWindow.addEventListener('afterprint', function() {
				// iframe.parentNode.removeChild(iframe);

				//discontinued immediate removal as it messes up/deactivates print to file on ubuntu from my testing
				iframe.setAttribute('src', 'about:blank');
			}, false);
			iframe.contentWindow.print();
		}, true); // if i use false here it doesnt work
		iframe.setAttribute('src', cBtnStore.data.dataurl);
		iframe.setAttribute('style', 'display:none');
		doc.documentElement.appendChild(iframe); // src page wont load until i append to document
	} else {
		
		
		/*
		var aPrintPrevWin;
		// open print preview window on monitor with coords 0,0 wxh 10x10
		// find monitor dimentiosn that has coord 0,0
		var primaryScreenPoint = new Rect(1, 1, 1, 1);
		for (var i=0; i<colMon.length; i++) {
			if (colMon[i].rect.contains(primaryScreenPoint)) {
				aPrintPrevWin = Services.ww.openWindow(null, 'chrome://browser/content/browser.xul', '_blank', 'chrome,width=' + colMon[i].w + ',height=' + colMon[i].h + ',screenX=0,screenY=0', null);
			}
		}
		*/
		// i dont do it that way because i want the available rect so i do this way:
		// var sDims = {x:{},y:{},w:{},h:{}};
		// Cc['@mozilla.org/gfx/screenmanager;1'].getService(Ci.nsIScreenManager).screenForRect(1,1,1,1).GetAvailRect(sDims.x, sDims.y, sDims.w, sDims.h);

		var aPrintPrevWin = Services.ww.openWindow(null, 'chrome://browser/content/browser.xul', '_blank', null, null);
		if (gEditor.printPrevWins) {
			gEditor.printPrevWins.push(aPrintPrevWin);
		} else {
			gEditor.printPrevWins = [aPrintPrevWin];
		}
		aPrintPrevWin.addEventListener('load', function() {
			aPrintPrevWin.removeEventListener('load', arguments.callee, false);
			aPrintPrevWin.focus();
			// old stuff
			var win = aPrintPrevWin;
			var doc = win.document;
			var iframe = doc.createElementNS(NS_XUL, 'browser');
			iframe.addEventListener('load', function() {
				iframe.removeEventListener('load', arguments.callee, true);


				
				var aPPListener = win.PrintPreviewListener;
				var aOrigPPgetSourceBrowser = aPPListener.getSourceBrowser;
				var aOrigPPExit = aPPListener.onExit;
				aPPListener.onExit = function() {
					aOrigPPExit.call(aPPListener);
					iframe.parentNode.removeChild(iframe);
					aPPListener.onExit = aOrigPPExit;
					aPPListener.getSourceBrowser = aOrigPPgetSourceBrowser;
					win.close();
				};
				aPPListener.getSourceBrowser = function() {
					return iframe;
				};
				win.PrintUtils.printPreview(aPPListener);
				
			}, true); // if i use false here it doesnt work
			iframe.setAttribute('type', 'content');
			iframe.setAttribute('src', cBtnStore.data.dataurl);
			iframe.setAttribute('style', 'display:none'); // if dont do display none, then have to give it a height and width enough to show it, otherwise print preview is blank
			doc.documentElement.appendChild(iframe); // src page wont load until i append to document
			// end old stuff
			
			
		}, false);
	}
	
	cBtnStore.setBtnState({
		bTxt: 'Sent to Print - Send Again', // :l10n:
		bType: 'button',
		bClick: 'retry',
		bIcon: core.addon.path.images + 'print16.png'
	});
}

function ocrForBtnId(aBtnId) {
	var cBtnStore = gEditorABData_Btn[aBtnId];
	var data = cBtnStore.data;
	
	// cBtnStore.meta.service valid values
	//	gocr
	//	ocrad
	//	tesseract
	//	ocrall

	cBtnStore.setBtnState({
		bTxt: 'Processing...', // :l10n:
		bType: 'button',
		bClick: null
	});

	var serviceTypeFunc = {
		gocr: function() {
			if (!bootstrap.GOCRWorker) {
				bootstrap.GOCRWorker = new PromiseWorker(core.addon.path.content + 'modules/gocr/GOCRWorker.js');
			}
			var clonedArrBuf = data.arrbuf.slice();
			return GOCRWorker.post('readByteArr', [clonedArrBuf, data.width, data.height], null, [clonedArrBuf]);
		},
		ocrad: function() {
			if (!bootstrap.OCRADWorker) {
				bootstrap.OCRADWorker = new PromiseWorker(core.addon.path.content + 'modules/ocrad/OCRADWorker.js');
			}
			var clonedArrBuf = data.arrbuf.slice();
			return OCRADWorker.post('readByteArr', [clonedArrBuf, data.width, data.height], null, [clonedArrBuf]);
		},
		tesseract: function() {
			if (!bootstrap.TesseractWorker) {
				bootstrap.TesseractWorker = new PromiseWorker(core.addon.path.content + 'modules/tesseract/TesseractWorker.js');
			}
			var clonedArrBuf = data.arrbuf.slice();
			return TesseractWorker.post('readByteArr', [clonedArrBuf, data.width, data.height], null, [clonedArrBuf]);
		}
	};

	var promiseAllArr_ocr = [];
	var allArr_serviceTypeStr = [];
	if (cBtnStore.meta.service == 'ocrall') {
		for (var p in serviceTypeFunc) {
			promiseAllArr_ocr.push(serviceTypeFunc[p]());
			allArr_serviceTypeStr.push(p);
		}
	} else {
		promiseAllArr_ocr.push(serviceTypeFunc[cBtnStore.meta.service]());
		allArr_serviceTypeStr.push(cBtnStore.meta.service);
	}
	
	var promiseAll_ocr = Promise.all(promiseAllArr_ocr);
	promiseAll_ocr.then(
		function(aTxtArr) {
			console.log('Fullfilled - promiseAll_ocr - ', aTxtArr);
			data.result_txt = {};
			for (var i=0; i<aTxtArr.length; i++) {
				data.result_txt[allArr_serviceTypeStr[i]] = aTxtArr[i];
			}
			cBtnStore.setBtnState({
				bTxt: 'Text Processed - Show Results', // :l10n:
				bType: 'button',
				bClick: 'showOcrResults'
			});
			
			if (ifEditorClosed_andBarHasOnlyOneAction_copyToClip(cBtnStore.sessionId)) {
				gEditorABClickCallbacks_Btn.showOcrResults(cBtnStore, null, Services.wm.getMostRecentWindow('navigator:browser').gBrowser.selectedBrowser);
			}
		},
		genericReject.bind(null, 'promiseAll_ocr', 0)
	).catch(genericCatch.bind(null, 'promiseAll_ocr', 0));
	
	if (cBtnStore.meta.service != 'ocrall') {
		// addEntryToLog(cBtnStore.meta.service);
		forBtnIdAndService_addEntryToLog(aBtnId, cBtnStore.meta.service)
	}
}

var _cache_forBtnIdAndService_addEntryToLog = {};
function forBtnIdAndService_addEntryToLog(aBtnId, aServiceName) {
	var id = aBtnId + '-' + aServiceName;
	if (_cache_forBtnIdAndService_addEntryToLog[id]) {
		console.log('will not add to log as it was already addeded');
		return;
	} else {
		_cache_forBtnIdAndService_addEntryToLog[id] = 1;
		addEntryToLog(aServiceName);
	}
}

function copyForBtnId(aBtnId) {
	var cBtnStore = gEditorABData_Btn[aBtnId];
	
	// var data = cBtnStore.data.dataurl;
	CLIPBOARD.set(cBtnStore.data.dataurl, 'image');
	
	/* to consider and test
		// have to first set imageURL = createBlob
	  
	   // Also put the image's html <img> tag on the clipboard.  This is 
	   // important (at least on OSX): if we copy just jpg image data,
	   // programs like Photoshop and Thunderbird seem to receive it as
	   // uncompressed png data, which is very large, bloating emails and
	   // causing randomly truncated data.  But if we also include a
	   // text/html flavor referring to the jpg image on the Internet, 
	   // those programs retrieve the image directly as the original jpg
	   // data, so there is no data bloat.
	  
	  var str = Components.classes['@mozilla.org/supports-string;1'].createInstance(Ci.nsISupportsString);
	  if (str) {
		str.data = '<img src="' + imageURL + '" />';
		trans.addDataFlavor('text/html');
		trans.setTransferData('text/html', str, str.data.length * 2);
	  }    
	*/
	cBtnStore.setBtnState({
		bTxt: 'Image Copied - Copy Again', // :l10n:
		bType: 'button',
		bClick: 'retry',
		bIcon: core.addon.path.images + 'copy16.png'
	});
}

function reverseSearchImgPlatPath(aBtnId, aServiceSearchUrl, aPlatPathToImg, aPostDataObj) {
	var cBtnStore = gEditorABData_Btn[aBtnId];
	
	var ansifileFieldFound = false;
	for (var aPostKey in aPostDataObj) {
		if (aPostDataObj[aPostKey] == '{{ansifile}}') {
			aPostDataObj[aPostKey] = new nsIFile(aPlatPathToImg);
			ansifileFieldFound = true;
			break;
		}
	}
	
	if (!ansifileFieldFound) { console.error('deverror, must have a field in aPostDataObj in where to place the nsi file, this field must be a string when sent from worker and should be {{ansifile}}'); throw new Error('deverror, must have a field in aPostDataObj in where to place the nsi file, this field must be a string when sent from worker and should be {{ansifile}}'); }
	console.log('aPostDataObj:', aPostDataObj);
	
	var tab = Services.wm.getMostRecentWindow('navigator:browser').gBrowser.loadOneTab(aServiceSearchUrl, {
		inBackground: false,
		postData: encodeFormData(aPostDataObj, 'iso8859-1')
	});
	
	cBtnStore.data.tabWk = Cu.getWeakReference(tab);

	var retryMenu = [
		{
			cTxt: 'Retry',
			cClick: 'retry'
		}
	];
	
	if (cBtnStore.meta.service != 'tineye') {
		retryMenu.push({
			cTxt: 'Retry with Tineye',
			cClick: 'retry',
			menudata: 'tineye'
		});
	}
	if (cBtnStore.meta.service != 'google-images') {
		retryMenu.push({
			cTxt: 'Retry with Google Images',
			cClick: 'retry',
			menudata: 'google-images'
		});
	}
	// if (cBtnStore.meta.service != 'bingimages') {
		// retryMenu.push({
			// cTxt: 'Retry with Bing Images',
			// cClick: 'retry',
			// menudata: 'bingimages'
		// });
	// }
	
	MainWorkerMainThreadFuncs.updateAttnBar(aBtnId, {
		bTxt: 'Focus Tab', // :l10n:
		bClick: 'focus_tab',
		bType: 'menu-button',
		bMenu: retryMenu
	});
	
	ifEditorClosed_andBarHasOnlyOneAction_copyToClip(cBtnStore.sessionId);
}

function gEUnload() {
	
	// as nativeshot_canvas windows are now closing. check if should show notification bar - if it has any btns then show it
	if (gEditorABData_Bar[gEditor.sessionId].ABRef.aBtns.length) {
		console.log('need to show notif bar now');
		gEditorABData_Bar[gEditor.sessionId].shown = true; // otherwise setBtnState will not update react states
		AB.setState(gEditorABData_Bar[gEditor.sessionId].ABRef);
		ifEditorClosed_andBarHasOnlyOneAction_copyToClip(gEditor.sessionId);
	} else {
		// no need to show, delete it
		console.log('no need to show, delete it');
		delete gEditorABData_Bar[gEditor.sessionId];
	}
	
	// check if need to show twitter notification bars
	for (var p in NBs.crossWin) {
		if (p.indexOf(gEditor.sessionId) == 0) { // note: this is why i have to start each crossWin id with gEditor.sessionId
			NBs.insertGlobalToWin(p, 'all');
		}
	}
	if (gEditor.wasFirefoxWinFocused || gEditor.forceFocus) {
		gEditor.gBrowserDOMWindow.focus();
	}
	if (gEditor.printPrevWins) {
		for (var i=0; i<gEditor.printPrevWins.length; i++) {
			gEditor.printPrevWins[i].focus();
		}
	}
	// colMon[0].E.DOMWindow.close();
	
	gEditor.cleanUp();
}
// end - canvas functions to act across all canvases


function shootAllMons(aDOMWindow) {
	
	gEditor.gBrowserDOMWindow = aDOMWindow;
	gESelected = false;
	
	var allMonDim = []; // pushed in order of iMon
	
	var openWindowOnEachMon = function() {
		gEditor.sessionId = new Date().getTime(); // in other words, this is time of screenshot of this session
		
		// notification bar stuff
		var cSessionId = gEditor.sessionId;
		gEditorABData_Bar[gEditor.sessionId] = { // link8888776
			ABRef: { // object for the bar used for state - so I can go AB.setState(.ABRef)
				aTxt: (new Date(gEditor.sessionId)).toLocaleString(),
				aPriority: 1,
				aIcon: core.addon.path.images + 'icon16.png',
				aClose: function() {
					var cUnloaders = gEditorABData_Bar[cSessionId].unloaders;
					for (var i=0; i<cUnloaders.length; i++) {
						cUnloaders[i]();
					}
					var thisBtnIds = gEditorABData_Bar[cSessionId].btnIds; // can yse gEditor.sessionId here as it uses live value apparently - bug fix from test result
					for (var i=0; i<thisBtnIds.length; i++) {
						delete gEditorABData_Btn[thisBtnIds[i]];
						MainWorker.post('deleteBtnStore', [thisBtnIds[i]]);
					}
					delete gEditorABData_Bar[cSessionId];
					// :todo: need to ensure that none of th workers are holding onto any data that was stored in gEditorABData_Bar or gEditorABData_Btn
				},
				aBtns: []
			},
			shown: false, // bool. set to true if AB.setState has been called. meaning if notification bar is shown.. also determines if setBtnState should call AB.setState
			btnIds: [], // array of generated ids found in gEditorABData_Btn // array of generated ids found in gEditorABData_Btn
			sessionId: gEditor.sessionId, // so i can group things togather per screenshot
			// addBtn: gEditorABData_addBtn.bind(gEditorABData_Bar[gEditor.sessionId]) // moved to link44444455 because this is not binding as the object hasnt been made yet
			unloaders: []
		};
		gEditorABData_Bar[gEditor.sessionId].addBtn = gEditorABData_addBtn.bind(gEditorABData_Bar[gEditor.sessionId]) // link44444455
		// end notification bar stuff
		
		gEditor.wasFirefoxWinFocused = isFocused(aDOMWindow);

		var allMonDimStr = JSON.stringify(allMonDim);

		
		for (var i=0; i<colMon.length; i++) {
			// var sa = Cc['@mozilla.org/supports-array;1'].createInstance(Ci.nsISupportsArray);
			// var sa_imon = Cc['@mozilla.org/supports-PRUint8;1'].createInstance(Ci.nsISupportsPRUint8);
			// sa.AppendElement(sa_imon);
			// sa_imon.data = i;
			// var aEditorDOMWindow = Services.ww.openWindow(null, core.addon.path.content + 'panel.xul?iMon=' + i, '_blank', 'chrome,alwaysRaised,width=1,height=2,screenX=' + (core.os.name == 'darwin' ? (colMon[i].x + 1) : 1) + ',screenY=' + (core.os.name == 'darwin' ? (colMon[i].y + 1) : 1), sa);
			// var aEditorDOMWindow = Services.ww.openWindow(null, core.addon.path.content + 'resources/pages/editor.xhtml?' + jsonAsQueryString(spliceObj({iMon:i}, colMon[i])), '_blank', 'chrome,alwaysRaised,titlebar=0,width=1,height=2,screenX=' + (core.os.name == 'darwin' ? (colMon[i].x + 1) : 1) + ',screenY=' + (core.os.name == 'darwin' ? (colMon[i].y + 1) : 1), null); // so for ubuntu i recall i had to set to 1x1 otherwise the resizeTo or something wouldnt work // now on osx if i set to 1x1 it opens up full available screen size, so i had to do 1x2 (and no matter what, resizeTo or By is not working on osx, if i try to 200x200 it goes straight to full avail rect, so im using ctypes on osx, i thought it might be i setLevel: first though but i tested it and its not true, it just wont work, that may be why resizeTo/By isnt working) // on mac because i size it first then moveTo, i think i have to move it to that window first, because otherwise it will be constrained to whatever monitor size i sized it on (i did + 1 just because i had issues with 0 0 on ubuntu so im thinking its safer)
			var x = colMon[i].x;
			var y = colMon[i].y;
			var w = colMon[i].w;
			var h = colMon[i].h;
			
			var scaleX = colMon[i].win81ScaleX;
			var scaleY = colMon[i].win81ScaleY;
			// on win10, the x, y, w and h set here needs scaling, its ridiculous. but from ctypes it doesnt need scaling. so i just set the sclaed here, and whatever was off, then its fixed, the ctypes doesnt need scaling. i tested the ctypes with height width minus 1 and it was perfect ah
			// also on windows, if i dont use SetWindowPos from ctypes, the taskbar on secondary mon keeps showing on top when i focus the nativeshot window in primary mon
			if (scaleX) {
				x = Math.floor(x / scaleX);
				w = Math.floor(w / scaleX);
			}
			if (scaleY) {
				y = Math.floor(y / scaleY);
				h = Math.floor(h / scaleY);
			}
			var aEditorDOMWindow = Services.ww.openWindow(null, core.addon.path.content + 'resources/pages/editor.xhtml?' + jsonAsQueryString(spliceObj({iMon:i, allMonDimStr:allMonDimStr}, colMon[i])), '_blank', 'chrome,titlebar=0,width=' + w + ',height=' + h + ',screenX=' + x + ',screenY=' + y, null);
			// var aEditorDOMWindow = Services.ww.openWindow(null, core.addon.path.content + 'resources/pages/editor.xhtml?' + jsonAsQueryString(spliceObj({iMon:i}, colMon[i])), '_blank', 'chrome,alwaysRaised,titlebar=0,width=' + 2 + ',height=' + 2 + ',screenX=' + 2 + ',screenY=' + 2, null);
			// so for ubuntu i recall i had to set to 1x1 otherwise the resizeTo or something wouldnt work // now on osx if i set to 1x1 it opens up full available screen size, so i had to do 1x2 (and no matter what, resizeTo or By is not working on osx, if i try to 200x200 it goes straight to full avail rect, so im using ctypes on osx, i thought it might be i setLevel: first though but i tested it and its not true, it just wont work, that may be why resizeTo/By isnt working) // on mac because i size it first then moveTo, i think i have to move it to that window first, because otherwise it will be constrained to whatever monitor size i sized it on (i did + 1 just because i had issues with 0 0 on ubuntu so im thinking its safer)
			colMon[i].E = {
				DOMWindow: aEditorDOMWindow
				// docEl: aEditorDOMWindow.document.documentElement,
				// doc: aEditorDOMWindow.document,
			};
			aEditorDOMWindow.addEventListener('nscomm', nscomm, false);
		}
	};
	
	var promise_shoot = ScreenshotWorker.post('shootAllMons', []);
	promise_shoot.then(
		function(aVal) {

			// start - do stuff here - promise_shoot
			colMon = aVal;
			
			console.log('colMon from worker:', colMon);
			
			for (var i=0; i<colMon.length; i++) {
				allMonDim.push({
					x: colMon[i].x,
					y: colMon[i].y,
					w: colMon[i].w,
					h: colMon[i].h
					// win81ScaleX: colMon[i].win81ScaleX,
					// win81ScaleY: colMon[i].win81ScaleY
				});
			}
			
			if (gPostPrintRemovalFunc) { // poor choice of clean up for post print, i need to be able to find a place that triggers after print to file, and also after if they dont print to file, if iframe is not there, then print to file doesnt work
				gPostPrintRemovalFunc();
			}
			
			openWindowOnEachMon();
			// end - do stuff here - promise_shoot
		},
		function(aReason) {
			var rejObj = {name:'promise_shoot', aReason:aReason};

			Services.prompt.alert(Services.wm.getMostRecentWindow('navigator:browser'), justFormatStringFromName(core.addon.l10n.bootstrap['addon_name']) + ' - ' + justFormatStringFromName(core.addon.l10n.bootstrap['error-title_screenshot-internal']), justFormatStringFromName(core.addon.l10n.bootstrap['error-body_screenshot-internal']));
		}
	).catch(
		function(aCaught) {
			var rejObj = {name:'promise_shoot', aCaught:aCaught};

			Services.prompt.alert(Services.wm.getMostRecentWindow('navigator:browser'), 'NativeShot - Developer Error', 'Developer did something wrong in the code, see Browser Console.');
		}
	);
}

function twitterNotifBtnCB(aUAPEntry, aElNotification, aObjBtnInfo) {


	switch (aUAPEntry.actionOnBtn) {
		case 'show-clips-popup':
			

			
			break;
		case 'open-new-tab':

				// NBs_updateGlobal_updateTwitterBtn(aUAPEntry, 'Waiting to for progrmattic attach', 'nativeshot-twitter-neutral', 'focus-tab'); // not showing for right now, i think too much info

				NBs_updateGlobal_updateTwitterBtn(aUAPEntry, justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-btn-imgs-awaiting-user-tweet']) + ' (' + Object.keys(aUAPEntry.imgDatas).length + ')', 'nativeshot-twitter-neutral', 'focus-tab');
				if (!fsComServer.twitterListenerRegistered) {
					myServices.mm.addMessageListener(core.addon.id + '_twitter', fsComServer.twitterClientMessageListener, true);
					fsComServer.twitterListenerRegistered = true;
				}
				var newtab = Services.wm.getMostRecentWindow('navigator:browser').gBrowser.loadOneTab(TWITTER_URL, {
					inBackground: false,
					relatedToCurrent: false
				});
				newtab.linkedBrowser.messageManager.loadFrameScript(core.addon.path.scripts + 'fs_twitter.js?' + core.addon.cache_key, false);
				aUAPEntry.tab = Cu.getWeakReference(newtab);
				aUAPEntry.tweeted = false; // synonomous with fsActive = false
				fsComServer.twitterInitFS(aUAPEntry.userAckId);
			
			break;

		case 'reopen-tweet-modal':
			
				// NBs_updateGlobal_updateTwitterBtn(aUAPEntry, 'Waiting to for progrmattic attach', 'nativeshot-twitter-neutral', 'focus-tab'); // not showing for right now, i think too much info

				NBs_updateGlobal_updateTwitterBtn(aUAPEntry, justFormatStringFromName(core.addon.l10n.bootstrap['notif-bar_twitter-btn-imgs-awaiting-user-tweet']) + ' (' + Object.keys(aUAPEntry.imgDatas).length + ')', 'nativeshot-twitter-neutral', 'focus-tab');
				// need to focus for that paste event thingy work around
				var tab = aUAPEntry.tab.get();
				tab.ownerDocument.defaultView.focus(); // focus browser window
				tab.ownerDocument.defaultView.gBrowser.selectedTab = aUAPEntry.tab.get(); // focus tab
				fsComServer.twitter_focusContentWindow(aUAPEntry.userAckId); // focus content window
				fsComServer.twitter_IfFSReadyToAttach_sendNextUnattached(aUAPEntry.userAckId);
			
			break;
		case 'focus-tab':
		default:
			

				var tab = aUAPEntry.tab.get();
				tab.ownerDocument.defaultView.focus(); // focus browser window
				tab.ownerDocument.defaultView.gBrowser.selectedTab = aUAPEntry.tab.get(); // focus tab
	}
	
	throw new Error('throw to preventing close of this notif-bar');
}

var NBs = { // short for "notification bars"
	crossWin: {},  // holds objects of details for nb's that should show across all windows, key should be aGroupId
	/* struct
	{
		msg: String,
		img: String,
		p: Number, // priority
		g-editor-session-id: Number,
		btns: Array
		///// btns Array
		// [{
		// 	label: 'Button-ID:String', // nativeshot custom, append -ID: and whatever string you want, this is how it recognizes button future updates, this is converted to custom attribute on the element //CHANGABLE, RESPECTED BY updateGlobal // after item is appended it doesnt use the '-ID:' anymore so when update it, no need to add in the -ID: link64798787
		// 	accessKey: 'B', //CHANGABLE, RESPECTED BY updateGlobal // should be optional but its a bug i need to file on bugzilla, if dont set, then its undefined and accesskey is set to u as thats first letter of undefined
		// 	popup: null,  //NOT changeable, by updateGlobal yet // ON creation, this must be either string of id of existing popup OR an xul element ready to append, and if it is xul element, then TYPE must set type to menu or menu-button // for update though this should be json array for jsonToDOM OR null if you want it removed  // SOOO for ease, dont ever set this on create, only go for update // see this image for on creation styles: C:\Users\Vayeate\Documents\GitHub\AwesomeBar-Power-Tip\popup is string and type is null, popup is getElementById of xul el and type is menu, popup is getElementById of xul and el is menu-button.png
		//  type: String // optional  //NOT changeable, by updateGlobal yet //menu or menu-button are special, it causes popup to be required to be an XUL element. // for update though, this should be whatever // SOOO for ease, dont ever set this on create, only go for update
		//  anchor: String // optional  //NOT changeable, by updateGlobal yet
		//  isDefault: String // optional, if none of your buttons have this, then button at position 0 is made default
		//  class: 'blah1 blah2 blah3', // nativeshot custom, setAttribute('class')  //CHANGABLE, RESPECTED BY updateGlobal
		//  btn_id: String, // nativeshot custom same string set in label // only has to be unique per notification notifcation, not per deck
		// 	callback: function(blah) {  //NOT changable, updateGlobal doesnt set this yet, ill have to learn how, im sure its possible, as of aug 13 2015
		// 	  _actionTaken = true;

		// 	}
		// ]
		///
	}
	*/
	updateGlobal: function(aGroupId, aHints) {
		// do the changes on the NBs.crossWin[aGroupId] then call this, and it will update to dom. but if you removed some btns, this will remove from the js object, so you dont have to pre do that
		// aHints is an obj is then no need to close and update
			// lbl - any
			// p - any
			// btns - {removed:[btn_ids],label:[btn_ids],class:[btn_ids],type:[btn_ids],popup:[btn_ids]} // not yet supported added:[btn_ids]
		
		var cCrossWin = NBs.crossWin[aGroupId];
		var DOMWindows = Services.wm.getEnumerator('navigator:browser');
		while (DOMWindows.hasMoreElements()) {
			var aDOMWindow = DOMWindows.getNext();
			var btmDeckBox = aDOMWindow.document.getElementById('nativeshotDeck' + aGroupId);
			if (btmDeckBox) {
				var nb = btmDeckBox.getNotificationWithValue(aGroupId);
				if (aHints.lbl) {
					nb.label = cCrossWin.msg;
				}
				if (aHints.p) {
					nb.priority = cCrossWin.p;
					// copied from here, keep updated from here, :https://dxr.mozilla.org/mozilla-central/source/toolkit/content/widgets/notification.xml#151
					if (cCrossWin.p >= btmDeckBox.PRIORITY_CRITICAL_LOW) {
						nb.setAttribute("type", "critical");
					} else if (cCrossWin.p <= btmDeckBox.PRIORITY_INFO_HIGH) {
						nb.setAttribute("type", "info");
					} else {
						nb.setAttribute("type", "warning");
					}
				}
				if (aHints.btns) {
					var allBtnsQ = nb.querySelectorAll('button.notification-button');
					var allBtnsEl = {};
					for (var i=0; i<allBtnsQ.length; i++) {
						var cBtnId = allBtnsQ[i].getAttribute('data-btn-id');
						allBtnsEl[cBtnId] = allBtnsQ[i];
					}
					allBtnsQ = null;

					
					var allBtnsInfo = {};
					for (var i=0; i<cCrossWin.btns.length; i++) {
						var cBtnInfo = cCrossWin.btns[i];
						allBtnsInfo[cBtnInfo.btn_id] = {};
						for (var p in cBtnInfo) {
							allBtnsInfo[cBtnInfo.btn_id][p] = cBtnInfo[p];
						}
					}

					
					if (aHints.btns.removed) {
						for (var i=0; i<aHints.btns.removed.length; i++) {
							allBtnsEl[aHints.btns.removed[i]].parentNode.removeChild(btn);
						}
					}
					if (aHints.btns.label) {
						for (var i=0; i<aHints.btns.label.length; i++) {
							allBtnsEl[aHints.btns.label[i]].label = allBtnsInfo[aHints.btns.label[i]].label;
						}
					}
					if (aHints.btns.akey) {
						for (var i=0; i<aHints.btns.akey.length; i++) {
							allBtnsEl[aHints.btns.akey[i]].setAttribute('accesskey', allBtnsInfo[aHints.btns.akey[i]].accessKey);
						}
					}
					if (aHints.btns.class) {
						for (var i=0; i<aHints.btns.class.length; i++) {
							var cClass = allBtnsEl[aHints.btns.class[i]].getAttribute('class');
							cClass = cClass.substr(0, cClass.indexOf(' custom_classes_divider '));
							allBtnsEl[aHints.btns.class[i]].setAttribute('class', cClass + ' custom_classes_divider ' + allBtnsInfo[aHints.btns.class[i]].class);
						}
					}
					if (aHints.btns.type) {
						for (var i=0; i<aHints.btns.type.length; i++) {
							allBtnsEl[aHints.btns.type[i]].setAttribute('type', allBtnsInfo[aHints.btns.type[i]].type);
						}
					}
					if (aHints.btns.popup) {
						// popup gets removed and recated everytime this hint exists
						for (var i=0; i<aHints.btns.popup.length; i++) {
							if (allBtnsEl[aHints.btns.popup[i]].childNodes[0]) {
								allBtnsEl[aHints.btns.popup[i]].removeChild(allBtnsEl[aHints.btns.popup[i]].childNodes[0]); // its always first childe node im pretty sure as when we add it, and on create they add it, they append to the button
							}
							if (allBtnsInfo[aHints.btns.popup[i]].popup !== null) {
								allBtnsEl[aHints.btns.popup[i]].appendChild(jsonToDOM(allBtnsInfo[aHints.btns.popup[i]].popup, aDOMWindow.document, {})); // its always first childe node im pretty sure as when we add it, and on create they add it, they append to the button
							}
						}
					}
				}
			} else {

			}
		}
	
		// to update, i close the notif and reopen it
	},
	closeGlobal: function(aGroupId) {
		
		delete NBs.crossWin[aGroupId];
		
		var DOMWindows = Services.wm.getEnumerator('navigator:browser');
		while (DOMWindows.hasMoreElements()) {
			var aDOMWindow = DOMWindows.getNext();
			var btmDeckBox = aDOMWindow.document.getElementById('nativeshotDeck' + aGroupId);
			if (btmDeckBox) {
				var n = btmDeckBox.getNotificationWithValue(aGroupId);
				if (n) {
					n.close();
				}
			} else {

			}
		}
	},
	insertGlobalToWin: function(aGroupId, aDOMWindow) {
		// aDOMWindow is a dom window or 'all'
		if (aDOMWindow == 'all') {
			var DOMWindows = Services.wm.getEnumerator('navigator:browser');
			while (DOMWindows.hasMoreElements()) {
				aDOMWindow = DOMWindows.getNext();
				if (aDOMWindow.gBrowser) {
					NBs.insertGlobalToWin.bind(null, aGroupId, aDOMWindow)();
				}
			}
			return;
		};
		var aDOMDocument = aDOMWindow.document;
		
		var cCrossWin = NBs.crossWin[aGroupId];	
		
		var deck = aDOMDocument.getElementById('content-deck');
		var btmDeckBox = aDOMDocument.getElementById('nativeshotDeck' + aGroupId);

		if (!btmDeckBox) {

		  btmDeckBox = aDOMDocument.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'notificationbox');
		  btmDeckBox.setAttribute('id', 'nativeshotDeck' + aGroupId);
		  // deck.parentNode.insertBefore(btmDeckBox, deck); // for top
		  deck.parentNode.appendChild(btmDeckBox); // for bottom
		} else {

		}

		var nb = btmDeckBox; //win.gBrowser.getNotificationBox(); //use _gNB for window level notification. use `win.gBrowser.getNotificationBox()` for tab level
		var n = btmDeckBox.getNotificationWithValue(aGroupId);


		if (n) {

		} else {
			
			var cNB;
			var notifCallback = function(what) {

				if (what == 'removed') {
					// btmDeckBox.removeNotification(cNB, false); // close just hides it, so we do removeNotification to remove it. otherwise if same groupid, nativeshot will find it already exists and then not create another one
					aDOMWindow.setTimeout(function() {
						btmDeckBox.parentNode.removeChild(btmDeckBox);
					}, 1000);
					if (aGroupId in NBs.crossWin) {
						NBs.closeGlobal(aGroupId);
					} else {

					}
				}
			}
			
			// https://dxr.mozilla.org/mozilla-central/source/toolkit/content/widgets/notification.xml#79
			cNB = nb.appendNotification(
				cCrossWin.msg,
				aGroupId,
				cCrossWin.img,
				cCrossWin.p,
				cCrossWin.btns,
				notifCallback
			);
			var btns = cNB.querySelectorAll('button.notification-button');
			for (var i=0; i<btns.length; i++) {
				var label_with_id = btns[i].getAttribute('label');
				var id_index = label_with_id.lastIndexOf('-ID:');
				var btn_id = label_with_id.substr(id_index + '-ID:'.length);
				var label = label_with_id.substr(0, id_index);
				


				
				btns[i].setAttribute('label', label);
				btns[i].setAttribute('data-btn-id', btn_id);
				cCrossWin.afterOfficialInit_completedCustInit = true; // cust init is me takng the btn_id out of the label
				
				var btn_id_found_in_crossWinBtns = false;
				for (var j=0; j<cCrossWin.btns.length; j++) {
					if (cCrossWin.btns[j].btn_id == btn_id) {
						btn_id_found_in_crossWinBtns = true;
						break;
					}
				}
				if (!btn_id_found_in_crossWinBtns) {
					throw new Error('btn_id in label post -ID: was not found in crossWinBtns because devuser made typo'); // should never happen devuser dont make typo
				}
				
				var cClasses = btns[i].getAttribute('class');
				btns[i].setAttribute('class', cClasses + ' custom_classes_divider ' + cCrossWin.btns[j].class);
				
				btns[i].label = label; // after item is appended it doesnt use the '-ID:' anymore so when update it, no need to add in the -ID: link64798787
			}
		}
	}
};
// END - Addon Functionalities

/*start - windowlistener*/
var windowListener = {
	//DO NOT EDIT HERE
	onOpenWindow: function (aXULWindow) {
		// Wait for the window to finish loading
		var aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
		aDOMWindow.addEventListener('load', function () {
			aDOMWindow.removeEventListener('load', arguments.callee, false);
			windowListener.loadIntoWindow(aDOMWindow);
		}, false);
	},
	onCloseWindow: function (aXULWindow) {},
	onWindowTitleChange: function (aXULWindow, aNewTitle) {},
	register: function () {
		
		// Load into any existing windows
		let DOMWindows = Services.wm.getEnumerator(null);
		while (DOMWindows.hasMoreElements()) {
			let aDOMWindow = DOMWindows.getNext();
			if (aDOMWindow.document.readyState == 'complete') { //on startup `aDOMWindow.document.readyState` is `uninitialized`
				windowListener.loadIntoWindow(aDOMWindow);
			} else {
				aDOMWindow.addEventListener('load', function () {
					aDOMWindow.removeEventListener('load', arguments.callee, false);
					windowListener.loadIntoWindow(aDOMWindow);
				}, false);
			}
		}
		// Listen to new windows
		Services.wm.addListener(windowListener);
	},
	unregister: function () {
		// Unload from any existing windows
		let DOMWindows = Services.wm.getEnumerator(null);
		while (DOMWindows.hasMoreElements()) {
			let aDOMWindow = DOMWindows.getNext();
			windowListener.unloadFromWindow(aDOMWindow);
		}
		/*
		for (var u in unloaders) {
			unloaders[u]();
		}
		*/
		//Stop listening so future added windows dont get this attached
		Services.wm.removeListener(windowListener);
	},
	//END - DO NOT EDIT HERE
	loadIntoWindow: function (aDOMWindow) {
		if (!aDOMWindow) { return }
		
		if (aDOMWindow.gBrowser) {
			var domWinUtils = aDOMWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
			domWinUtils.loadSheet(Services.io.newURI(core.addon.path.styles + gCuiCssFilename, null, null), domWinUtils.AUTHOR_SHEET);
			domWinUtils.loadSheet(Services.io.newURI(core.addon.path.styles + 'general.css', null, null), domWinUtils.AUTHOR_SHEET);
			
			for (aGroupId in NBs.crossWin) {
				NBs.insertGlobalToWin(aGroupId, aDOMWindow);
			}
		}/* else if (aDOMWindow.document.location.href == 'chrome://global/content/printProgress.xul') {

			if (!aDOMWindow.opener) {
				// this is my print window so lets set opener
				// for some reason whenever i do print() from hiddenDOMWindow iframe it doesnt get an opener
				// i have set opener this cuz window.opener is null so it doesnt close: `TypeError: opener is null printProgress.js:83:10`
				// as whenever i print from my hidden frame on link678321212 it opens the print dialog with opener set to null, and then it tries opener.focus() and it then leaves the window open
				// :todo: i should maybe target specifically my printer window, as if other people open up with opener null then i dont know if i should fix for them from here, but right now it is, and if opener ever is null then they'll run into that problem of window not closing (at least for me as tested on win81)

				//aDOMWindow.opener = Services.wm.getMostRecentWindow(null); // { focus: function() { } };

			}
		}*/
		
		contextMenuSetup(aDOMWindow);
		
	},
	unloadFromWindow: function (aDOMWindow) {
		if (!aDOMWindow) { return }
		
		if (aDOMWindow.gBrowser) {
			var domWinUtils = aDOMWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
			domWinUtils.removeSheet(Services.io.newURI(core.addon.path.styles + gCuiCssFilename, null, null), domWinUtils.AUTHOR_SHEET);
			domWinUtils.removeSheet(Services.io.newURI(core.addon.path.styles + 'general.css', null, null), domWinUtils.AUTHOR_SHEET);
		}
		
		contextMenuDestroy(aDOMWindow);
	}
};
/*end - windowlistener*/

// start - context menu items
var gToolbarContextMenu_domId = 'toolbar-context-menu';
var gCustomizationPanelItemContextMenu_domId = 'customizationPanelItemContextMenu';

var gDashboardMenuitem_domIdSuffix = '_nativeshot-menuitem';
var gDashboardSeperator_domIdSuffix = '_nativeshot-seperator';

var gDashboardMenuitem_jsonTemplate = ['xul:menuitem', {
	// id: 'toolbar-context-menu_nativeshot-menuitem',
	// label: justFormatStringFromName(core.addon.l10n.bootstrap['dashboard-menuitem']), // cant access myServices.sb till startup, so this is set on startup // link988888887
	class: 'menuitem-iconic',
	image: core.addon.path.images + 'icon16.png',
	hidden: 'true'
}];
var gDashboardMenuseperator_jsonTemplate = ['xul:menuseparator', {
	// id: 'toolbar-context-menu_nativeshot-menuseparator', // id is set when inserting into dom
	hidden: 'true'
}];

function contextMenuBootstrapStartup() {
	// because i cant access myServices.sb until bootstrap startup triggers i have to set these in here
	
	gDashboardMenuitem_jsonTemplate[1].label = justFormatStringFromName(core.addon.l10n.bootstrap['dashboard-menuitem']); // link988888887 - needs to go before windowListener is registered
	gDashboardMenuitem_jsonTemplate[1].onclick = `
		(function() {
			var cntTabs = gBrowser.tabs.length;
			for (var i=0; i<cntTabs; i++) {
				// e10s safe way to check content of tab
				if (gBrowser.tabs[i].getAttribute('label') == '${justFormatStringFromName(core.addon.l10n.bootstrap['nativeshot.app-main.title'])}') { // crossfile-link381787872 - i didnt link over there but &nativeshot.app-main.title; is what this is equal to
					gBrowser.selectedTab = gBrowser.tabs[i];
					return;
				}
			}
			var newNativeshotTab = gBrowser.loadOneTab(\'about:nativeshot\', {inBackground:false});
		})();
	`;
	
}

function contextMenuHiding(e) {
	// only triggered when it was shown due to right click on cui_nativeshot
	console.log('context menu hiding');
	
	e.target.removeEventListener('popuphiding', contextMenuHiding, false);
	
	var cToolbarContextMenu_dashboardMenuitem = e.target.querySelector('#' + gToolbarContextMenu_domId + gDashboardMenuitem_domIdSuffix);
	if (cToolbarContextMenu_dashboardMenuitem) {
		var cToolbarContextMenu_dashboardSeperator = e.target.querySelector('#' + gToolbarContextMenu_domId + gDashboardSeperator_domIdSuffix);
		cToolbarContextMenu_dashboardMenuitem.setAttribute('hidden', 'true');
		cToolbarContextMenu_dashboardSeperator.setAttribute('hidden', 'true');
	}
	
	var cCustomizationPanelItemContextMenu_dashboardMenuitem = e.target.querySelector('#' + gCustomizationPanelItemContextMenu_domId + gDashboardMenuitem_domIdSuffix);
	if (cCustomizationPanelItemContextMenu_dashboardMenuitem) {
		var cCustomizationPanelItemContextMenu_dashboardSeperator = e.target.querySelector('#' + gCustomizationPanelItemContextMenu_domId + gDashboardSeperator_domIdSuffix);			
		cCustomizationPanelItemContextMenu_dashboardMenuitem.setAttribute('hidden', 'true');
		cCustomizationPanelItemContextMenu_dashboardMenuitem.setAttribute('hidden', 'true');
	}
	
}

function contextMenuShowing(e) {
	console.log('context menu showing', 'popupNode:', e.target.ownerDocument.popupNode);
	
	var cPopupNode = e.target.ownerDocument.popupNode;
	if (cPopupNode.getAttribute('id') == 'cui_nativeshot') {
		
		var cToolbarContextMenu_dashboardMenuitem = e.target.querySelector('#' + gToolbarContextMenu_domId + gDashboardMenuitem_domIdSuffix);
		if (cToolbarContextMenu_dashboardMenuitem) {
			var cToolbarContextMenu_dashboardSeperator = e.target.querySelector('#' + gToolbarContextMenu_domId + gDashboardSeperator_domIdSuffix);
			cToolbarContextMenu_dashboardMenuitem.removeAttribute('hidden');
			cToolbarContextMenu_dashboardSeperator.removeAttribute('hidden');
			e.target.addEventListener('popuphiding', contextMenuHiding, false);
		}
		
		var cCustomizationPanelItemContextMenu_dashboardMenuitem = e.target.querySelector('#' + gCustomizationPanelItemContextMenu_domId + gDashboardMenuitem_domIdSuffix);
		if (cCustomizationPanelItemContextMenu_dashboardMenuitem) {
			var cCustomizationPanelItemContextMenu_dashboardSeperator = e.target.querySelector('#' + gCustomizationPanelItemContextMenu_domId + gDashboardSeperator_domIdSuffix);			
			cCustomizationPanelItemContextMenu_dashboardMenuitem.removeAttribute('hidden');
			cCustomizationPanelItemContextMenu_dashboardSeperator.removeAttribute('hidden');
			e.target.addEventListener('popuphiding', contextMenuHiding, false);
		}
		
	}
}

function contextMenuSetup(aDOMWindow) {
	// if this aDOMWindow has the context menus set it up
		
		
		
	var cToolbarContextMenu = aDOMWindow.document.getElementById(gToolbarContextMenu_domId);
	if (cToolbarContextMenu) {
		gDashboardMenuitem_jsonTemplate[1].id = gToolbarContextMenu_domId + gDashboardMenuitem_domIdSuffix;
		gDashboardMenuseperator_jsonTemplate[1].id = gToolbarContextMenu_domId + gDashboardSeperator_domIdSuffix;
		
		var cToolbarContextMenu_dashboardMenuitem = jsonToDOM(gDashboardMenuitem_jsonTemplate, aDOMWindow.document, {});
		var cToolbarContextMenu_dashboardSeperator = jsonToDOM(gDashboardMenuseperator_jsonTemplate, aDOMWindow.document, {});

			

		cToolbarContextMenu.insertBefore(cToolbarContextMenu_dashboardSeperator, cToolbarContextMenu.firstChild);
		cToolbarContextMenu.insertBefore(cToolbarContextMenu_dashboardMenuitem, cToolbarContextMenu.firstChild);
		
		cToolbarContextMenu.addEventListener('popupshowing', contextMenuShowing, false);
	}
	
	var cCustomizationPanelItemContextMenu = aDOMWindow.document.getElementById(gCustomizationPanelItemContextMenu_domId);
	if (cCustomizationPanelItemContextMenu) {
		
		gDashboardMenuitem_jsonTemplate[1].id = gCustomizationPanelItemContextMenu_domId + gDashboardMenuitem_domIdSuffix;
		gDashboardMenuseperator_jsonTemplate[1].id = gCustomizationPanelItemContextMenu_domId + gDashboardSeperator_domIdSuffix;
		
		var cCustomizationPanelItemContextMenu_dashboardMenuitem = jsonToDOM(gDashboardMenuitem_jsonTemplate, aDOMWindow.document, {});
		var cCustomizationPanelItemContextMenu_dashboardSeperator = jsonToDOM(gDashboardMenuseperator_jsonTemplate, aDOMWindow.document, {});

			

		cCustomizationPanelItemContextMenu.insertBefore(cCustomizationPanelItemContextMenu_dashboardSeperator, cCustomizationPanelItemContextMenu.firstChild);
		cCustomizationPanelItemContextMenu.insertBefore(cCustomizationPanelItemContextMenu_dashboardMenuitem, cCustomizationPanelItemContextMenu.firstChild);
		
		cCustomizationPanelItemContextMenu.addEventListener('popupshowing', contextMenuShowing, false);
	}
	
	// console.log('ok good setup');
}

function contextMenuDestroy(aDOMWindow) {
	// if this aDOMWindow has the context menus it removes it from it
	
	var cToolbarContextMenu = aDOMWindow.document.getElementById(gToolbarContextMenu_domId);
	if (cToolbarContextMenu) {
		var cToolbarContextMenu_dashboardMenuitem = aDOMWindow.document.getElementById(gToolbarContextMenu_domId + gDashboardMenuitem_domIdSuffix);
		var cToolbarContextMenu_dashboardSeperator = aDOMWindow.document.getElementById(gToolbarContextMenu_domId + gDashboardSeperator_domIdSuffix);
		
		cToolbarContextMenu.removeChild(cToolbarContextMenu_dashboardMenuitem);
		cToolbarContextMenu.removeChild(cToolbarContextMenu_dashboardSeperator);
		
		cToolbarContextMenu.removeEventListener('popupshowing', contextMenuShowing, false);
	}
	
	var cCustomizationPanelItemContextMenu = aDOMWindow.document.getElementById(gCustomizationPanelItemContextMenu_domId);	
	if (cCustomizationPanelItemContextMenu) {
		var cCustomizationPanelItemContextMenu_dashboardMenuitem = aDOMWindow.document.getElementById(gCustomizationPanelItemContextMenu_domId + gDashboardMenuitem_domIdSuffix);
		var cCustomizationPanelItemContextMenu_dashboardSeperator = aDOMWindow.document.getElementById(gCustomizationPanelItemContextMenu_domId + gDashboardSeperator_domIdSuffix);
		
		cCustomizationPanelItemContextMenu.removeChild(cCustomizationPanelItemContextMenu_dashboardMenuitem);
		cCustomizationPanelItemContextMenu.removeChild(cCustomizationPanelItemContextMenu_dashboardSeperator);
		
		cCustomizationPanelItemContextMenu.removeEventListener('popupshowing', contextMenuShowing, false);
	}
	
	// console.log('ok good destroyed');
	
}
// end - context menu items

var gDelayedShotObj;
var gLastIntervalId = -1;
const delayedShotTimePerClick = 5; // sec

function delayedShotUpdateBadges() {
	var widgetInstances = CustomizableUI.getWidget('cui_nativeshot').instances;
	for (var i=0; i<widgetInstances.length; i++) {
		if (gDelayedShotObj.time_left > 0 && !widgetInstances[i].node.hasAttribute('badge')) {
			widgetInstances[i].node.classList.add('badged-button');
		}
		if (gDelayedShotObj.time_left > 0) {
			widgetInstances[i].node.setAttribute('badge', gDelayedShotObj.time_left);
		} else {
			widgetInstances[i].node.classList.remove('badged-button');
			widgetInstances[i].node.removeAttribute('badge');
		}
	}
}

var delayedShotTimerCallback = {
	notify: function() {
		gDelayedShotObj.time_left--;
		delayedShotUpdateBadges();
		if (!gDelayedShotObj.time_left) {
			cancelAndCleanupDelayedShot();
			var aDOMWin = Services.wm.getMostRecentWindow('navigator:browser');
			if (!aDOMWin) {
				throw new Error('no navigator:browser type window open, this is required in order to take screenshot')
			}
			shootAllMons(aDOMWin);
		} else {
			gDelayedShotObj.timer.initWithCallback(delayedShotTimerCallback, 1000, Ci.nsITimer.TYPE_ONE_SHOT);
		}
	}
};

function cancelAndCleanupDelayedShot() {
	if (gDelayedShotObj) {
		gDelayedShotObj.timer.cancel();
		gDelayedShotObj.time_left = 0; // needed for delayedShotUpdateBadges
		delayedShotUpdateBadges();
		gDelayedShotObj = null;
	}
}

// start - AttentionBar mixin
var AB = { // AB stands for attention bar
	// based on https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XUL/notificationbox#Methods && https://dxr.mozilla.org/mozilla-central/source/toolkit/content/widgets/notification.xml#79
	Insts: {
		/*
		##: {
			state: avail in bootstrap only. the dom does a JSON.parse(JSON.stringify()) on this when updating from it
			setState: avail only in dom, its the react connection to it
			callbackids: {}, only in bootstrap, used for help cleaning up on destroy. key is id of callback, value is meaningless
		}
		*/
	}, // holds all instances
	domIdPrefix: core.addon.id.replace(/[^a-z0-9-_\:\.]/ig,'AB'), // The ID and NAME elements must start with a letter i.e. upper case A to Z or lower case a to z; a number is not allowed. After the first letter any number of letters (a to z, A to Z), digits (0 to 9), hyphens (-), underscores (_), colons (:) and periods (.) are allowed. // http://www.electrictoolbox.com/valid-characters-html-id-attribute/
	Callbacks: {},
	// key is nid, if nid is of a notification then the callback is a close callback, else it is of a click callback.
	// all Callbacks have last arg of aBrowser which is the xul browser element that was focused when user triggered the cb
	// click callbacks have first arg doClose, you should call doClose(aBrowser) if you want to close out the AB
	// callbacks this is bound to useful stuff. all are passed by reference so modifying that modfieis the entry in AB.Insts
		// for example clicking a menu item:
			// this: Object { inststate: Object, btn: Object, menu: Array[2], menuitem: Object } bootstrap.js:501
		// clicking btn, inst will have inststate and btn
		// closing this has inststate only
	nid: -1, // stands for next_id, used for main toolbar, and also for each button, and also each menu item
	/*
	{
		id: genned id, each id gets its own container in aDOMWindow
		desc: aDesc,
		comp: stands for react component, this gets rendered
	}
	*/
	setStateDestroy: function(aInstId) {
		// destroys, and cleans up, this does not worry about callbacks. the nonDevUserSpecifiedCloseCb actually calls this
		
		// unmount from all windows dom && delete from all windows js
		var doit = function(aDOMWindow) {
			// start - copy block link77728110
			if (!aDOMWindow.gBrowser) {
				return; // because i am targeting cDeck, windows without gBrowser won't have it
			}
			var winAB = aDOMWindow[core.addon.id + '-AB'];
			if (winAB) {
				if (aInstId in winAB.Insts) {
					// unmount this
					console.error('aInstId:', aInstId, 'notificationbox-' + aInstId + '--' + AB.domIdPrefix);
					var cNotificationBox = aDOMWindow.document.getElementById('notificationbox-' + aInstId + '--' + AB.domIdPrefix);
					aDOMWindow.ReactDOM.unmountComponentAtNode(cNotificationBox);
					cNotificationBox.parentNode.removeChild(cNotificationBox);
					delete winAB.Insts[aInstId];
				}
			}
			// end - copy block link77728110
		};
		
		var DOMWindows = Services.wm.getEnumerator(null);
		while (DOMWindows.hasMoreElements()) {
			var aDOMWindow = DOMWindows.getNext();
			if (aDOMWindow.document.readyState == 'complete') { //on startup `aDOMWindow.document.readyState` is `uninitialized`
				doit(aDOMWindow);
			}//  else { // not complete means its impossible it has this aInstId mounted in here
				// // aDOMWindow.addEventListener('load', function () {
				// // 	aDOMWindow.removeEventListener('load', arguments.callee, false);
				// // 	doit(aDOMWindow);
				// // }, false);
			//}
		}
		
		// delete callbacks
		for (var aCallbackId in AB.Insts[aInstId].callbackids) {
			delete AB.Callbacks[aCallbackId];
		}
		
		// delete from bootstrap js
		delete AB.Insts[aInstId];
	},
	setState: function(aInstState) { // :note: aInstState is really aInstStateState
		// this function will add to aInstState and all bts in aInstState.aBtns a id based on this.genId()
		// this function also sends setState message to all windows to update this instances
		// aInstState should be strings only, as it is sent to all windows
		
		// :note: to remove a callback you have to set it to an empty function - ```getScope().AB.Insts[0].state.aClose = function() {}; getScope().AB.setState(getScope().AB.Insts[0].state);```
		
		// RETURNS
			// updated aInstState

		
		var cInstDefaults = {
			// aId: this is auto added in
			aTxt: '', // this is the message body on the toolbar
			aPos: 0, // 1 for top, on where to append it
			aIcon: 'chrome://mozapps/skin/places/defaultFavicon.png', // icon on the toolbar
			aPriority: 1, // valid values 1-10
			aBtns: [], // must be array
			aHideClose: undefined, // if set to string 'true' or bool true, in dom it will get converted to string as 'true'. setting to 1 int will not work.
			aClose: undefined
		};
		
		/*
		aBtns: array of objects
		[
			{
				// bId - this is auto generated and stuck in here, with this.nid
				bIcon: optional, string to image path
				bTxt: required, text shown on button
				bKey: 'B', // access key
				bMenu: [
					{
						//mId: this is auto genned and added in here,
						mTxt: 'string'
					}
				]
			},
			{
				...
			}
		]
		*/
		
		if (!('aId' in aInstState)) {
			validateOptionsObj(aInstState, cInstDefaults);
			aInstState.aId = AB.genId();
			AB.Insts[aInstState.aId] = {
				state: aInstState,
				callbackids: {}
			};
			AB.Callbacks[aInstState.aId] = function(aBrowser) {
				AB.nonDevUserSpecifiedCloseCb(aInstState.aId, aBrowser); // this one doesnt need bind, only devuser callbacks are bound
			};
			AB.Insts[aInstState.aId].callbackids[aInstState.aId] = 1; // the close callback id
		}
		if (aInstState.aClose) {
			var aClose = aInstState.aClose.bind({inststate:aInstState});
			delete aInstState.aClose;
			
			AB.Callbacks[aInstState.aId] = function(aBrowser) {
				var rez_aClose = aClose(aBrowser);
				if (rez_aClose !== false) { // :note: if onClose returns false, it cancels the closing
					AB.nonDevUserSpecifiedCloseCb(aInstState.aId, aBrowser); // this one doesnt need bind, only devuser callbacks are bound
				}
			};
			
		}
		
		// give any newly added btns and menu items an id		
		if (aInstState.aBtns) {
			for (var i=0; i<aInstState.aBtns.length; i++) {
				if (!('bId' in aInstState.aBtns[i])) {
					aInstState.aBtns[i].bId = AB.genId();
				}
				if (aInstState.aBtns[i].bClick) { // i dont do this only if bId is not there, because devuser can change it up. i detect change by presenence of the bClick, because after i move it out of state obj and into callbacks obj, i delete it from state obj. so its not here unless changed
					AB.Insts[aInstState.aId].callbackids[aInstState.aBtns[i].bId] = 1; // its ok if it was already there, its the same one ill be removing
					AB.Callbacks[aInstState.aBtns[i].bId] = aInstState.aBtns[i].bClick.bind({inststate:aInstState, btn:aInstState.aBtns[i]}, AB.Callbacks[aInstState.aId]);
					delete aInstState.aBtns[i].bClick; // AB.Callbacks[aInstState.aId] is the doClose callback devuser should call if they want it to close out
				}
				if (aInstState.aBtns[i].bMenu) {
					AB.iterMenuForIdAndCbs(aInstState.aBtns[i].bMenu, aInstState.aId, aInstState.aBtns[i]);
				}
			}
		}
		
		// go through all windows, if this id is not in it, then mount it, if its there then setState on it
		
		var doit = function(aDOMWindow) {
			// start - orig block link181888888
			if (!aDOMWindow.gBrowser) {
				return; // because i am targeting cDeck, windows without gBrowser won't have it
			}
			AB.ensureInitedIntoWindow(aDOMWindow);
			
			if (aInstState.aId in aDOMWindow[core.addon.id + '-AB'].Insts) {
				aDOMWindow[core.addon.id + '-AB'].Insts[aInstState.aId].state = aDOMWindow.JSON.parse(aDOMWindow.JSON.stringify(aInstState));
				aDOMWindow[core.addon.id + '-AB'].Insts[aInstState.aId].setState(JSON.parse(JSON.stringify(aInstState)));
			} else {
				// mount it
				aDOMWindow[core.addon.id + '-AB'].Insts[aInstState.aId] = {};
				aDOMWindow[core.addon.id + '-AB'].Insts[aInstState.aId].state = aDOMWindow.JSON.parse(aDOMWindow.JSON.stringify(aInstState));
				var cDeck = aDOMWindow.document.getElementById('content-deck');
				var cNotificationBox = aDOMWindow.document.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'notificationbox');
				console.error('inserting', 'notificationbox-' + aInstState.aId + '--' + AB.domIdPrefix);
				cNotificationBox.setAttribute('id', 'notificationbox-' + aInstState.aId + '--' + AB.domIdPrefix);
				if (!aInstState.aPos) {
					cDeck.parentNode.appendChild(cNotificationBox);
				} else {
					cDeck.parentNode.insertBefore(cNotificationBox, cDeck); // for top
				}
				aDOMWindow[core.addon.id + '-AB'].Insts[aInstState.aId].relement = aDOMWindow.React.createElement(aDOMWindow[core.addon.id + '-AB'].masterComponents.Notification, aInstState);
				aDOMWindow.ReactDOM.render(aDOMWindow[core.addon.id + '-AB'].Insts[aInstState.aId].relement, cNotificationBox);
			}
			// end - orig block link181888888
		};
		
		// have to do this, because if i call setState with a new object, one that is not AB.Insts[aId] then it wont get updated, and when loadInstancesIntoWindow it will not have the updated one
		AB.Insts[aInstState.aId].state = aInstState;
		
		var DOMWindows = Services.wm.getEnumerator(null);
		while (DOMWindows.hasMoreElements()) {
			var aDOMWindow = DOMWindows.getNext();
			if (aDOMWindow.document.readyState == 'complete') { //on startup `aDOMWindow.document.readyState` is `uninitialized`
				doit(aDOMWindow);
			} else {
				aDOMWindow.addEventListener('load', function () {
					aDOMWindow.removeEventListener('load', arguments.callee, false);
					doit(aDOMWindow);
				}, false);
			}
		}
		
		return aInstState;
	},
	nonDevUserSpecifiedCloseCb: function(aInstId, aBrowser) {
		// this does the unmounting from all windows, and deletes entry from this.Insts
		
		// aBrowser.contentWindow.alert('ok this tab sent the close message for aInstId ' + aInstId);
		// on close go through and get all id's in there and remove all callbacks for it. and then unmount from all windows.
		AB.setStateDestroy(aInstId, true);
	},
	genId: function() {
		AB.nid++;
		return AB.nid;
	},
	iterMenuForIdAndCbs: function(jMenu, aCloseCallbackId, aBtnEntry) {
		// aCloseCallbackId is same as aInstId
		// aBtnArrEntry is reference as its the btn object in the .aBtns arr
		// goes through and gives every menuitem and submenu item (anything that has cTxt) an id, as they are clickable
		// ALSO moves cClick callbacks into AB.Callbacks
		jMenu.forEach(function(jEntry, jIndex, jArr) {
			if (!jEntry.cId && jEntry.cTxt) { // cId will NEVER be 0 but if it does it would be a problem with !jEntry.cId because first the notification bar is genId and the button is genId and nid starts at 0 so its at least 2 by first jMenu
				jEntry.cId = AB.genId();
				if (jEntry.cMenu) {
					AB.iterMenuForIdAndCbs(jEntry.cMenu, aCloseCallbackId, aBtnEntry);
				}
			}
			if (jEntry.cClick) { // i dont do this only if bId is not there, because devuser can change it up. i detect change by presenence of the bClick, because after i move it out of state obj and into callbacks obj, i delete it from state obj. so its not here unless changed
				AB.Insts[aCloseCallbackId].callbackids[jEntry.cId] = 1; // its ok if it was already there, its the same one ill be removing
				AB.Callbacks[jEntry.cId] = jEntry.cClick.bind({inststate:AB.Insts[aCloseCallbackId].state, btn:aBtnEntry, menu:jMenu, menuitem:jEntry}, AB.Callbacks[aCloseCallbackId]);
				delete jEntry.cClick; // AB.Callbacks[aInst.aId] is the doClose callback devuser should call if they want it to close out
			}
		});
	},
	uninitFromWindow: function(aDOMWindow) {
		if (!aDOMWindow[core.addon.id + '-AB']) {
			return;
		}
		console.error('doing uninit from window');
		// start - original block link77728110
		var winAB = aDOMWindow[core.addon.id + '-AB'];
		for (var aInstsId in winAB.Insts) {
			// unmount this
			console.error('aInstsId:', aInstsId, 'notificationbox-' + aInstsId + '--' + AB.domIdPrefix);
			var cNotificationBox = aDOMWindow.document.getElementById('notificationbox-' + aInstsId + '--' + AB.domIdPrefix);
			aDOMWindow.ReactDOM.unmountComponentAtNode(cNotificationBox);
			cNotificationBox.parentNode.removeChild(cNotificationBox);
		}
		// end - original block link77728110
		delete aDOMWindow[core.addon.id + '-AB'];
		console.error('done uninit');
		aDOMWindow.removeEventListener(core.addon.id + '-AB', AB.msgEventListener, false);
	},
	ensureInitedIntoWindow: function(aDOMWindow) {
		// dont run this yoruself, ensureInstancesToWindow runs this. so if you want to run yourself, then run ensureInstancesToWindow(aDOMWindow)
		if (!aDOMWindow[core.addon.id + '-AB']) {
			aDOMWindow[core.addon.id + '-AB'] = {
				Insts: {},
				domIdPrefix: AB.domIdPrefix
			}; // ab stands for attention bar
			if (!aDOMWindow.React) {
				console.log('WILL NOW LOAD IN REACT');
				// resource://devtools/client/shared/vendor/react.js
				Services.scriptloader.loadSubScript(core.addon.path.scripts + 'react-with-addons.js?' + core.addon.cache_key, aDOMWindow); // even if i load it into aDOMWindow.blah and .blah is an object, it goes into global, so i just do aDOMWindow now
			}
			if (!aDOMWindow.ReactDOM) {
				console.log('WILL NOW LOAD IN REACTDOM');
				// resource://devtools/client/shared/vendor/react-dom.js
				Services.scriptloader.loadSubScript(core.addon.path.scripts + 'react-dom.js?' + core.addon.cache_key, aDOMWindow);
			}
			Services.scriptloader.loadSubScript(core.addon.path.scripts + 'ab-react-components.js?' + core.addon.cache_key, aDOMWindow);
			aDOMWindow.addEventListener(core.addon.id + '-AB', AB.msgEventListener, false);
		}
	},
	init: function() {
		// Services.mm.addMessageListener(core.addon.id + '-AB', AB.msgListener);
		
		Services.wm.addListener(AB.winListener);
		
		// i dont iterate all windows now and do ensureInitedIntoWindow, because i only run ensureInitedIntoWindow when there is something to add, so its lazy
		
		// and its impossible that Insts exists before Init, so no need to iterate through all windows.
	},
	uninit: function() {
		// Services.mm.removeMessageListener(core.addon.id + '-AB', AB.msgListener);
		
		Services.wm.removeListener(AB.winListener);
		
		// go through all windows and unmount
		var DOMWindows = Services.wm.getEnumerator(null);
		while (DOMWindows.hasMoreElements()) {
			var aDOMWindow = DOMWindows.getNext();
			if (aDOMWindow[core.addon.id + '-AB']) {
				AB.uninitFromWindow(aDOMWindow);
			}
		}
	},
	msgEventListener: function(e) {
		console.error('getting aMsgEvent, data:', e.detail);
		var cCallbackId = e.detail.cbid;
		var cBrowser = e.detail.browser; 
		if (AB.Callbacks[cCallbackId]) { // need this check because react components always send message on click, but it may not have a callback
			AB.Callbacks[cCallbackId](cBrowser);
		}
	},
	// msgListener: {
	// 	receiveMessage: function(aMsgEvent) {
	// 		var aMsgEventData = aMsgEvent.data;
	// 		console.error('getting aMsgEvent, data:', aMsgEventData);
	// 		// this means trigger a callback with id aMsgEventData
	// 		var cCallbackId = aMsgEventData;
	// 		var cBrowser = aMsgEvent.target;
	// 		if (AB.Callbacks[cCallbackId]) { // need this check because react components always send message on click, but it may not have a callback
	// 			AB.Callbacks[cCallbackId](cBrowser);
	// 		}
	// 	}
	// },
	loadInstancesIntoWindow: function(aDOMWindow) {
		// this function is called when there may be instances in AB.Insts but and it needs to be verified that its mounted in window
		// basically this is called when a new window is opened
		
		var idsInsts = Object.keys(AB.Insts);
		if (!idsInsts.length) {
			return;
		}
		
		var doit = function(aDOMWindow) {
			// check again, in case by the time window loaded, AB.Insts changed
			var idsInsts = Object.keys(AB.Insts);
			if (!idsInsts.length) {
				return;
			}
			
			// start - copy of block link181888888
			if (!aDOMWindow.gBrowser) {
				return; // because i am targeting cDeck, windows without gBrowser won't have it
			}

			AB.ensureInitedIntoWindow(aDOMWindow);

			for (var aInstId in AB.Insts) {
				var aInstState = AB.Insts[aInstId].state;
				if (aInstState.aId in aDOMWindow[core.addon.id + '-AB'].Insts) {
					console.error('this is really weird, it should never happen, as i only call this function when a new window opens');
					aDOMWindow[core.addon.id + '-AB'].Insts[aInstState.aId].state = aDOMWindow.JSON.parse(aDOMWindow.JSON.stringify(aInstState));
					aDOMWindow[core.addon.id + '-AB'].Insts[aInstState.aId].setState(JSON.parse(JSON.stringify(aInstState)));
				} else {
					// mount it
					aDOMWindow[core.addon.id + '-AB'].Insts[aInstState.aId] = {};
					aDOMWindow[core.addon.id + '-AB'].Insts[aInstState.aId].state = aDOMWindow.JSON.parse(aDOMWindow.JSON.stringify(aInstState));
					var cDeck = aDOMWindow.document.getElementById('content-deck');
					var cNotificationBox = aDOMWindow.document.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'notificationbox');
					console.error('inserting', 'notificationbox-' + aInstState.aId + '--' + AB.domIdPrefix);
					cNotificationBox.setAttribute('id', 'notificationbox-' + aInstState.aId + '--' + AB.domIdPrefix);
					if (!aInstState.aPos) {
						cDeck.parentNode.appendChild(cNotificationBox);
					} else {
						cDeck.parentNode.insertBefore(cNotificationBox, cDeck); // for top
					}
					aDOMWindow[core.addon.id + '-AB'].Insts[aInstState.aId].relement = aDOMWindow.React.createElement(aDOMWindow[core.addon.id + '-AB'].masterComponents.Notification, aInstState);
					aDOMWindow.ReactDOM.render(aDOMWindow[core.addon.id + '-AB'].Insts[aInstState.aId].relement, cNotificationBox);
				}
				// end - copy of block link181888888
			}
		};
		

		if (aDOMWindow.document.readyState == 'complete') { //on startup `aDOMWindow.document.readyState` is `uninitialized`
			doit(aDOMWindow);
		} else {
			aDOMWindow.addEventListener('load', function () {
				aDOMWindow.removeEventListener('load', arguments.callee, false);
				doit(aDOMWindow);
			}, false);
		}
		
	},
	winListener: {
		onOpenWindow: function (aXULWindow) {
			// Wait for the window to finish loading
			var aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
			aDOMWindow.addEventListener('load', function () {
				aDOMWindow.removeEventListener('load', arguments.callee, false);
				AB.loadInstancesIntoWindow(aDOMWindow);
			}, false);
		},
		onCloseWindow: function (aXULWindow) {},
		onWindowTitleChange: function (aXULWindow, aNewTitle) {},
	}
};
// end - AttentionBar mixin

// start - System hotkey stuff
var HotkeyWorkerMainThreadFuncs = {
	takeShot: function() {
		if (gEditor.sessionId) {
			console.warn('geditor is currently open, so will not open another one'); // so user pressed prnt screen while it was already open
			return;
		}
		if (gDelayedShotObj) {
			cancelAndCleanupDelayedShot();
		}
		// imemdiate freeze
		shootAllMons(Services.wm.getMostRecentWindow('navigator:browser'));
	}
};

function initOstypes() {
	if (typeof ostypes == 'undefined') {
		Cu.import('resource://gre/modules/ctypes.jsm');
		
		Services.scriptloader.loadSubScript(core.addon.path.modules + 'ostypes/cutils.jsm', BOOTSTRAP); // need to load cutils first as ostypes_mac uses it for HollowStructure
		Services.scriptloader.loadSubScript(core.addon.path.modules + 'ostypes/ctypes_math.jsm', BOOTSTRAP);
		switch (core.os.mname) {
			case 'winnt':
			case 'winmo':
			case 'wince':
				console.log('loading:', core.addon.path.modules + 'ostypes/ostypes_win.jsm');
				Services.scriptloader.loadSubScript(core.addon.path.modules + 'ostypes/ostypes_win.jsm', BOOTSTRAP);
				break
			case 'gtk':
				Services.scriptloader.loadSubScript(core.addon.path.modules + 'ostypes/ostypes_x11.jsm', BOOTSTRAP);
				break;
			case 'darwin':
				Services.scriptloader.loadSubScript(core.addon.path.modules + 'ostypes/ostypes_mac.jsm', BOOTSTRAP);
				break;
			default:
				throw new Error('Operating system, "' + OS.Constants.Sys.Name + '" is not supported');
		}
	}
}

function initHotkey() {
	switch (core.os.mname) {
		case 'wince':
		case 'winmo':
		case 'winnt':
		case 'gtk':

				var promise_initHotkeys = SIPWorker('HotkeyWorker', core.addon.path.content + 'modules/hotkey/HotkeyWorker.js', core, HotkeyWorkerMainThreadFuncs).post();
				promise_initHotkeys.then(
					function(aHotkeyRegisterError) {
						console.log('Fullfilled - promise_initHotkeys - ', aHotkeyRegisterError);
						
						// on error aHotkeyRegisterError is a string
						if (aHotkeyRegisterError) {
							Services.prompt.alert(Services.wm.getMostRecentWindow('navigator:browser'), 'NativeShot - Error', 'The global hotkey failed to register.\n\n' + aHotkeyRegisterError);
						}
					},
					genericReject.bind(null, 'promise_initHotkeys', 0)
				).catch(genericCatch.bind(null, 'promise_initHotkeys', 0));
				
			break;
		case 'darwin':
			
				initOstypes();
				
				OSStuff.hotkeyLastTriggered = 0;
				
				OSStuff.hotkeyCallback = ostypes.TYPE.EventHandlerUPP(function(nextHandler, theEvent, userDataPtr) {
					// EventHandlerCallRef nextHandler, EventRef theEvent, void *userData
					console.log('wooohoo ah!! called hotkey!');
					var hotkeyNowTriggered = (new Date()).getTime();
					if (hotkeyNowTriggered - OSStuff.hotkeyLastTriggered > 1000) {
						OSStuff.hotkeyLastTriggered = hotkeyNowTriggered;
						HotkeyWorkerMainThreadFuncs.takeShot();
					}
					else { console.warn('will not takeShot as 1sec has not yet elapsed since last triggering hotkey'); }
					return 0; // must be of type ostypes.TYPE.OSStatus
				});
				
				var eventType = ostypes.TYPE.EventTypeSpec();
				eventType.eventClass = ostypes.CONST.kEventClassKeyboard;
				eventType.eventKind = ostypes.CONST.kEventHotKeyPressed;
				
				var rez_appTarget = ostypes.API('GetApplicationEventTarget')();
				// console.log('rez_appTarget GetApplicationEventTarget:', rez_appTarget.toString());
				console.log('OSStuff.hotkeyCallback:', OSStuff.hotkeyCallback.toString());
				var rez_install = ostypes.API('InstallEventHandler')(rez_appTarget, OSStuff.hotkeyCallback, 1, eventType.address(), null, null);
				console.log('rez_install:', rez_install.toString());
				
				var gMyHotKeyRef = ostypes.TYPE.EventHotKeyRef();
				var gMyHotKeyID = ostypes.TYPE.EventHotKeyID();
				gMyHotKeyID.signature = 1752460081; // has to be a four char code. MACS is http://stackoverflow.com/a/27913951/1828637 0x4d414353 so i just used htk1 as in the example here http://dbachrach.com/blog/2005/11/program-global-hotkeys-in-cocoa-easily/ i just stuck into python what the stackoverflow topic told me and got it struct.unpack(">L", "htk1")[0]
				gMyHotKeyID.id = 1876;
				
				// console.log('gMyHotKeyID:', gMyHotKeyID.toString());
				// console.log('gMyHotKeyID.address():', gMyHotKeyID.address().toString());
				
				// console.log('ostypes.CONST.shiftKey + ostypes.CONST.cmdKey:', ostypes.CONST.shiftKey + ostypes.CONST.cmdKey);
				// console.log('gMyHotKeyRef.address():', gMyHotKeyRef.address().toString());
				
				var rez_reg = ostypes.API('RegisterEventHotKey')(20, ostypes.CONST.cmdKey, gMyHotKeyID, rez_appTarget, 0, gMyHotKeyRef.address());
				console.log('rez_reg:', rez_reg.toString(), ostypes.HELPER.convertLongOSStatus(rez_reg));
				
				OSStuff.gMyHotKeyRef = gMyHotKeyRef;
			
			break;
		default:
			console.error('system hotkey not supported on your os');
	}
}

function uninitHotkey() {
	switch (core.os.mname) {
		case 'wince':
		case 'winmo':
		case 'winnt':
		case 'gtk':

				if (bootstrap.HotkeyWorker && HotkeyWorker.launchTimeStamp) {
					var promise_requestTerm = HotkeyWorker.post('prepTerm', []);
					promise_requestTerm.then(
						function(aVal) {
							console.log('Fullfilled - promise_requestTerm - ', aVal);
							HotkeyWorker._worker.terminate();
							delete bootstrap.HotkeyWorker;
						},
						genericReject.bind(null, 'promise_requestTerm', 0)
					).catch(genericCatch.bind(null, 'promise_requestTerm', 0));
				}

			break;
		case 'darwin':
			
				if (OSStuff.hotkeyCallback) {
					
					var rez_unreg = ostypes.API('UnregisterEventHotKey')(OSStuff.gMyHotKeyRef);
					console.log('rez_unreg:', rez_unreg.toString(), ostypes.HELPER.convertLongOSStatus(rez_unreg));
					
					delete OSStuff.hotkeyCallback;
					delete OSStuff.gMyHotKeyRef;
					delete OSStuff.hotkeyLastTriggered;
				}
			
			break;
		default:
			console.error('system hotkey not supported on your os');
	}
}
// end - System hotkey stuff

// start - MainWorkerMainThreadFuncs
var MainWorkerMainThreadFuncs = {
	callInPromiseWorker: function(aWorkerName, aArrOfFuncnameThenArgs) {
		// for use with sendAsyncMessageWithCallback from framescripts
		
		var mainDeferred_callInPromiseWorker = new Deferred();
		
		console.log('aWorkerName:', aWorkerName);
		console.log('aArrOfFuncnameThenArgs:', aArrOfFuncnameThenArgs);
		
		var rez_pwcall = BOOTSTRAP[aWorkerName].post(aArrOfFuncnameThenArgs.shift(), aArrOfFuncnameThenArgs);
		rez_pwcall.then(
			function(aVal) {
				console.log('Fullfilled - rez_pwcall - ', aVal);
				if (Array.isArray(aVal)) {
					mainDeferred_callInPromiseWorker.resolve(aVal);
				} else {
					mainDeferred_callInPromiseWorker.resolve([aVal]);
				}
			},
			function(aReason) {
				var rejObj = {
					name: 'rez_pwcall',
					aReason: aReason
				};
				console.error('Rejected - rez_pwcall - ', rejObj);
				mainDeferred_callInPromiseWorker.resolve([rejObj]);
			}
		).catch(
			function(aCaught) {
				var rejObj = {
					name: 'rez_pwcall',
					aCaught: aCaught
				};
				console.error('Caught - rez_pwcall - ', rejObj);
				mainDeferred_callInPromiseWorkerr.resolve([rejObj]);
			}
		);
		
		return mainDeferred_callInPromiseWorker.promise;
	},
	authorizeApp: function(aBtnId, aUrl, aCallbackSetName) {
		var deferredMain_authorizeApp = new Deferred();
		
		var promise_fhrResponse = (fhr_ifBtnIdNodata(aBtnId) || gEditorABData_Btn[aBtnId].getBtnFHR()).loadPage(aUrl, null, aCallbackSetName, null);
		promise_fhrResponse.then(
			function(aFHRResponse) {
				console.log('Fullfilled - promise_fhrResponse - ', aFHRResponse);
				deferredMain_authorizeApp.resolve([aFHRResponse]);
			},
			genericReject.bind(null, 'promise_fhrResponse', deferredMain_authorizeApp)
		).catch(genericCatch.bind(null, 'promise_fhrResponse', deferredMain_authorizeApp));
		
		return deferredMain_authorizeApp.promise;
	},
	clickAllow: function(aBtnId, aClickSetName, aCallbackSetName) {
		// clicks allow for authorizeApp
		
		var deferredMain_clickAllow = new Deferred();
	
		var promise_fhrResponse = (fhr_ifBtnIdNodata(aBtnId) || gEditorABData_Btn[aBtnId].getBtnFHR()).loadPage(null, aClickSetName, aCallbackSetName, null);
		promise_fhrResponse.then(
			function(aFHRResponse) {
				console.log('Fullfilled - promise_fhrResponse - ', aFHRResponse);
				deferredMain_clickAllow.resolve([aFHRResponse]);
			},
			genericReject.bind(null, 'promise_fhrResponse', deferredMain_clickAllow)
		).catch(genericCatch.bind(null, 'promise_fhrResponse', deferredMain_clickAllow));
		
		return deferredMain_clickAllow.promise;
	},
	clickPickAcct: function(aBtnId, aClickSetName, aCallbackSetName, aLoadPageData) {
		// aLoadPageData should be aMultiAcctPickInfo (which is acct entry for one of the multiple accts found) is an object that has three  keys, uid and screenname and domElId or domElSelector . :todo: consider putting in domElSelector or domElId
		var deferredMain_pickAccount = new Deferred();
	
		var promise_fhrResponse = (fhr_ifBtnIdNodata(aBtnId) || gEditorABData_Btn[aBtnId].getBtnFHR()).loadPage(null, aClickSetName, aCallbackSetName, aLoadPageData);
		console.error('promise_fhrResponse:', promise_fhrResponse);
		promise_fhrResponse.then(
			function(aFHRResponse) {
				console.log('Fullfilled - promise_fhrResponse - ', aFHRResponse);
				deferredMain_pickAccount.resolve([aFHRResponse]);
			},
			genericReject.bind(null, 'promise_fhrResponse', deferredMain_pickAccount)
		).catch(genericCatch.bind(null, 'promise_fhrResponse', deferredMain_pickAccount));
		
		return deferredMain_pickAccount.promise;
	},
	loadPage: function(aBtnId, aSrc, aClickSetName, aCallbackSetName, aLoadPageData) {
		// aLoadPageData should be aMultiAcctPickInfo (which is acct entry for one of the multiple accts found) is an object that has three  keys, uid and screenname and domElId or domElSelector . :todo: consider putting in domElSelector or domElId
		var deferredMain_loadPage = new Deferred();
	
		var promise_fhrResponse = (fhr_ifBtnIdNodata(aBtnId) || gEditorABData_Btn[aBtnId].getBtnFHR()).loadPage(aSrc, aClickSetName, aCallbackSetName, aLoadPageData);
		console.log('promise_fhrResponse:', promise_fhrResponse);
		promise_fhrResponse.then(
			function(aFHRResponse) {
				console.log('Fullfilled - promise_fhrResponse - ', aFHRResponse);
				deferredMain_loadPage.resolve([aFHRResponse]);
			},
			genericReject.bind(null, 'promise_fhrResponse', deferredMain_loadPage)
		).catch(genericCatch.bind(null, 'promise_fhrResponse', deferredMain_loadPage));
		
		return deferredMain_loadPage.promise;
	},
	extractData: function(aBtnId, aDataKeysArr) {
		// takes a copy from btn data object and sends to worker
		// if the key contains "arrbuf" it is transferred to worker
		// aDataKeysArr is a bunch an array of keys for which you want from data to worker
		
		var cSendData = {};
		var cTransfers = [];
		
		var cBtnData = gEditorABData_Btn[aBtnId].data;
		
		for (var i=0; i<aDataKeysArr.length; i++) {
			
			var cKey = aDataKeysArr[i];
			
			cSendData[cKey] = cBtnData[cKey];
			
			if (cKey.indexOf('arrbuf') > -1) {
				cTransfers.push(cBtnData[cKey]);
				cBtnData[cKey] = 'TRANSFERED'; // i dont have to do this, i just do this in case i look for this and go nuts when things dont work. i remember in past i had an arrbuf but it was transfered and so byteLength was 0 and i didnt realize it and was going nuts
			}
			
		}
		
		if (cTransfers.length) {
			console.log('extracting with transfer');
			return [cSendData, cTransfers, SIP_TRANS_WORD];
		} else {
			console.log('extracting as all copies');
			return [cSendData];
		}
	},
	putToData: function(aBtnId, aDataObj) {
		// aDataObj is merged into btn data
		var cBtnData = gEditorABData_Btn[aBtnId].data;
		for (var p in aDataObj) {
			cBtnData[p] = aDataObj[p];
			if (p == 'copyTxt' || p == 'dataurl') {
				ifEditorClosed_andBarHasOnlyOneAction_copyToClip(gEditorABData_Btn[aBtnId].sessionId);
			}
		}
		aDataObj = null;
		
		return ['ok'];
	},
	updateAttnBar: function(aBtnId, newBtnRefData) {
		// aId is the id of aABInfoObj
		// common keys in in newBtnRefData are added to the current BtnRef --- BtnRef is not set equal to newBtnRefData, hence the word "Data" in the param
		if(isBtnIdNoData(aBtnId)) {
			return false;
		}
		
		console.log('newBtnRefData:', newBtnRefData);
		
		var cBtnObj = gEditorABData_Btn[aBtnId];
		console.log('cBtnObj:', cBtnObj);
		
		if (cBtnObj.autoretryAborting) {
			// maybe a timeout message came through before the abort completed so ignore those
			return;
		}
		
		cBtnObj.setBtnState(newBtnRefData);		
	}
};
// end - MainWorkerMainThreadFuncs

function ifEditorClosed_andBarHasOnlyOneAction_copyToClip(aSessionId) {
	// copy to clipboard if there was only one btn for this bar
	// returns true, if yes
	var cBarData = gEditorABData_Bar[aSessionId];
	console.log('cBarData:', cBarData, 'shown:', cBarData.shown);
	if (cBarData.shown && cBarData.btnIds.length === 1) {
		// only one action done for this so copy it to clipboard,
		// and close bar within 10sec
		var onlyBtn = gEditorABData_Btn[cBarData.btnIds[0]];
		
		// show system notification
		if (onlyBtn.data.copyTxt) {
			copyTextToClip(onlyBtn.data.copyTxt);
			var alertNotifTitle = 'Copied to Clipboard';
			var alertNotifBody = 'Link copied to your clipboard';
			myServices.as.showAlertNotification(core.addon.path.images + 'icon48.png', justFormatStringFromName(core.addon.l10n.bootstrap['addon_name']) + ' - ' + alertNotifTitle, alertNotifBody, null, null, null, 'NativeShot');
		} else if (onlyBtn.data.result_txt && Object.keys(onlyBtn.data.result_txt).length === 1) {
			for (var p in onlyBtn.data.result_txt) {
				copyTextToClip(onlyBtn.data.result_txt[p]);
			}
			var alertNotifTitle = 'Copied to Clipboard';
			var alertNotifBody = 'Processed text copied to your clipboard';
			myServices.as.showAlertNotification(core.addon.path.images + 'icon48.png', justFormatStringFromName(core.addon.l10n.bootstrap['addon_name']) + ' - ' + alertNotifTitle, alertNotifBody, null, null, null, 'NativeShot');
		}
		
		// autoclose bar with message
		if (onlyBtn.data.copyTxt || onlyBtn.data.dataurl) { // these two keys signify completion
			autocloseBar(aSessionId, 'One action made so copied to clipboard');
		} else if (onlyBtn.data.result_txt) {
			autocloseBar(aSessionId, 'One action made so opened results tab');
		} else if (onlyBtn.data.tabWk) {
			autocloseBar(aSessionId, 'One action made so focused tab');
		}
		return true;
	} else {
		console.error('bar not yet shown');
	}
}

var gAutocloseBar = {};

function autocloseBar(aSessionId, aClosingMsg) {
	var cBarData = gEditorABData_Bar[aSessionId];
	console.log('cBarData:', cBarData, 'shown:', cBarData.shown);
	if (gAutocloseBar[aSessionId]) {
		return; // already in process of autoclose
	}
	if (cBarData.shown) {
		gAutocloseBar[aSessionId] = {
			timer: Cc['@mozilla.org/timer;1'].createInstance(Ci.nsITimer),
			timeLeft: 26, // sec, is really 25, because i timeLeft-- at start of notify
			callback: {
				notify: function() {
					if (AB.Callbacks[cBarData.ABRef.aId]) {
						// not yet closed
						gAutocloseBar[aSessionId].timeLeft--;
						if (gAutocloseBar[aSessionId].timeLeft === 0) {
							AB.Callbacks[cBarData.ABRef.aId]();
							delete gAutocloseBar[aSessionId];
						} else {
							cBarData.ABRef.aTxt = cBarData.ABRef.origATxt + ' - ' + aClosingMsg + ' and closing this bar in ' + gAutocloseBar[aSessionId].timeLeft + 's';
							AB.setState(cBarData.ABRef);
							gAutocloseBar[aSessionId].timer.initWithCallback(gAutocloseBar[aSessionId].callback, 1000, Ci.nsITimer.TYPE_ONE_SHOT);
						}
					} else {
						// user closed it out
						delete gAutocloseBar[aSessionId];
					}
				}
			}
		};
		
		cBarData.ABRef.origATxt = cBarData.ABRef.aTxt;
		cBarData.ABRef.aBtns.splice(0, 0, {
			customIdentifier: 'dont-autoclose',
			bTxt: 'Keep Bar Open', // :l10n:
			bClick: function() {
				gAutocloseBar[aSessionId].timer.cancel();
				delete gAutocloseBar[aSessionId];
				for (var i=0; i<this.inststate.aBtns.length; i++) {
					if (this.inststate.aBtns[i].customIdentifier && this.inststate.aBtns[i].customIdentifier == 'dont-autoclose') {
						this.inststate.aBtns.splice(i, 1);
						break;
					}
				}
				this.inststate.aTxt = this.inststate.origATxt;
				AB.setState(this.inststate);
			}
		});
		AB.setState(cBarData.ABRef);
		gAutocloseBar[aSessionId].timer.initWithCallback(gAutocloseBar[aSessionId].callback, 0, Ci.nsITimer.TYPE_ONE_SHOT);
	} else {
		console.error('bar not yet shown');
	}
}

var nodataBtnFhrs = {}; // key is nodataBtnId and value is the fhr
function fhr_ifBtnIdNodata(aBtnId) {
	if (typeof(aBtnId) == 'string' && aBtnId.indexOf('nodata:') === 0) {
		if (!nodataBtnFhrs[aBtnId]) {
			nodataBtnFhrs[aBtnId] = new FHR();
		}
		return nodataBtnFhrs[aBtnId];
	} else {
		return false;
	}
}

function destroy_nodataFhr(aNoDataBtnId) {
	nodataBtnFhrs[aNoDataBtnId].destroy();
	delete nodataBtnFhrs[aNoDataBtnId];
}
function isBtnIdNoData(aBtnId) {
	if (typeof(aBtnId) == 'string' && aBtnId.indexOf('nodata:') === 0) {
		return true;
	} else {
		return false;
	}
}
// start - main framescript communication - rev3 https://gist.github.com/Noitidart/03c84a4fc1e566bd0fe5
var fsFuncs = { // can use whatever, but by default its setup to use this
	callInPromiseWorker: function(aArrOfFuncnameThenArgs) {
		// for use with sendAsyncMessageWithCallback from framescripts
		
		var mainDeferred_callInPromiseWorker = new Deferred();
		
		var rez_pwcall = MainWorker.post(aArrOfFuncnameThenArgs.shift(), aArrOfFuncnameThenArgs);
		rez_pwcall.then(
			function(aVal) {
				console.log('Fullfilled - rez_pwcall - ', aVal);
				if (Array.isArray(aVal)) {
					mainDeferred_callInPromiseWorker.resolve(aVal);
				} else {
					mainDeferred_callInPromiseWorker.resolve([aVal]);
				}
			},
			function(aReason) {
				var rejObj = {
					name: 'rez_pwcall',
					aReason: aReason
				};
				console.error('Rejected - rez_pwcall - ', rejObj);
				mainDeferred_callInPromiseWorker.resolve([rejObj]);
			}
		).catch(
			function(aCaught) {
				var rejObj = {
					name: 'rez_pwcall',
					aCaught: aCaught
				};
				console.error('Caught - rez_pwcall - ', rejObj);
				mainDeferred_callInPromiseWorkerr.resolve([rejObj]);
			}
		);
		
		return mainDeferred_callInPromiseWorker.promise;
	},
	callInBootstrap: function(aArrOfFuncnameThenArgs) {
		// for use with sendAsyncMessageWithCallback from framescripts
		
		var mainDeferred_callInBootstrap = new Deferred();
		
		var cBootMethod = aArrOfFuncnameThenArgs.shift();
		if (!(cBootMethod in BOOTSTRAP)) {
			console.error('method is not in bootstrap! cBootMethod:', cBootMethod);
			throw new Error('method is not in bootstrap!');
		}
		var rez_pwcall = BOOTSTRAP[cBootMethod].apply(null, aArrOfFuncnameThenArgs);
		if (rez_pwcall && rez_pwcall.constructor.name == 'Promise') { // rez_pwcall may be undefined if it didnt return a promise
			rez_pwcall.then(
				function(aVal) {
					console.log('Fullfilled - rez_pwcall - ', aVal);
					if (Array.isArray(aVal)) {
						mainDeferred_callInBootstrap.resolve(aVal);
					} else {
						mainDeferred_callInBootstrap.resolve([aVal]);
					}
				},
				function(aReason) {
					var rejObj = {
						name: 'rez_pwcall',
						aReason: aReason
					};
					console.error('Rejected - rez_pwcall - ', rejObj);
					mainDeferred_callInBootstrap.resolve([rejObj]);
				}
			).catch(
				function(aCaught) {
					var rejObj = {
						name: 'rez_pwcall',
						aCaught: aCaught
					};
					console.error('Caught - rez_pwcall - ', rejObj);
					mainDeferred_callInBootstrapr.resolve([rejObj]);
				}
			);
		} else {
			if (Array.isArray(rez_pwcall)) {
				mainDeferred_callInBootstrap.resolve(rez_pwcall);
			} else {
				mainDeferred_callInBootstrap.resolve([rez_pwcall]);
			}
		}
		
		return mainDeferred_callInBootstrap.promise;
	},
	getOcrResults: function(aBtnId, aMsgEvent) {
		console.log('in bootstrap getOcrResults for:', aBtnId);
		var cBtnStore = gEditorABData_Btn[aBtnId];
		if (!cBtnStore || !cBtnStore.data || !cBtnStore.data.result_txt) {
			aMsgEvent.target.contentWindow.postMessage({
				topic: 'reactOcrResults',
				error: 'Data not found for this ID' // :l10n:
			}, '*');
		} else {
			var clonedArrBuf = cBtnStore.data.arrbuf.slice();
			aMsgEvent.target.contentWindow.postMessage({
				topic: 'reactOcrResults',
				arrbuf: clonedArrBuf,
				width: cBtnStore.data.width,
				height: cBtnStore.data.height,
				result_txt: cBtnStore.data.result_txt
			}, '*', [clonedArrBuf]);
		}
	}
};

MainWorkerMainThreadFuncs.callInBootstrap = fsFuncs.callInBootstrap;
// MainWorkerMainThreadFuncs.callInBootstrap = fsFuncs.callInPromiseWorker;

HotkeyWorkerMainThreadFuncs.callInBootstrap = fsFuncs.callInBootstrap;

var fsMsgListener = {
	funcScope: fsFuncs,
	receiveMessage: function(aMsgEvent) {
		var aMsgEventData = aMsgEvent.data;
		console.log('fsMsgListener getting aMsgEventData:', aMsgEventData, 'aMsgEvent:', aMsgEvent);
		// aMsgEvent.data should be an array, with first item being the unfction name in bootstrapCallbacks
		
		var callbackPendingId;
		if (typeof aMsgEventData[aMsgEventData.length-1] == 'string' && aMsgEventData[aMsgEventData.length-1].indexOf(SAM_CB_PREFIX) == 0) {
			callbackPendingId = aMsgEventData.pop();
		}
		
		aMsgEventData.push(aMsgEvent); // this is special for server side, so the function can do aMsgEvent.target.messageManager to send a response
		
		var funcName = aMsgEventData.shift();
		if (funcName in this.funcScope) {
			var rez_parentscript_call = this.funcScope[funcName].apply(null, aMsgEventData);
			
			if (callbackPendingId) {
				// rez_parentscript_call must be an array or promise that resolves with an array
				if (rez_parentscript_call.constructor.name == 'Promise') {
					rez_parentscript_call.then(
						function(aVal) {
							// aVal must be an array
							aMsgEvent.target.messageManager.sendAsyncMessage(core.addon.id, [callbackPendingId, aVal]);
						},
						function(aReason) {
							console.error('aReject:', aReason);
							aMsgEvent.target.messageManager.sendAsyncMessage(core.addon.id, [callbackPendingId, ['promise_rejected', aReason]]);
						}
					).catch(
						function(aCatch) {
							console.error('aCatch:', aCatch);
							aMsgEvent.target.messageManager.sendAsyncMessage(core.addon.id, [callbackPendingId, ['promise_rejected', aCatch]]);
						}
					);
				} else {
					// assume array
					aMsgEvent.target.messageManager.sendAsyncMessage(core.addon.id, [callbackPendingId, rez_parentscript_call]);
				}
			}
		}
		else { console.warn('funcName', funcName, 'not in scope of this.funcScope') } // else is intentionally on same line with console. so on finde replace all console. lines on release it will take this out
		
	}
};
// end - main framescript communication

function install() {}
function uninstall(aData, aReason) {
	// Services.prompt.alert(Services.wm.getMostRecentWindow('navigator:browser'), 'uninstall', aReason);
	
	// delete imgur history file
	if (aReason == ADDON_UNINSTALL) {
		Services.prefs.clearUserPref(core.addon.prefbranch + 'quick_save_dir');
		Services.prefs.clearUserPref(core.addon.prefbranch + 'print_preview');
		Services.prefs.clearUserPref(core.addon.prefbranch + 'system_hotkey');

		if (aReason == ADDON_UNINSTALL) {
			var deleteLog = Services.prompt.confirmEx(Services.wm.getMostRecentWindow('navigator:browser'), 'NativeShot Uninstalling - Delete Log?', 'The data shown in your dashboard (about:nativeshot) is saved in a log file. Would you like do delete this?\n\nOnly reason to keep it, is if you think you will install NativeShot again in the future, and will want the delete URLs for your uploaded images.', Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_IS_STRING + Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_IS_STRING, 'Delete Log', 'Keep Log', '', null, {value: false});
			if (deleteLog === 0) {
				OS.File.removeDir(OS.Path.join(OS.Constants.Path.profileDir, 'jetpack', core.addon.id), {
					ignoreAbsent: true,
					ignorePermissions: true
				});
			}
		}
	}
}

function startup(aData, aReason) {
	// core.addon.aData = aData;
	extendCore();
	
	// start - add stuff to core that worker cannot get
	
	// end - add stuff to core that worker cannot get
	
	SIPWorker('ScreenshotWorker', core.addon.path.content + 'modules/screenshot/ScreenshotWorker.js'); // if want instant init, tag on .post() and it will return a promise resolving with value from init

	var do_afterWorkerInit = function(aInitedCore) {
		
		core = aInitedCore;
		gEditorStateStr = core.editorstateStr;
		delete core.editorstateStr;
		
		CustomizableUI.createWidget({
			id: 'cui_nativeshot',
			defaultArea: CustomizableUI.AREA_NAVBAR,
			label: justFormatStringFromName(core.addon.l10n.bootstrap['cui_nativeshot_lbl']),
			tooltiptext: justFormatStringFromName(core.addon.l10n.bootstrap['cui_nativeshot_tip']),
			onCommand: function(aEvent) {
				var aDOMWin = aEvent.target.ownerDocument.defaultView;
				if (aEvent.shiftKey == 1) {
					// default time delay queue
					if (gDelayedShotObj) {
						// there is a count down currently running
						gDelayedShotObj.time_left += delayedShotTimePerClick;
						// gDelayedShotObj.timer.cancel();
						delayedShotUpdateBadges();
						// so user wants to add 5 mroe sec to countdown
					} else {
						gDelayedShotObj = {
							time_left: delayedShotTimePerClick,
							timer: Cc['@mozilla.org/timer;1'].createInstance(Ci.nsITimer)
						};
						delayedShotUpdateBadges();
						gDelayedShotObj.timer.initWithCallback(delayedShotTimerCallback, 1000, Ci.nsITimer.TYPE_ONE_SHOT);
					}
				} else {
					if (gDelayedShotObj) {
						cancelAndCleanupDelayedShot();
					}
					// imemdiate freeze
					shootAllMons(aDOMWin);
				}
			}
		});
		
		contextMenuBootstrapStartup();
		
		// determine gCuiCssFilename for windowListener.register
		if (Services.prefs.getCharPref('app.update.channel') == 'aurora') {
			if (core.os.mname != 'darwin') {
				// i didnt test dev edition on winxp, not sure what it is there
				gCuiCssFilename = 'cui_dev.css';
			} else {
				gCuiCssFilename = 'cui_dev_mac.css';
			}
		} else {
			if (core.os.mname == 'darwin') {
				gCuiCssFilename = 'cui_mac.css';
			} else if (core.os.mname == 'gtk') {
				gCuiCssFilename = 'cui_gtk.css';
			} else {
				// windows
				if (core.os.version <= 5.2) {
					// xp
					gCuiCssFilename = 'cui_gtk.css';
				} else {
					gCuiCssFilename = 'cui.css';
				}
			}
		}
		
		//windowlistener more
		windowListener.register();
		//end windowlistener more
		
		initAndRegisterAbout();
		
		AB.init();
		
		Services.mm.addMessageListener(core.addon.id, fsMsgListener);
		
		if (prefGet('system_hotkey')) {
			initHotkey();
		}
	};
	
	var do_afterPrefsInit = function() {
		var promise_getInit = SIPWorker('MainWorker', core.addon.path.content + 'modules/main/MainWorker.js', core, MainWorkerMainThreadFuncs).post();
		promise_getInit.then(
			function(aVal) {
				console.log('Fullfilled - promise_getInit - ', aVal);
				do_afterWorkerInit(aVal);
			},
			genericReject.bind(null, 'promise_getInit', 0)
		).catch(genericCatch.bind(null, 'promise_getInit', 0));
	};
	
	// set stuff in core, as it is sent to worker
	core.addon.version = aData.version;
	var promise_initPrefs = refreshCoreForPrefs();
	
	
	promise_initPrefs.then(
		function(aVal) {
			console.log('Fullfilled - promise_initPrefs - ', aVal);
			do_afterPrefsInit();
		},
		genericReject.bind(null, 'promise_initPrefs', 0)
	).catch(genericCatch.bind(null, 'promise_initPrefs', 0));
}

function shutdown(aData, aReason) {
	if (aReason == APP_SHUTDOWN) { return }
	
	try {
		myServices.mm.removeMessageListener(core.addon.id + '_twitter', fsComServer.twitterClientMessageListener); // in case its still alive which it very well could be, because user may disable during tweet process // :todo: should probably clear all notfication bars maybe
	} catch (ignore) {}
	
	CustomizableUI.destroyWidget('cui_nativeshot');
	
	AB.uninit();
	AB.Callbacks = {}; // so the autoclosers know not to keep trying
	
	//windowlistener more
	windowListener.unregister();
	//end windowlistener more
	
	// clear intervals if any are pending
	if (gDelayedShotObj) {
		cancelAndCleanupDelayedShot();
	}
	
	if (gPostPrintRemovalFunc) { // poor choice of clean up for post print, i need to be able to find a place that triggers after print to file, and also after if they dont print to file, if iframe is not there, then print to file doesnt work
		gPostPrintRemovalFunc();
	}
	
	aboutFactory_instance.unregister();
	
	// destroy workers
	if (ScreenshotWorker && ScreenshotWorker.launchTimeStamp) { // as when i went to rev5, its not insantly inited, so there is a chance that it doesnt need terminate
		ScreenshotWorker._worker.terminate();
	}
	if (MainWorker && MainWorker.launchTimeStamp) {
		MainWorker._worker.terminate();
	}

	if (bootstrap.GOCRWorker && GOCRWorker.launchTimeStamp) {
		GOCRWorker._worker.terminate();
	}
	
	if (bootstrap.OCRADWorker && OCRADWorker.launchTimeStamp) {
		OCRADWorker._worker.terminate();
	}
	
	if (bootstrap.TesseractWorker && TesseractWorker.launchTimeStamp) {
		TesseractWorker._worker.terminate();
	}
	
	uninitHotkey();
	
	// destroy any FHR's that the devuser did not clean up
	for (var DSTR_I=0; DSTR_I<gFHR.length; DSTR_I++) {
		if (gFHR[DSTR_I].destroy) {
			console.log('destroying gFHR DSTR_I:', DSTR_I);
			gFHR[DSTR_I].destroy();
			console.log('DSTR_I after destroy:', DSTR_I);
			DSTR_I--; // because .destroy splices it out of gFHR i do a .forEach, otherwise i have to do i--. but .destroy uses i so im worried theres scoping issues here so i switched to DSTR_I
		}
	}
	
	Services.mm.removeMessageListener(core.addon.id, fsMsgListener);
	
	// Services.prompt.alert(Services.wm.getMostRecentWindow('navigator:browser'), 'shutdown', aReason);

}

// start - custom addon functionalities
function openRelatedTab(aUrl) {
	Services.wm.getMostRecentWindow('navigator:browser').gBrowser.loadOneTab(aUrl, {
		inBackground: false,
		relatedToCurrent: true
	});
}

// rev3 - https://gist.github.com/Noitidart/feeec1776c6ee4254a34
function showFileInOSExplorer(aNsiFile, aDirPlatPath, aFileName) {
	// can pass in aNsiFile
	if (aNsiFile) {
		//http://mxr.mozilla.org/mozilla-release/source/browser/components/downloads/src/DownloadsCommon.jsm#533
		// opens the directory of the aNsiFile
		
		if (aNsiFile.isDirectory()) {
			aNsiFile.launch();
		} else {
			aNsiFile.reveal();
		}
	} else {
		var cNsiFile = new nsIFile(aDirPlatPath);
		
		if (!aFileName) {
			// its a directory
			cNsiFile.launch();
		} else {
			cNsiFile.append(aFileName);
			cNsiFile.reveal();
		}
	}
}

function browseFile(aDialogTitle, aOptions={}) {
	// uses xpcom file browser and returns path to file selected
	// returns
		// filename
		// if aOptions.returnDetails is true, then it returns object with fields:
		//	{
		//		filepath: string,
		//		replace: bool, // only set if mode is modeSave
		//	}
	
	var cOptionsDefaults = {
		mode: 'modeOpen', // modeSave, modeGetFolder,
		filters: undefined, // else an array. in sets of two. so one filter would be ['PNG', '*.png'] or two filters woul be ['PNG', '*.png', 'All Files', '*']
		startDirPlatPath: undefined, // string - platform path to dir the dialog should start in
		returnDetails: false,
		async: false, // if set to true, then it wont block main thread while its open, and it will also return a promise
		win: undefined // null for no parentWin, string for what you want passed to getMostRecentWindow, or a window object. NEGATIVE is special for NativeShot, it is negative iMon
	}
	
	validateOptionsObj(aOptions, cOptionsDefaults);
	
	var fp = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
	
	var parentWin;
	if (aOptions.win === undefined) {
		parentWin = null;
	} else if (typeof(aOptions.win) == 'number') {
		// sepcial for nativeshot
		parentWin = colMon[Math.abs(aOptions.win)].E.DOMWindow;
	} else if (aOptions.win === null || typeof(aOptions.win) == 'string') {
		parentWin = Services.wm.getMostRecentWindow(aOptions.win);
	} else {
		parentWin = aOptions.win; // they specified a window probably
	}
	fp.init(parentWin, aDialogTitle, Ci.nsIFilePicker[aOptions.mode]);
	
	if (aOptions.filters) {
		for (var i=0; i<aOptions.filters.length; i=i+2) {
			fp.appendFilter(aOptions.filters[i], aOptions.filters[i+1]);
		}
	}
	
	if (aOptions.startDirPlatPath) {
		fp.displayDirectory = new nsIFile(aOptions.startDirPlatPath);
	}
	
	var fpDoneCallback = function(rv) {
		var retFP;
		if (rv == Ci.nsIFilePicker.returnOK || rv == Ci.nsIFilePicker.returnReplace) {
			
			if (aOptions.returnDetails) {
				var cBrowsedDetails = {
					filepath: fp.file.path
				};
				
				if (aOptions.mode == 'modeSave') {
					cBrowsedDetails.replace = (rv == Ci.nsIFilePicker.returnReplace);
				}
				
				retFP = cBrowsedDetails;
			} else {
				retFP = fp.file.path;
			}

		}// else { // cancelled	}
		if (aOptions.async) {
			console.error('async resolving');
			mainDeferred_browseFile.resolve(retFP);
		} else {
			return retFP;
		}
	}
	
	if (aOptions.async) {
		var mainDeferred_browseFile = new Deferred();
		fp.open({
			done: fpDoneCallback
		});
		return mainDeferred_browseFile.promise;
	} else {
		return fpDoneCallback(fp.show());
	}
}

function macSetLevelOfBrowseFile() {
	// can use setLevel and OSStuff.NSMainMenuWindowLevel because this only ever triggers after link98476884 runs for sure for sure
	console.error('in macSetLevelOfBrowseFile');
	/*
	var cWin = Services.wm.getMostRecentWindow(null);
	try {
		var cWinType = cWin.document.documentElement.getAttribute('windowtype');
		console.error('cWinType:', cWinType);
	} catch(ignore) {}
	try {
		var cWinTitle = cWin.document.documentElement.getAttribute('title');
		console.error('cWinTitle:', cWinTitle);
	} catch(ignore) {}
	
	var NSWindowString = getNativeHandlePtrStr(Services.wm.getMostRecentWindow(null));

								
	var NSWindowPtr = ostypes.TYPE.NSWindow(ctypes.UInt64(NSWindowString));
	*/
	
	var sharedApp = ostypes.API('objc_msgSend')(ostypes.HELPER.class('NSApplication'), ostypes.HELPER.sel('sharedApplication'));
	console.log('sharedApp:', sharedApp, sharedApp.toString(), uneval(sharedApp));
	
	var rez_keyWin = ostypes.API('objc_msgSend')(sharedApp, ostypes.HELPER.sel('keyWindow'));
	console.log('rez_keyWin:', rez_keyWin, rez_keyWin.toString(), uneval(rez_keyWin));
	if (rez_keyWin.isNull()) {
		console.error('no keyWindow yet, apparently its possible, im guessing maybe while the window is opening, im not sure but just to be safe wait a bit and call again');
		Services.wm.getMostRecentWindow('navigator:browser').setTimeout(macSetLevelOfBrowseFile, 100);
		return;
	}
	
	var rez_title = ostypes.API('objc_msgSend')(rez_keyWin, ostypes.HELPER.sel('title'));
	console.log('rez_title:', rez_title, rez_title.toString(), uneval(rez_title));

	var cWinTitle = ostypes.HELPER.readNSString(rez_title); // cCharPtr.readString(); // :note: // link123111119 i do read string, so the text i open browseFile with should be readable by this
	console.log('cWinTitle:', cWinTitle);
	
	if (cWinTitle != core.addon.l10n.bootstrap['filepicker-title-save-screenshot']) {
		console.error('keyWindow is not the browse file picker dialog yet so try again in a bit');
		Services.wm.getMostRecentWindow('navigator:browser').setTimeout(macSetLevelOfBrowseFile, 100);
		return;
	} else {	
		var rez_setLevel = ostypes.API('objc_msgSend')(rez_keyWin, ostypes.HELPER.sel('setLevel:'), ostypes.TYPE.NSInteger(OSStuff.NSMainMenuWindowLevel + 1)); // i guess 0 is NSNormalWindowLevel // link98476884 // link847455111
		console.log('rez_setLevel:', rez_setLevel, rez_setLevel.toString(), uneval(rez_setLevel));
	}
	console.error('done macSetLevelOfBrowseFile');
	
	// in my tests, i didnt need to every wait, as keyWindow was set and it was the picker
}

function NBs_updateGlobal_updateTwitterBtn(aUAPEntry, newLabel, newClass, newAction) {
	// update twitter btn label, class, and action, because i do this so much
	
	// get notif bar id, as crossWinId
	var crossWinId = aUAPEntry.gEditorSessionId + '-twitter';
	// get the buttons infos in this notif bar
	var aBtnInfos = NBs.crossWin[crossWinId].btns;
	
	// find our specific btninfo for this tab
	var aBtnInfo;
	for (var i=0; i<aBtnInfos.length; i++) {
		if (aBtnInfos[i].btn_id == aUAPEntry.userAckId) {
			aBtnInfo = aBtnInfos[i];
			break;
		}
	}
	
	if (!aBtnInfo) {
		throw new Error('couldnt find btn info for this tab, this should never happen');
	}
	
	if (!NBs.crossWin[crossWinId].afterOfficialInit_completedCustInit) {
		// item hasnt been inserted to dom yet, so keep the -ID on it
		newLabel += '-ID:' + aUAPEntry.userAckId;
	}
	aBtnInfo.label = newLabel;
	aBtnInfo.class = newClass;
	aUAPEntry.actionOnBtn = newAction;

	
	NBs.updateGlobal(crossWinId, {
		lbl: 1, // label was updated for sure
		btns:{
			label: [aUAPEntry.userAckId], // arr of btn ids that need updating
			class: [aUAPEntry.userAckId] // arr of btn ids that need updating
		}
	});
}

function broadcastToMainGuisToUpdate() {
	myServices.mm.broadcastAsyncMessage(core.addon.id, ['serverCommand_refreshDashboardGuiFromFile']);
}

function addEntryToLog(aTypeStr, aData={}) {
	var promise_appendLog = MainWorker.post('addEntryToLog', [aTypeStr, aData]);
	promise_appendLog.then(
		function(aVal) {
			console.log('Fullfilled - promise_appendLog - ', aVal);
		},
		genericReject.bind(null, 'promise_appendLog', 0)
	).catch(genericCatch.bind(null, 'promise_appendLog', 0));
}
// end - custom addon functionalities

// start - common helper functions
function isFocused(window) {
    let childTargetWindow = {};
    Services.focus.getFocusedElementForWindow(window, true, childTargetWindow);
    childTargetWindow = childTargetWindow.value;

    let focusedChildWindow = {};
    if (Services.focus.activeWindow) {
        Services.focus.getFocusedElementForWindow(Services.focus.activeWindow, true, focusedChildWindow);
        focusedChildWindow = focusedChildWindow.value;
    }

    return (focusedChildWindow === childTargetWindow);
}
// rev3 - https://gist.github.com/Noitidart/326f1282c780e3cb7390
function Deferred() {
	// update 062115 for typeof
	if (typeof(Promise) != 'undefined' && Promise.defer) {
		//need import of Promise.jsm for example: Cu.import('resource:/gree/modules/Promise.jsm');
		return Promise.defer();
	} else if (typeof(PromiseUtils) != 'undefined'  && PromiseUtils.defer) {
		//need import of PromiseUtils.jsm for example: Cu.import('resource:/gree/modules/PromiseUtils.jsm');
		return PromiseUtils.defer();
	} else {
		/* A method to resolve the associated Promise with the value passed.
		 * If the promise is already settled it does nothing.
		 *
		 * @param {anything} value : This value is used to resolve the promise
		 * If the value is a Promise then the associated promise assumes the state
		 * of Promise passed as value.
		 */
		this.resolve = null;

		/* A method to reject the assocaited Promise with the value passed.
		 * If the promise is already settled it does nothing.
		 *
		 * @param {anything} reason: The reason for the rejection of the Promise.
		 * Generally its an Error object. If however a Promise is passed, then the Promise
		 * itself will be the reason for rejection no matter the state of the Promise.
		 */
		this.reject = null;

		/* A newly created Pomise object.
		 * Initially in pending state.
		 */
		this.promise = new Promise(function(resolve, reject) {
			this.resolve = resolve;
			this.reject = reject;
		}.bind(this));
		Object.freeze(this);
	}
}

// SIPWorker - rev9 - https://gist.github.com/Noitidart/92e55a3f7761ed60f14c
const SIP_CB_PREFIX = '_a_gen_cb_';
const SIP_TRANS_WORD = '_a_gen_trans_';
var sip_last_cb_id = -1;
function SIPWorker(workerScopeName, aPath, aCore=core, aFuncExecScope=BOOTSTRAP) {
	// update 022016 - delayed init till first .post
	// update 010516 - allowing pomiseworker to execute functions in this scope, supply aFuncExecScope, else leave it undefined and it will not set this part up
	// update 122115 - init resolves the deferred with the value returned from Worker, rather then forcing it to resolve at true
	// "Start and Initialize PromiseWorker"
	// returns promise
		// resolve value: jsBool true
	// aCore is what you want aCore to be populated with
	// aPath is something like `core.addon.path.content + 'modules/workers/blah-blah.js'`
	
	// :todo: add support and detection for regular ChromeWorker // maybe? cuz if i do then ill need to do ChromeWorker with callback
	
	// var deferredMain_SIPWorker = new Deferred();

	var cWorkerInited = false;
	var cWorkerPost_orig;
	
	if (!(workerScopeName in bootstrap)) {
		bootstrap[workerScopeName] = new PromiseWorker(aPath);
		
		cWorkerPost_orig = bootstrap[workerScopeName].post;
		
		bootstrap[workerScopeName].post = function(pFun, pArgs, pCosure, pTransfers) {
			if (!cWorkerInited) {
				var deferredMain_post = new Deferred();
				
				bootstrap[workerScopeName].post = cWorkerPost_orig;
				
				var doInit = function() {
					var promise_initWorker = bootstrap[workerScopeName].post('init', [aCore]);
					promise_initWorker.then(
						function(aVal) {
							console.log('Fullfilled - promise_initWorker - ', aVal);
							// start - do stuff here - promise_initWorker
							if (pFun) {
								doOrigPost();
							} else {
								// pFun is undefined, meaning devuser asked for instant init
								deferredMain_post.resolve(aVal);
							}
							// end - do stuff here - promise_initWorker
						},
						genericReject.bind(null, 'promise_initWorker', deferredMain_post)
					).catch(genericCatch.bind(null, 'promise_initWorker', deferredMain_post));
				};
				
				var doOrigPost = function() {
					var promise_origPosted = bootstrap[workerScopeName].post(pFun, pArgs, pCosure, pTransfers);
					promise_origPosted.then(
						function(aVal) {
							console.log('Fullfilled - promise_origPosted - ', aVal);
							deferredMain_post.resolve(aVal);
						},
						genericReject.bind(null, 'promise_origPosted', deferredMain_post)
					).catch(genericCatch.bind(null, 'promise_origPosted', deferredMain_post));
				};
				
				doInit();
				return deferredMain_post.promise;
			}
		};
		
		// start 010516 - allow worker to execute functions in bootstrap scope and get value
		if (aFuncExecScope) {
			// this triggers instantiation of the worker immediately
			var origOnmessage = bootstrap[workerScopeName]._worker.onmessage;
			var origOnerror = bootstrap[workerScopeName]._worker.onerror;
			
			bootstrap[workerScopeName]._worker.onerror = function(onErrorEvent) {
				// got an error that PromiseWorker did not know how to serialize. so we didnt get a {fail:.....} postMessage. so in onerror it does pop of the deferred. however with allowing promiseworker to return async, we cant simply pop if there are more then 1 promises pending
				var cQueue = bootstrap[workerScopeName]._queue._array;
				if (cQueue.length === 1) {
					// console.log('its fine for origOnerror it will just pop the only one there, which is the one to reject for sure as there are no other promises');
					// DO NOTE THOUGH - .onerror message might come in from any error, it is innate to worker to send this message on error, so it will pop out the promise early, so maybe i might run this origOnerror before the actual promise rejects due to catch
					origOnerror(onErrorEvent);
				} else {
					onErrorEvent.preventDefault(); // as they do this in origOnerror so i prevent here too
					console.error('queue has more then one promises in there, i dont know which one to reject', 'onErrorEvent:', onErrorEvent, 'queue:', bootstrap[workerScopeName]._queue._array);
				}
			};
			
			bootstrap[workerScopeName]._worker.onmessage = function(aMsgEvent) {
				////// start - my custom stuff
				var aMsgEventData = aMsgEvent.data;
				console.log('promiseworker receiving msg:', aMsgEventData);
				if (Array.isArray(aMsgEventData)) {
					// my custom stuff, PromiseWorker did self.postMessage to call a function from here
					console.log('promsieworker is trying to execute function in mainthread');
					
					var callbackPendingId;
					if (typeof aMsgEventData[aMsgEventData.length-1] == 'string' && aMsgEventData[aMsgEventData.length-1].indexOf(SIP_CB_PREFIX) == 0) {
						callbackPendingId = aMsgEventData.pop();
					}
					
					var funcName = aMsgEventData.shift();
					if (funcName in aFuncExecScope) {
						var rez_mainthread_call = aFuncExecScope[funcName].apply(null, aMsgEventData);
						
						if (callbackPendingId) {
							if (rez_mainthread_call.constructor.name == 'Promise') { // if get undefined here, that means i didnt return an array from the function in main thread that the worker called
								rez_mainthread_call.then(
									function(aVal) {
										if (aVal.length >= 2 && aVal[aVal.length-1] == SIP_TRANS_WORD && Array.isArray(aVal[aVal.length-2])) {
											// to transfer in callback, set last element in arr to SIP_TRANS_WORD and 2nd to last element an array of the transferables									// cannot transfer on promise reject, well can, but i didnt set it up as probably makes sense not to
											console.error('doing transferrrrr');
											aVal.pop();
											bootstrap[workerScopeName]._worker.postMessage([callbackPendingId, aVal], aVal.pop());
										} else {
											bootstrap[workerScopeName]._worker.postMessage([callbackPendingId, aVal]);
										}
									},
									function(aReason) {
										console.error('aReject:', aReason);
										bootstrap[workerScopeName]._worker.postMessage([callbackPendingId, ['promise_rejected', aReason]]);
									}
								).catch(
									function(aCatch) {
										console.error('aCatch:', aCatch);
										bootstrap[workerScopeName]._worker.postMessage([callbackPendingId, ['promise_rejected', aCatch]]);
									}
								);
							} else {
								// assume array
								if (rez_mainthread_call.length > 2 && rez_mainthread_call[rez_mainthread_call.length-1] == SIP_TRANS_WORD && Array.isArray(rez_mainthread_call[rez_mainthread_call.length-2])) {
									// to transfer in callback, set last element in arr to SIP_TRANS_WORD and 2nd to last element an array of the transferables									// cannot transfer on promise reject, well can, but i didnt set it up as probably makes sense not to
									rez_mainthread_call.pop();
									console.log('doiing traansfer');
									bootstrap[workerScopeName]._worker.postMessage([callbackPendingId, rez_mainthread_call], rez_mainthread_call.pop());
								} else {
									bootstrap[workerScopeName]._worker.postMessage([callbackPendingId, rez_mainthread_call]);
								}
							}
						}
					}
					else { console.error('funcName', funcName, 'not in scope of aFuncExecScope') } // else is intentionally on same line with console. so on finde replace all console. lines on release it will take this out
					////// end - my custom stuff
				} else {
					// find the entry in queue that matches this id, and move it to first position, otherwise i get the error `Internal error: expecting msg " + handler.id + ", " + " got " + data.id + ` --- this guy uses pop and otherwise might get the wrong id if i have multiple promises pending
					var cQueue = bootstrap[workerScopeName]._queue._array;
					var cQueueItemFound;
					for (var i=0; i<cQueue.length; i++) {
						if (cQueue[i].id == aMsgEvent.data.id) {
							cQueueItemFound = true;
							if (i !== 0) {
								// move it to first position
								var wasQueue = cQueue.slice(); // console.log('remove on production');
								cQueue.splice(0, 0, cQueue.splice(i, 1)[0]);
								console.log('ok moved q item from position', i, 'to position 0, this should fix that internal error, aMsgEvent.data.id:', aMsgEvent.data.id, 'queue is now:', cQueue, 'queue was:', wasQueue);
							}
							else { console.log('no need to reorder queue, the element of data.id:', aMsgEvent.data.id, 'is already in first position:', bootstrap[workerScopeName]._queue._array); }
							break;
						}
					}
					if (!cQueueItemFound) {
						console.error('errrrror: how on earth can it not find the item with this id in the queue? i dont throw here as the .pop will throw the internal error, aMsgEvent.data.id:', aMsgEvent.data.id, 'cQueue:', cQueue);
					}
					origOnmessage(aMsgEvent);
				}
			}
		}
		// end 010516 - allow worker to execute functions in bootstrap scope and get value
		
		if ('addon' in aCore && 'aData' in aCore.addon) {
			delete aCore.addon.aData; // we delete this because it has nsIFile and other crap it, but maybe in future if I need this I can try JSON.stringify'ing it
		}
	} else {
		throw new Error('Something is loaded into bootstrap[workerScopeName] already');
	}
	
	// return deferredMain_SIPWorker.promise;
	return bootstrap[workerScopeName];
	
}

// SICWorker - rev8 - https://gist.github.com/Noitidart/6a9da3589e88cc3df7e7
const SIC_CB_PREFIX = '_a_gen_cb_';
const SIC_TRANS_WORD = '_a_gen_trans_';
var sic_last_cb_id = -1;
function SICWorker(workerScopeName, aPath, aFuncExecScope=bootstrap, aCore=core) {
	// creates a global variable in bootstrap named workerScopeName which will hold worker, do not set up a global for it like var Blah; as then this will think something exists there
	// aScope is the scope in which the functions are to be executed
	// ChromeWorker must listen to a message of 'init' and on success of it, it should sendMessage back saying aMsgEvent.data == {aTopic:'init', aReturn:true}
	// "Start and Initialize ChromeWorker" // based on SIPWorker
	// returns promise
		// resolve value: jsBool true
	// aCore is what you want aCore to be populated with
	// aPath is something like `core.addon.path.content + 'modules/workers/blah-blah.js'`	
	var deferredMain_SICWorker = new Deferred();

	if (!(workerScopeName in bootstrap)) {
		bootstrap[workerScopeName] = new ChromeWorker(aPath);
		
		if ('addon' in aCore && 'aData' in aCore.addon) {
			delete aCore.addon.aData; // we delete this because it has nsIFile and other crap it, but maybe in future if I need this I can try JSON.stringify'ing it
		}
		
		var afterInitListener = function(aMsgEvent) {
			// note:all msgs from bootstrap must be postMessage([nameOfFuncInWorker, arg1, ...])
			var aMsgEventData = aMsgEvent.data;
			console.log('mainthread receiving message:', aMsgEventData);
			
			// postMessageWithCallback from worker to mt. so worker can setup callbacks after having mt do some work
			var callbackPendingId;
			if (typeof aMsgEventData[aMsgEventData.length-1] == 'string' && aMsgEventData[aMsgEventData.length-1].indexOf(SIC_CB_PREFIX) == 0) {
				callbackPendingId = aMsgEventData.pop();
			}
			
			var funcName = aMsgEventData.shift();
			
			if (funcName in aFuncExecScope) {
				var rez_mainthread_call = aFuncExecScope[funcName].apply(null, aMsgEventData);
				
				if (callbackPendingId) {
					if (rez_mainthread_call.constructor.name == 'Promise') {
						rez_mainthread_call.then(
							function(aVal) {
								if (aVal.length >= 2 && aVal[aVal.length-1] == SIC_TRANS_WORD && Array.isArray(aVal[aVal.length-2])) {
									// to transfer in callback, set last element in arr to SIC_TRANS_WORD and 2nd to last element an array of the transferables									// cannot transfer on promise reject, well can, but i didnt set it up as probably makes sense not to
									console.error('doing transferrrrr');
									aVal.pop();
									bootstrap[workerScopeName].postMessage([callbackPendingId, aVal], aVal.pop());
								} else {
									bootstrap[workerScopeName].postMessage([callbackPendingId, aVal]);
								}
							},
							function(aReason) {
								console.error('aReject:', aReason);
								bootstrap[workerScopeName].postMessage([callbackPendingId, ['promise_rejected', aReason]]);
							}
						).catch(
							function(aCatch) {
								console.error('aCatch:', aCatch);
								bootstrap[workerScopeName].postMessage([callbackPendingId, ['promise_rejected', aCatch]]);
							}
						);
					} else {
						// assume array
						if (rez_mainthread_call.length > 2 && rez_mainthread_call[rez_mainthread_call.length-1] == SIC_TRANS_WORD && Array.isArray(rez_mainthread_call[rez_mainthread_call.length-2])) {
							// to transfer in callback, set last element in arr to SIC_TRANS_WORD and 2nd to last element an array of the transferables									// cannot transfer on promise reject, well can, but i didnt set it up as probably makes sense not to
							rez_mainthread_call.pop();
							bootstrap[workerScopeName].postMessage([callbackPendingId, rez_mainthread_call], rez_mainthread_call.pop());
						} else {
							bootstrap[workerScopeName].postMessage([callbackPendingId, rez_mainthread_call]);
						}
					}
				}
			}
			else { console.warn('funcName', funcName, 'not in scope of aFuncExecScope') } // else is intentionally on same line with console. so on finde replace all console. lines on release it will take this out

		};
		
		var beforeInitListener = function(aMsgEvent) {
			// note:all msgs from bootstrap must be postMessage([nameOfFuncInWorker, arg1, ...])
			var aMsgEventData = aMsgEvent.data;
			if (aMsgEventData[0] == 'init') {
				bootstrap[workerScopeName].removeEventListener('message', beforeInitListener);
				bootstrap[workerScopeName].addEventListener('message', afterInitListener);
				deferredMain_SICWorker.resolve(true);
				if ('init' in aFuncExecScope) {
					aFuncExecScope[aMsgEventData.shift()].apply(null, aMsgEventData);
				}
			}
		};
		
		// var lastCallbackId = -1; // dont do this, in case multi SICWorker's are sharing the same aFuncExecScope so now using new Date().getTime() in its place // link8888881
		bootstrap[workerScopeName].postMessageWithCallback = function(aPostMessageArr, aCB, aPostMessageTransferList) {
			// lastCallbackId++; // link8888881
			sic_last_cb_id++;
			var thisCallbackId = SIC_CB_PREFIX + sic_last_cb_id; // + lastCallbackId; // link8888881
			aFuncExecScope[thisCallbackId] = function() {
				delete aFuncExecScope[thisCallbackId];
				// console.log('in mainthread callback trigger wrap, will apply aCB with these arguments:', arguments, 'turned into array:', Array.prototype.slice.call(arguments));
				aCB.apply(null, arguments[0]);
			};
			aPostMessageArr.push(thisCallbackId);
			// console.log('aPostMessageArr:', aPostMessageArr);
			bootstrap[workerScopeName].postMessage(aPostMessageArr, aPostMessageTransferList);
		};
		
		bootstrap[workerScopeName].addEventListener('message', beforeInitListener);
		bootstrap[workerScopeName].postMessage(['init', aCore]);
		
	} else {
		deferredMain_SICWorker.reject('Something is loaded into bootstrap[workerScopeName] already');
	}
	
	return deferredMain_SICWorker.promise;
	
}

function jsonToDOM(json, doc, nodes) {

    var namespaces = {
        html: 'http://www.w3.org/1999/xhtml',
        xul: 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul'
    };
    var defaultNamespace = namespaces.html;

    function namespace(name) {
        var m = /^(?:(.*):)?(.*)$/.exec(name);        
        return [namespaces[m[1]], m[2]];
    }

    function tag(name, attr) {
        if (Array.isArray(name)) {
            var frag = doc.createDocumentFragment();
            Array.forEach(arguments, function (arg) {
                if (!Array.isArray(arg[0]))
                    frag.appendChild(tag.apply(null, arg));
                else
                    arg.forEach(function (arg) {
                        frag.appendChild(tag.apply(null, arg));
                    });
            });
            return frag;
        }

        var args = Array.slice(arguments, 2);
        var vals = namespace(name);
        var elem = doc.createElementNS(vals[0] || defaultNamespace, vals[1]);

        for (var key in attr) {
            var val = attr[key];
            if (nodes && key == 'id')
                nodes[val] = elem;

            vals = namespace(key);
            if (typeof val == 'function')
                elem.addEventListener(key.replace(/^on/, ''), val, false);
            else
                elem.setAttributeNS(vals[0] || '', vals[1], val);
        }
        args.forEach(function(e) {
            try {
                elem.appendChild(
                                    Object.prototype.toString.call(e) == '[object Array]'
                                    ?
                                        tag.apply(null, e)
                                    :
                                        e instanceof doc.defaultView.Node
                                        ?
                                            e
                                        :
                                            doc.createTextNode(e)
                                );
            } catch (ex) {
                elem.appendChild(doc.createTextNode(ex));
            }
        });
        return elem;
    }
    return tag.apply(null, json);
}

function copyTextToClip(aTxt, aDOMWindow) {
	CLIPBOARD.set(aTxt, 'text');
}

function encodeFormData(data, charset, forArrBuf_nameDotExt, forArrBuf_mimeType) {
	// http://stackoverflow.com/a/25020668/1828637

	var encoder = Cc["@mozilla.org/intl/saveascharset;1"].createInstance(Ci.nsISaveAsCharset);
	encoder.Init(charset || "utf-8", Ci.nsISaveAsCharset.attr_EntityAfterCharsetConv + Ci.nsISaveAsCharset.attr_FallbackDecimalNCR, 0);
	var encode = function(val, header) {
		val = encoder.Convert(val);
		if (header) {
			val = val.replace(/\r\n/g, " ").replace(/"/g, "\\\"");
		}
		return val;
	}

	var boundary = "----boundary--" + Date.now();
	var mpis = Cc['@mozilla.org/io/multiplex-input-stream;1'].createInstance(Ci.nsIMultiplexInputStream);

	var item = "";
	for (var k of Object.keys(data)) {
		item += "--" + boundary + "\r\n";
		var v = data[k];
		
		if (v instanceof Ci.nsIFile) {
			
			var fstream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
			fstream.init(v, -1, -1, Ci.nsIFileInputStream.DELETE_ON_CLOSE);
			item += "Content-Disposition: form-data; name=\"" + encode(k, true) + "\";" + " filename=\"" + encode(v.leafName, true) + "\"\r\n";

			var ctype = "application/octet-stream";
			try {
				var mime = Cc["@mozilla.org/mime;1"].getService(Ci.nsIMIMEService);
				ctype = mime.getTypeFromFile(v) || ctype;
			} catch (ex) {
				console.warn("failed to get type", ex);
			}
			item += "Content-Type: " + ctype + "\r\n\r\n";

			var ss = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
			ss.data = item;

			mpis.appendStream(ss);
			mpis.appendStream(fstream);

			item = "";

		} else {
			console.error('in else');
			item += "Content-Disposition: form-data; name=\"" + encode(k, true) + "\"\r\n\r\n";
			item += encode(v);
			
		}
		item += "\r\n";
	}

	item += "--" + boundary + "--\r\n";
	var ss = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
	ss.data = item;
	mpis.appendStream(ss);
  
	var postStream = Cc["@mozilla.org/network/mime-input-stream;1"].createInstance(Ci.nsIMIMEInputStream);
	postStream.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);
	postStream.setData(mpis);
	postStream.addContentLength = true;
  
	return postStream;
}
function genericReject(aPromiseName, aPromiseToReject, aReason) {
	var rejObj = {
		name: aPromiseName,
		aReason: aReason
	};
	console.error('Rejected - ' + aPromiseName + ' - ', rejObj);
	if (aPromiseToReject) {
		aPromiseToReject.reject(rejObj);
	}
}
function genericCatch(aPromiseName, aPromiseToReject, aCaught) {
	var rejObj = {
		name: aPromiseName,
		aCaught: aCaught
	};
	console.error('Caught - ' + aPromiseName + ' - ', rejObj);
	if (aPromiseToReject) {
		aPromiseToReject.reject(rejObj);
	}
}

// rev3 - https://gist.github.com/Noitidart/03c84a4fc1e566bd0fe5
const SAM_CB_PREFIX = '_sam_gen_cb_';
var sam_last_cb_id = -1;
function sendAsyncMessageWithCallback(aMessageManager, aGroupId, aMessageArr, aCallbackScope, aCallback) {
	sam_last_cb_id++;
	var thisCallbackId = SAM_CB_PREFIX + sam_last_cb_id;
	aCallbackScope = aCallbackScope ? aCallbackScope : bootstrap;
	aCallbackScope[thisCallbackId] = function(aMessageArr) {
		delete aCallbackScope[thisCallbackId];
		aCallback.apply(null, aMessageArr);
	}
	aMessageArr.push(thisCallbackId);
	aMessageManager.sendAsyncMessage(aGroupId, aMessageArr);
}

var gFHR = []; // holds all currently alive FHR instances. keeps track of FHR's so it destroys them on shutdown. if devuser did not handle destroying it
var gFHR_id = 0;
function FHR() {
	// my FrameHttpRequest module which loads pages into frames, and navigates by clicks
	// my play on XHR
	
	// must instatiate with loadPageArgs
	
	gFHR_id++;
	
	var fhrThis = this;
	this.id = gFHR_id;
	gFHR.push(this);
	
	var fhrFsMsgListenerId = core.addon.id + '-fhr_' + gFHR_id;

	// start - rev3 - https://gist.github.com/Noitidart/03c84a4fc1e566bd0fe5
	var fhrFsFuncs = { // can use whatever, but by default its setup to use this
		FHRFrameScriptReady: function() {
			console.log('mainthread', 'FHRFrameScriptReady');
			fhrThis.inited = true;
			if (fhrPostInitCb) {
				fhrPostInitCb();
			}
		}
	};
	var fhrFsMsgListener = {
		funcScope: fhrFsFuncs,
		receiveMessage: function(aMsgEvent) {
			var aMsgEventData = aMsgEvent.data;
			console.log('fhrFsMsgListener getting aMsgEventData:', aMsgEventData, 'aMsgEvent:', aMsgEvent);
			// aMsgEvent.data should be an array, with first item being the unfction name in bootstrapCallbacks
			
			var callbackPendingId;
			if (typeof aMsgEventData[aMsgEventData.length-1] == 'string' && aMsgEventData[aMsgEventData.length-1].indexOf(SAM_CB_PREFIX) == 0) {
				callbackPendingId = aMsgEventData.pop();
			}
			
			aMsgEventData.push(aMsgEvent); // this is special for server side, so the function can do aMsgEvent.target.messageManager to send a response
			
			var funcName = aMsgEventData.shift();
			if (funcName in this.funcScope) {
				var rez_parentscript_call = this.funcScope[funcName].apply(null, aMsgEventData);
				
				if (callbackPendingId) {
					// rez_parentscript_call must be an array or promise that resolves with an array
					if (rez_parentscript_call.constructor.name == 'Promise') {
						rez_parentscript_call.then(
							function(aVal) {
								// aVal must be an array
								aMsgEvent.target.messageManager.sendAsyncMessage(fhrFsMsgListenerId, [callbackPendingId, aVal]);
							},
							function(aReason) {
								console.error('aReject:', aReason);
								aMsgEvent.target.messageManager.sendAsyncMessage(fhrFsMsgListenerId, [callbackPendingId, ['promise_rejected', aReason]]);
							}
						).catch(
							function(aCatch) {
								console.error('aCatch:', aCatch);
								aMsgEvent.target.messageManager.sendAsyncMessage(fhrFsMsgListenerId, [callbackPendingId, ['promise_rejected', aCatch]]);
							}
						);
					} else {
						// assume array
						aMsgEvent.target.messageManager.sendAsyncMessage(fhrFsMsgListenerId, [callbackPendingId, rez_parentscript_call]);
					}
				}
			}
			else { console.warn('funcName', funcName, 'not in scope of this.funcScope') } // else is intentionally on same line with console. so on finde replace all console. lines on release it will take this out
			
		}
	};
	
	Services.mm.addMessageListener(fhrFsMsgListenerId, fhrFsMsgListener);
	
	// no need to redefine - sendAsyncMessageWithCallback, i can use the globally defined sendAsyncMessageWithCallback fine with this
	// end - rev3 - https://gist.github.com/Noitidart/03c84a4fc1e566bd0fe5
	
	
	var aWindow = Services.wm.getMostRecentWindow('navigator:browser');
	var aDocument = aWindow.document;
	var fhrPostInitCb;
	
	var doAfterAppShellDomWinReady = function() {
		
			this.frame = aDocument.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'browser');
			
			// this.frame.setAttribute('class', core.addon.id + '_fhr-');
			// if (OS.Constants.Sys.Name.toLowerCase() != 'darwin') {
				this.frame.setAttribute('remote', 'true');
			// }
			this.frame.setAttribute('type', 'content');
			// this.frame.setAttribute('style', 'height:100px;border:2px solid steelblue;');
			this.frame.setAttribute('style', 'height:0;border:0;');
			
			aDocument.documentElement.appendChild(this.frame);
			this.frame.messageManager.loadFrameScript(core.addon.path.scripts + 'FHRFrameScript.js?fhrFsMsgListenerId=' + fhrFsMsgListenerId + '&v=' + core.addon.cache_key, false);			
			// aWindow.gBrowser.selectedBrowser.messageManager.loadFrameScript(core.addon.path.scripts + 'FHRFrameScript.js?fhrFsMsgListenerId=' + fhrFsMsgListenerId + '&v=' + core.addon.cache_key, false);
			
			this.destroy = function() {
				
				this.frame.messageManager.sendAsyncMessage(fhrFsMsgListenerId, ['destroySelf']); // not really needed as i remove the element

				Services.mm.removeMessageListener(fhrFsMsgListenerId, fhrFsMsgListener);
				aDocument.documentElement.removeChild(this.frame);
				
				delete this.frame; // release reference to it
				delete this.loadPage;
				delete this.destroy;
				
				for (var i=0; i<gFHR.length; i++) {
					if (gFHR[i].id == this.id) {
						gFHR.splice(i, 1);
						break;
					}
				}
				
				this.destroyed = true;
				console.log('ok destroyed FHR instance with id:', this.id);
			}.bind(this);
		
	}.bind(this);
	
	if (aDocument.readyState == 'complete') {
		doAfterAppShellDomWinReady();
	} else {
		aWindow.addEventListener('load', function() {
			aWindow.removeEventListener('load', arguments.callee, false);
			doAfterAppShellDomWinReady();
		}, false);
	}
	
	this.loadPage = function(aSrc, aClickSetName, aCallbackSetName, aLoadPageData, aDeferredMain_setSrc) {
		// sets src of frame OR clicks if aClickSetName is set. must either set aSrc OR aClickSetName never both
		
		// aCbInfoObj is a collection of callbacks, like for on fail load, on error etc etc
		console.log('ok in loadPage for id:', this.id);
		
		var deferredMain_setSrc;
		
		if (aDeferredMain_setSrc) {
			console.log('ok set to preset deferred');
			deferredMain_setSrc = aDeferredMain_setSrc;
		} else {
			deferredMain_setSrc = new Deferred();
			
			if (!this.inited) {
				console.log('not yet inited');
				fhrPostInitCb = this.loadPage.bind(this, aSrc, aClickSetName, aCallbackSetName, aLoadPageData, deferredMain_setSrc);
			
				return deferredMain_setSrc.promise;
			}
		}
		
		console.log('sending msg to message manager fhrFsMsgListenerId:', fhrFsMsgListenerId);
		sendAsyncMessageWithCallback(this.frame.messageManager, fhrFsMsgListenerId, ['loadPage', aSrc, aClickSetName, aCallbackSetName, aLoadPageData], fhrFsMsgListener.funcScope, function(aFhrResponse) {
			console.log('bootstrap', 'aFhrResponse:', aFhrResponse);
			deferredMain_setSrc.resolve(aFhrResponse);
		});
		
		return deferredMain_setSrc.promise;
		
	}.bind(this);
	
}

//rev1 - https://gist.github.com/Noitidart/c4ab4ca10ff5861c720b
function validateOptionsObj(aOptions, aOptionsDefaults) {
	// ensures no invalid keys are found in aOptions, any key found in aOptions not having a key in aOptionsDefaults causes throw new Error as invalid option
	for (var aOptKey in aOptions) {
		if (!(aOptKey in aOptionsDefaults)) {
			console.error('aOptKey of ' + aOptKey + ' is an invalid key, as it has no default value, aOptionsDefaults:', aOptionsDefaults, 'aOptions:', aOptions);
			throw new Error('aOptKey of ' + aOptKey + ' is an invalid key, as it has no default value');
		}
	}
	
	// if a key is not found in aOptions, but is found in aOptionsDefaults, it sets the key in aOptions to the default value
	for (var aOptKey in aOptionsDefaults) {
		if (!(aOptKey in aOptions)) {
			aOptions[aOptKey] = aOptionsDefaults[aOptKey];
		}
	}
}
function justFormatStringFromName(aLocalizableStr, aReplacements) {
    // justFormatStringFromName is formating only ersion of the worker version of formatStringFromName

    var cLocalizedStr = aLocalizableStr;
    if (aReplacements) {
        for (var i=0; i<aReplacements.length; i++) {
            cLocalizedStr = cLocalizedStr.replace('%S', aReplacements[i]);
        }
    }

    return cLocalizedStr;
}
function getNativeHandlePtrStr(aDOMWindow) {
	var aDOMBaseWindow = aDOMWindow.QueryInterface(Ci.nsIInterfaceRequestor)
								   .getInterface(Ci.nsIWebNavigation)
								   .QueryInterface(Ci.nsIDocShellTreeItem)
								   .treeOwner
								   .QueryInterface(Ci.nsIInterfaceRequestor)
								   .getInterface(Ci.nsIBaseWindow);
	return aDOMBaseWindow.nativeHandle;
}

function xpcomSetTimeout(aNsiTimer, aDelayTimerMS, aTimerCallback) {
	aNsiTimer.initWithCallback({
		notify: function() {
			aTimerCallback();
		}
	}, aDelayTimerMS, Ci.nsITimer.TYPE_ONE_SHOT);
}

function jsonAsQueryString(aJson) {
	// only bool, int, string are sent, all others are skipped
	var qs = [];
	for (var p in aJson) {
		if (['number', 'boolean', 'string'].indexOf(typeof(aJson[p])) > -1) {
			qs.push(p + '=' + aJson[p]);
		}
	}
	return qs.join('&');
}

function spliceObj(obj1, obj2) {
	/**
	 * By reference. Adds all of obj2 keys to obj1. Overwriting any old values in obj1.
	 * Was previously called `usurpObjWithObj`
	 * @param obj1
	 * @param obj2
	 * @returns obj1
	 */
	for (var attrname in obj2) { obj1[attrname] = obj2[attrname]; }
	return obj1;
}
function overwriteObjWithObj(obj1, obj2){
	/**
	 * No by reference. Creates a new object. With all the keys/values from obj2. Adds in the keys/values that are in obj1 that were not in obj2.
	 * @param obj1
	 * @param obj2
	 * @returns obj3 a new object based on obj1 and obj2
	 */

    var obj3 = {};
    for (var attrname in obj1) { obj3[attrname] = obj1[attrname]; }
    for (var attrname in obj2) { obj3[attrname] = obj2[attrname]; }
    return obj3;
}
var nsIFile = CC('@mozilla.org/file/local;1', Ci.nsILocalFile, 'initWithPath');
// end - common helper functions