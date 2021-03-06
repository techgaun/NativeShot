const {classes:Cc, interfaces:Ci} = Components;
console.log('FHRFrameScript loaded, this:', Components.stack, Components.stack.filename);
var gFhrFsMsgListenerId = Components.stack.filename.match(/fhrFsMsgListenerId=([^&]+)/)[1]; // Components.stack.filename == "chrome://nativeshot/content/resources/scripts/FHRFrameScript.js?fhrFsMsgListenerId=NativeShot@jetpack-fhr_1&v=0.2623310905363082"

//////////////////////////////////////////////////////// start - boilerplate
// start - rev3 - https://gist.github.com/Noitidart/03c84a4fc1e566bd0fe5
var core = {
	addon: {
		id: gFhrFsMsgListenerId // heeded for rev3 - https://gist.github.com/Noitidart/03c84a4fc1e566bd0fe5
	}
}

var bootstrapCallbacks = { // can use whatever, but by default it uses this
	// put functions you want called by bootstrap/server here
};
const SAM_CB_PREFIX = '_sam_gen_cb_';
var sam_last_cb_id = -1;
function sendAsyncMessageWithCallback(aMessageManager, aGroupId, aMessageArr, aCallbackScope, aCallback) {
	sam_last_cb_id++;
	var thisCallbackId = SAM_CB_PREFIX + sam_last_cb_id;
	aCallbackScope = aCallbackScope ? aCallbackScope : bootstrap; // :todo: figure out how to get global scope here, as bootstrap is undefined
	aCallbackScope[thisCallbackId] = function(aMessageArr) {
		delete aCallbackScope[thisCallbackId];
		aCallback.apply(null, aMessageArr);
	}
	aMessageArr.push(thisCallbackId);
	aMessageManager.sendAsyncMessage(aGroupId, aMessageArr);
}
var bootstrapMsgListener = {
	funcScope: bootstrapCallbacks,
	receiveMessage: function(aMsgEvent) {
		var aMsgEventData = aMsgEvent.data;
		console.log('framescript getting aMsgEvent, unevaled:', uneval(aMsgEventData));
		// aMsgEvent.data should be an array, with first item being the unfction name in this.funcScope
		
		var callbackPendingId;
		if (typeof aMsgEventData[aMsgEventData.length-1] == 'string' && aMsgEventData[aMsgEventData.length-1].indexOf(SAM_CB_PREFIX) == 0) {
			callbackPendingId = aMsgEventData.pop();
		}
		
		var funcName = aMsgEventData.shift();
		if (funcName in this.funcScope) {
			var rez_fs_call = this.funcScope[funcName].apply(null, aMsgEventData);
			
			if (callbackPendingId) {
				// rez_fs_call must be an array or promise that resolves with an array
				if (rez_fs_call.constructor.name == 'Promise') {
					rez_fs_call.then(
						function(aVal) {
							// aVal must be an array
							contentMMFromContentWindow_Method2(content).sendAsyncMessage(core.addon.id, [callbackPendingId, aVal]);
						},
						function(aReason) {
							console.error('aReject:', aReason);
							contentMMFromContentWindow_Method2(content).sendAsyncMessage(core.addon.id, [callbackPendingId, ['promise_rejected', aReason]]);
						}
					).catch(
						function(aCatch) {
							console.error('aCatch:', aCatch);
							contentMMFromContentWindow_Method2(content).sendAsyncMessage(core.addon.id, [callbackPendingId, ['promise_rejected', aCatch]]);
						}
					);
				} else {
					// assume array
					contentMMFromContentWindow_Method2(content).sendAsyncMessage(core.addon.id, [callbackPendingId, rez_fs_call]);
				}
			}
		}
		else { console.warn('funcName', funcName, 'not in scope of this.funcScope') } // else is intentionally on same line with console. so on finde replace all console. lines on release it will take this out
		
	}
};
contentMMFromContentWindow_Method2(content).addMessageListener(core.addon.id, bootstrapMsgListener);

var gCFMM;
function contentMMFromContentWindow_Method2(aContentWindow) {
	if (!gCFMM) {
		gCFMM = aContentWindow.QueryInterface(Ci.nsIInterfaceRequestor)
							  .getInterface(Ci.nsIDocShell)
							  .QueryInterface(Ci.nsIInterfaceRequestor)
							  .getInterface(Ci.nsIContentFrameMessageManager);
	}
	return gCFMM;

}
// end - rev3 - https://gist.github.com/Noitidart/03c84a4fc1e566bd0fe5



// start - common helpers
function Deferred() { // rev3 - https://gist.github.com/Noitidart/326f1282c780e3cb7390
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

function xpcomSetTimeout(aNsiTimer, aDelayTimerMS, aTimerCallback) {
	aNsiTimer.initWithCallback({
		notify: function() {
			aTimerCallback();
		}
	}, aDelayTimerMS, Ci.nsITimer.TYPE_ONE_SHOT);
}
// end - common helpers
//////////////////////////////////////////////////////// end - boilerplate

// START - framescript functionality
if (content.document.readyState == 'complete') {
	console.error('frame script ready, readyState is complete and location is:', content.location.href)
	contentMMFromContentWindow_Method2(content).sendAsyncMessage(core.addon.id, ['FHRFrameScriptReady']);
} else {
	console.error('frame script NOT YET ready, readyState is "' + content.document.readyState + '" and location is:', content.location.href)
	addEventListener('DOMContentLoaded', listenInitialReady, false);
}

function listenInitialReady(e) {
	var contentWindow = e.target.defaultView;
	if (contentWindow.frameElement) {
		// not yet top most
	} else {
		console.error('ok now initial page loaded, readyState:', contentWindow.document.readyState, 'and loc:', contentWindow.location.href); // well readyState is interactive, it is not complete. but thats ok, because i only have listeners for `DOMContentLoaded`, nothing for `load`
		removeEventListener('DOMContentLoaded', listenInitialReady, false);
		contentMMFromContentWindow_Method2(content).sendAsyncMessage(core.addon.id, ['FHRFrameScriptReady']);
	}
}

var pageLoading = false;
var gMainDeferred_loadPage; // resolve it with what you usually resolve XHR with, well as much as you can
var gData; // set per loadPage and cleaned up when loadPage is done
var gLoadedCallbackSetName;
/*
// resolve with:
statusText - whatever string explaining status
status - failed or ok
and any other stuff
*/
var gTimeout = Cc['@mozilla.org/timer;1'].createInstance(Ci.nsITimer); // hold timeout object
var gTimeoutMs = 10000;

var gInitialParams = [];
function initiallyFullyLoaded() {
	// meant to wait for fully load before doing loadPage
	if (content.document.readyState == 'complete') {
		console.error('ok fully loaded, going to loadPage now');
		removeEventListener('load', initiallyFullyLoaded, false);
		pageLoading = false;
		bootstrapCallbacks.loadPage(gInitialParams.shift(), gInitialParams.shift(), gInitialParams.shift(), gInitialParams.shift());
	}
}
var bootstrapCallbacks = { // can use whatever, but by default it uses this
	// put functions you want called by bootstrap/server here
	loadPage: function(aSrc, aClickSetName, aCallbackSetName, aData) {
		// if want to load page by click, then set aClickSetName
		// must set aSrc OR aClickSetName never both!
		if (aSrc && aClickSetName) {
			console.error('must set aSrc OR aClickSetName never both!');
			throw new Error('must set aSrc OR aClickSetName never both!');
		}
		
		if (pageLoading) {
			throw new Error('cannot load yet, as previous page is still loading');
		}
		
		gData = aData;
		gMainDeferred_loadPage = new Deferred();
		
		console.error(aSrc, aClickSetName, aCallbackSetName, aData);
		
		if (content.document.readState && content.document.readState != 'complete') {
			console.error('NOT FULLY LOADED, so doing that stuff for args:', aSrc, aClickSetName, aCallbackSetName, aData);
			pageLoading = true; // so nothing re-enters here
			if (aClickSetName) {
				// then wait for the full page to be loaded, otherwise javascript and other stuff will be stoped with .stop()
				gInitialParams.push(aSrc);
				gInitialParams.push(aClickSetName);
				gInitialParams.push(aCallbackSetName);
				gInitialParams.push(aData);
				addEventListener('load', initiallyFullyLoaded, false);
				return gMainDeferred_loadPage.promise;
			} else {
				// stop all pages, otherwise DOMContentLoaded will fire prematurely
				var contentWindowArr = getAllContentWins(content);
				for (var h=0; h<contentWindowArr.length; h++) {
					console.error('stopping frame:', h, contentWindowArr[h].document.readState, contentWindowArr[h].location.href);
					contentWindowArr[h].stop();
				}
			}
		}
		
		pageLoading = true;
		console.error('added aCallbackSetName:', aCallbackSetName);
		gLoadedCallbackSetName = aCallbackSetName;
		addEventListener('DOMContentLoaded', pageLoaded, false);
		
		xpcomSetTimeout(gTimeout, gTimeoutMs, pageTimeouted); //gTimeout = setTimeout(pageTimeouted, gTimeoutMs);
		
		if (aSrc) {
			if (aSrc == 'RELOAD') {
				content.location.reload(true);
			} else {
				content.location = aSrc;
			}
		} else if (aClickSetName) {
			if (!clickSet[aClickSetName]) {
				console.error('clickSet name not found!! aClickSetName:', aClickSetName);
				throw new Error('clickSet name not found!!');
			}
			
			tryClicks(content, aClickSetName);
		} else {
			console.error('should never ever get here');
			throw new Error('should never ever get here');
		}
		
		return gMainDeferred_loadPage.promise;
	},
	destroySelf: function() {
		contentMMFromContentWindow_Method2(content).removeMessageListener(core.addon.id, bootstrapMsgListener);
		console.log('ok destroyed self');
	}
};

bootstrapMsgListener.funcScope = bootstrapCallbacks; // need to do this, as i setup bootstrapMsgListener above with funcScope as bootstrapCallbacks however it is undefined at that time

const TRY_INTERVAL = 100;
const MAX_TRY_CNT = 10000 / TRY_INTERVAL; // checks for 5s
var gTriesTimeout = Cc['@mozilla.org/timer;1'].createInstance(Ci.nsITimer); // hold timeout object

function getAllContentWins(aContentWindow) {
	// gets all window elements, including frames
	var contentFrames = aContentWindow.frames;
	var contentWindowArr = [aContentWindow];
	for (var i=0; i<contentFrames.length; i++) {
		contentWindowArr.push(contentFrames[i].window);
	}
	return contentWindowArr;
}

function tryClicks(aContentWindow, aClickSetName, cur_try_cnt=0) {
	// cur_try_cnt is set progrmatically devuser should never set it
	// try clicking in all frames

	console.error(aClickSetName, 'trying click set now, cur_try_cnt:', cur_try_cnt);
	var contentWindowArr = getAllContentWins(aContentWindow);
	
	var rez_clickExec;
	for (var h=0; h<contentWindowArr.length; h++) {
		try { console.log('h:', h, 'contentWindowArr[h].document.documentElement.innerHTML:', contentWindowArr[h].document.documentElement.innerHTML); } catch(ex) { console.error('ex:', ex) } // ex happens when it loads about:blank and there is no document.documentElement
		for (var i=0; i<clickSet[aClickSetName].length; i++) {
			rez_clickExec = clickSet[aClickSetName][i].exec(contentWindowArr[h], contentWindowArr[h].document);
			if (rez_clickExec) {
				return;
			}
		}
	}
	
	// if (!rez_clickExec) { // obviously if get to this point then rez_clickExec
		console.log('all click instructions failed, try:', cur_try_cnt);
		if (cur_try_cnt < MAX_TRY_CNT) {
			xpcomSetTimeout(gTriesTimeout, MAX_TRY_CNT, tryClicks.bind(null, aContentWindow, aClickSetName, cur_try_cnt + 1)); // setTimeout
		} else {
			loadPage_finalizer(
				{
					status: false,
					statusText: 'click-set-failed'
				},
				false
			);
		}
	// }
}

function tryLoadeds(aContentWindow, aCallbackSetName, cur_try_cnt=0) {
	console.log('in tryLoadeds:', aCallbackSetName);
	// test all frames with callback set
	// if none of the tests of the callback for that return for that frame, then try next frame.
		// if none of the frames then report failed callbacks fhrResponse object
	console.error(aCallbackSetName, 'trying load callback set now, cur_try_cnt:', cur_try_cnt);
	var contentWindowArr = getAllContentWins(aContentWindow);

	for (var h=0; h<contentWindowArr.length; h++) {
		try { console.log('h:', h, 'contentWindowArr[h].document.documentElement.innerHTML:', contentWindowArr[h].document.documentElement.innerHTML); } catch(ex) { console.error('ex:', ex) } // ex happens when it loads about:blank and there is no document.documentElement
		for (var i=0; i<callbackSet[aCallbackSetName].length; i++) {
			var rezTest = callbackSet[aCallbackSetName][i].test(contentWindowArr[h], contentWindowArr[h].document);
			if (rezTest) {
				gMainDeferred_loadPage.resolve([rezTest]);
				return;
			}
		}
	}
	
	if (cur_try_cnt < MAX_TRY_CNT) {
		xpcomSetTimeout(gTriesTimeout, MAX_TRY_CNT, tryLoadeds.bind(null, aContentWindow, aCallbackSetName, cur_try_cnt + 1)); // setTimeout
	} else {
		loadPage_finalizer(
			{
				status: false,
				statusText: 'failed-callbackset',
				callbackSetName: aCallbackSetName
			},
			false
		);
	}
}

function pageTimeouted() {	
	console.error('triggered timeout!');
	loadPage_finalizer(
		{
			status: false,
			statusText: 'timeout'
		},
		true
	);
}

function pageLoaded(e) {
	console.error('triggered pageLoaded!');
	// waits till the loaded event triggers on top window not frames
	var contentWindow = e.target.defaultView;
	var contentDocument = contentWindow.document;
	
	if (contentWindow.frameElement) {
		// top window not yet loaded
		// var webnav = contentWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation); // console.log('remove on prod');
		// var docuri = webnav.document.documentURI; // console.log('remove on prod');
		// console.error('NOT TOP LOADED:', contentwindow.location, docuri);
	} else {
		// ok top finished loading
		console.error('ok top finished loading');
		
		var cLoadedCallbackSetName = gLoadedCallbackSetName; // do this here as loadPage_finalizer clears it out
		
		loadPage_finalizer(); // sets the variables to done loading, like removes timeout listener
		
		var webnav = contentWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation);
		var docuri = webnav.document.documentURI;
		
		if (docuri.indexOf('about:') === 0 && docuri.indexOf('127.0.0.1/nativeshot') == -1) { // because i used http://127.0.0.1/nativeshot it will fail load on allow as well, so i have to detect that here // see link324335445454448
			// failed loading
			loadPage_finalizer(
				{
					status: false,
					statusText: 'error-loading',
					docuri: docuri
				},
				false
			);
			
			// about:neterror?e=connectionFailure&u=http%3A//127.0.0.1/folder_name%3Fstate%3Dblah%23access_token%3Dfda25d1a39fd974a08a0485eccd8cd752ae16dd4%26expires_in%3D2419200%26token_type%3Dbearer%26refresh_token%3D32f7854e11b0091c6206d6ff3668a1f6f4f99c52%26account_username%3DNoitidart%26account_id%3D12688375&c=UTF-8&f=regular&d=Firefox%20can%27t%20establish%20a%20connection%20to%20the%20server%20at%20127.0.0.1.
		} else {
			tryLoadeds(content, cLoadedCallbackSetName); // i dont know why, but if i put contentWindow here, i get cant access dead object. with the imgur retry after login. so when reuse fhr. so weird. :todo: figure this out for real
		}
	}
}

function loadPage_finalizer(aFHRResponse, aDoStop) {
	
	if (aDoStop) {
		var contentWindowArr = getAllContentWins(content);
		for (var h=0; h<contentWindowArr.length; h++) {
			contentWindowArr[h].stop();
		}
	}
	
	gTimeout.cancel(); //clearTimeout(gTimeout);
	removeEventListener('DOMContentLoaded', pageLoaded, false);
	pageLoading = false;
	gLoadedCallbackSetName = undefined;
	
	console.error('removed pageLoaded');
	
	if (aFHRResponse) {
		gMainDeferred_loadPage.resolve([aFHRResponse]);
	}
	
	console.error('reslved if it was there to resolve');
}

// custom callbacks specific to NativeShot
var callbackSet = {
	// each entry, is an array of objects
	// each object has to have a test function which takes are contentWindow, contentDocument. and a fhrResponse object that it returns
	//// dropbox
	authorizeApp_dropbox: [
		// {
		// 	fhrResponse: 'testing!!', // string just for test, it should be a fhrResponse object // nice test shows, this.fhrResponse within .test() is accessing the right thing, which is this thing
		// 	test: function(aContentWindow, aContentDocument) { // must return fhrResponse obj, else it must return undefined/null
		// 		// if test succesful, then it returns resolveObj, it may update some stuff in resolveObj
		// 		console.log('this.fhrResponse:', this.fhrResponse);
		// 	}
		// },
		{
			fhrResponse: {
				status: false,
				statusText: 'api-error',
				apiText: '' // populated by .test()
			},
			test: function(aContentWindow, aContentDocument) {
				var errorDomEl = aContentDocument.getElementById('errorbox');
				if (errorDomEl) { // :maintain-per-website:
					this.fhrResponse.apiText = errorDomEl.innerHTML;
					return this.fhrResponse;
				}
			}
		},
		{
			fhrResponse: {
				status: false,
				statusText: 'not-logged-in',
			},
			test: function(aContentWindow, aContentDocument) {
				var domEl = aContentDocument.getElementById('login-content');
				if (domEl) { // :maintain-per-website:
					return this.fhrResponse;
				}
			}
		},
		{
			fhrResponse: {
				status: true,
				statusText: 'logged-in-allow-screen',
				screenname: undefined // set by .test()
			},
			test: function(aContentWindow, aContentDocument) {
				
					// :maintain-per-website:
					var domEl = aContentDocument.querySelector('.auth-button[name=allow_access]');
					if (domEl) {
						// var preStart_index = aContentDocument.documentElement.innerHTML.indexOf('"email": "');
						// var start_index = preStart_index + '"email": "'.length;
						// var end_index = aContentDocument.documentElement.innerHTML.indexOf('"', start_index);
						// 
						// if (preStart_index > -1 && end_index > -1) {
						// 	var screenname = aContentDocument.documentElement.innerHTML.substr(start_index, end_index);
						// 	console.log('screenname:', screenname);
						// 	this.fhrResponse.screenname = screenname;
						// }
						return this.fhrResponse;
					}
				

			}
		}
	],
	allow_dropbox: [
		{
			fhrResponse: {
				status: true,
				statusText: 'allowed',
				allowedParams: '' // set by .test()
			},
			test: function(aContentWindow, aContentDocument) {
				
				var webnav = aContentWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation);
				var docuri = webnav.document.documentURI;
				console.log('docuri:', docuri);
				
				var lochref = aContentWindow.location.href;
				var lochash = aContentWindow.location.hash;
				console.log('aContentWindow.location.href:', lochref);
				console.log('aContentWindow.location.hash:', lochash);
				
				// docuri if localhost is not setup:
					// about:neterror?e=connectionFailure&u=http%3A//127.0.0.1/nativeshot%3Fstate%3D1461945377084%23access_token%3Dd9c614034b86b92acde49b137ec3d990f20e24e4%26expires_in%3D2419200%26token_type%3Dbearer%26refresh_token%3Dd816c4f1c4c869a61a62f54d30001390cde9461b%26account_username%3DNoitidart%26account_id%3D12688375&c=UTF-8&f=regular&d=Firefox%20can%27t%20establish%20a%20connection%20to%20the%20server%20at%20127.0.0.1.
				// docuri if localhost is set up is same as lochref:
					// http://127.0.0.1/nativeshot?state=1461945377084#access_token=d9c614034b86b92acde49b137ec3d990f20e24e4&expires_in=2419200&token_type=bearer&refresh_token=d816c4f1c4c869a61a62f54d30001390cde9461b&account_username=Noitidart&account_id=12688375
				
				if ((docuri.indexOf('about:') === 0 && docuri.indexOf('127.0.0.1/nativeshot') > -1) || lochref.indexOf('127.0.0.1/nativeshot') > -1) {
					var receivedParamsFullStr = lochash[0] == '#' ? lochash.substr(1) : lochash;
					var receivedParamsPiecesStrArr = receivedParamsFullStr.split('&');
					
					var receivedParamsKeyVal = {};
					for (var i=0; i<receivedParamsPiecesStrArr.length; i++) {
						var splitPiece = receivedParamsPiecesStrArr[i].split('=');
						receivedParamsKeyVal[splitPiece[0]] = splitPiece[1];
					}
					
					this.fhrResponse.allowedParams = receivedParamsKeyVal;
					return this.fhrResponse;	
				}
			}
		}
	],
	//// gdrive
	authorizeApp_gdrive: [
		{
			fhrResponse: {
				status: false,
				statusText: 'not-logged-in',
				signin_url: null // populated if sign in is handled by another web server, but connected into google
			},
			test: function(aContentWindow, aContentDocument) {
				var webnav = aContentWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation);
				var docuri = webnav.document.documentURI;
				console.log('docuri:', docuri);
				console.log('win loc:', aContentWindow.location.href);
				for (var l in aContentWindow.location) {
					console.log('win loc:', l, JSON.stringify(aContentWindow.location[l]));
				}
				console.error('ok end line');
				if (aContentWindow.location.hostname == 'accounts.google.com') {
					var domEl = aContentDocument.getElementById('gaia_loginform');
					if (domEl) { // :maintain-per-website:
						// var domElSecond = domEl.querySelector('input[value=PasswordSeparationSignIn]');
						var attrAction = domEl.getAttribute('action');
						if (attrAction && attrAction == 'https://accounts.google.com/ServiceLoginAuth') {
						// if (domElSecond) {
							return this.fhrResponse;
						}
					}
				} else {
					if (aContentWindow.location.href.indexOf('http://127.0.0.1/nativeshot') !== 0) {
						// because it might load the allow screen, which is hostname of "127.0.0.1" and path of "/nativeshot", thats just what i set all my redir urls to. sooo if its not that, then give logged out screen
						// if hostname is not google, then it is not-logged-in for some google account handler by another web server
						this.fhrResponse.signin_url = aContentWindow.location.href.substr(0, aContentWindow.location.href.indexOf('accounts.google.com') + 'accounts.google.com'.length)
						return this.fhrResponse;
					}
				}
			}
		},
		{
			fhrResponse: {
				status: true,
				statusText: 'multi-acct-picker',
				accts: [] // array of objects. each object has 3 keys: uid, screenname, and domElId
			},
			test: function(aContentWindow, aContentDocument) {
				// block link484443431111110
				var domEl = aContentDocument.getElementById('gaia_loginform');
				if (domEl) { // :maintain-per-website:
					var attrAction = domEl.getAttribute('action');
					if (attrAction && /AccountChooser/i.test(attrAction)) { // .indexOf('/AccountChooser')
						console.log('ok found account chooser');
						var acctBtns = domEl.querySelectorAll('button');
						for (var i=0; i<acctBtns.length; i++) {
							
							console.log('total btns:', acctBtns.length, i, acctBtns[i]);
							
							var attrEmail = acctBtns[i].getAttribute('value');
							if (!attrEmail) {
								console.error('no email found!');
								return;
							}
							
							// uid is attrEmail

							var domElAcctScreenname = acctBtns[i].querySelector('span');
							var acctScreenname;
							if (domElAcctScreenname) {
								// i dont exit if screenname not found as not yet required
								acctScreenname = domElAcctScreenname.textContent.trim();
							}
							
							var acctInfo = {
								uid: attrEmail,
								screenname: acctScreenname
							};
							this.fhrResponse.accts.push(acctInfo);
						}
						if (Object.keys(this.fhrResponse.accts).length) {
							return this.fhrResponse;
						}
					}
				}
			}
		},
		{
			fhrResponse: {
				status: true,
				statusText: 'logged-in-allow-screen',
				screenname: undefined // set by .test()
			},
			test: function(aContentWindow, aContentDocument) {
				var domEl = aContentDocument.getElementById('submit_approve_access');
				if (domEl) { // :maintain-per-website:
				
					// var loggedInUserDomEl = aContentDocument.querySelector('a[href*=SignOutOptions]');
					// if (loggedInUserDomEl) {
					// 	this.fhrResponse.screenname = loggedInUserDomEl.childNodes[0].textContent;
					// }
					return this.fhrResponse;
				}
			}
		}
	],
	allow_gdrive: [
		{
			fhrResponse: {
				status: true,
				statusText: 'allowed',
				allowedParams: '' // set by .test()
			},
			test: function(aContentWindow, aContentDocument) {
				
				var webnav = aContentWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation);
				var docuri = webnav.document.documentURI;
				console.log('docuri:', docuri);
				
				var lochref = aContentWindow.location.href;
				var lochash = aContentWindow.location.hash;
				console.log('aContentWindow.location.href:', lochref);
				console.log('aContentWindow.location.hash:', lochash);
				
				// docuri if localhost is not setup:
					// about:neterror?e=connectionFailure&u=http%3A//127.0.0.1/nativeshot%3Fstate%3D1461945377084%23access_token%3Dd9c614034b86b92acde49b137ec3d990f20e24e4%26expires_in%3D2419200%26token_type%3Dbearer%26refresh_token%3Dd816c4f1c4c869a61a62f54d30001390cde9461b%26account_username%3DNoitidart%26account_id%3D12688375&c=UTF-8&f=regular&d=Firefox%20can%27t%20establish%20a%20connection%20to%20the%20server%20at%20127.0.0.1.
				// docuri if localhost is set up is same as lochref:
					// http://127.0.0.1/nativeshot?state=1461945377084#access_token=d9c614034b86b92acde49b137ec3d990f20e24e4&expires_in=2419200&token_type=bearer&refresh_token=d816c4f1c4c869a61a62f54d30001390cde9461b&account_username=Noitidart&account_id=12688375
				
				if ((docuri.indexOf('about:') === 0 && docuri.indexOf('127.0.0.1/nativeshot') > -1) || lochref.indexOf('127.0.0.1/nativeshot') > -1) {
					
					var receivedParamsFullStr = lochash[0] == '#' ? lochash.substr(1) : lochash;
					var receivedParamsPiecesStrArr = receivedParamsFullStr.split('&');
					
					var receivedParamsKeyVal = {};
					for (var i=0; i<receivedParamsPiecesStrArr.length; i++) {
						var splitPiece = receivedParamsPiecesStrArr[i].split('=');
						receivedParamsKeyVal[splitPiece[0]] = splitPiece[1];
					}
					
					this.fhrResponse.allowedParams = receivedParamsKeyVal;
					return this.fhrResponse;	
				}
			}
		}
	],
	//// imgur
	authorizeApp_imgur: [
		{
			fhrResponse: {
				status: false,
				statusText: 'not-logged-in',
			},
			test: function(aContentWindow, aContentDocument) {
				var domEl = aContentDocument.getElementById('password');
				if (domEl) { // :maintain-per-website:
					return this.fhrResponse;
				}
			}
		},
		{
			fhrResponse: {
				status: true,
				statusText: 'logged-in-allow-screen',
				screenname: undefined // set by .test()
			},
			test: function(aContentWindow, aContentDocument) {
				var domEl = aContentDocument.getElementById('upload-global-logged-in');
				if (domEl) { // :maintain-per-website:
				
					// var loggedInUserDomEl = domEl.querySelector('.green');
					// if (loggedInUserDomEl) {
					// 	this.fhrResponse.username = loggedInUserDomEl.textContent;
					// }
					return this.fhrResponse;
				}
			}
		},
		{
			fhrResponse: {
				status: false,
				statusText: 'server-busy',
			},
			test: function(aContentWindow, aContentDocument) {
				// sometiems i land on ```<head><link rel="alternate stylesheet" type="text/css" href="resource://gre-resources/plaintext.css" title="Wrap Long Lines"></head><body><pre>{"data":{"error":"Imgur is temporarily over capacity. Please try again later."},"success":false,"status":500}</pre></body>```
				var domEl = aContentDocument.querySelector('pre');
				if (domEl) { // :maintain-per-website:
					try {
						var jPre = JSON.parse(domEl.textContent);
						if (jPre.status == 500) {
							return this.fhrResponse;
						}
					} catch (ignore) {}
				}
			}
		}
	],
	allow_imgur: [
		{
			fhrResponse: {
				status: true,
				statusText: 'allowed',
				allowedParams: '' // set by .test()
			},
			test: function(aContentWindow, aContentDocument) {
				
				var webnav = aContentWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation);
				var docuri = webnav.document.documentURI;
				console.log('docuri:', docuri);
				
				var lochref = aContentWindow.location.href;
				var lochash = aContentWindow.location.hash;
				console.log('aContentWindow.location.href:', lochref);
				console.log('aContentWindow.location.hash:', lochash);
				
				// docuri if localhost is not setup:
					// about:neterror?e=connectionFailure&u=http%3A//127.0.0.1/nativeshot%3Fstate%3D1461945377084%23access_token%3Dd9c614034b86b92acde49b137ec3d990f20e24e4%26expires_in%3D2419200%26token_type%3Dbearer%26refresh_token%3Dd816c4f1c4c869a61a62f54d30001390cde9461b%26account_username%3DNoitidart%26account_id%3D12688375&c=UTF-8&f=regular&d=Firefox%20can%27t%20establish%20a%20connection%20to%20the%20server%20at%20127.0.0.1.
				// docuri if localhost is set up is same as lochref:
					// http://127.0.0.1/nativeshot?state=1461945377084#access_token=d9c614034b86b92acde49b137ec3d990f20e24e4&expires_in=2419200&token_type=bearer&refresh_token=d816c4f1c4c869a61a62f54d30001390cde9461b&account_username=Noitidart&account_id=12688375
				
				if ((docuri.indexOf('about:') === 0 && docuri.indexOf('127.0.0.1/nativeshot') > -1) || lochref.indexOf('127.0.0.1/nativeshot') > -1) {

					var receivedParamsFullStr = lochash[0] == '#' ? lochash.substr(1) : lochash;
					var receivedParamsPiecesStrArr = receivedParamsFullStr.split('&');
					
					var receivedParamsKeyVal = {};
					for (var i=0; i<receivedParamsPiecesStrArr.length; i++) {
						var splitPiece = receivedParamsPiecesStrArr[i].split('=');
						receivedParamsKeyVal[splitPiece[0]] = splitPiece[1];
					}
					
					this.fhrResponse.allowedParams = receivedParamsKeyVal;
					return this.fhrResponse;	
				}
			}
		}
	],
	main_imgur: [
		{
			fhrResponse: {
				status: true,
				statusText: 'loaded'
			},
			test: function(aContentWindow, aContentDocument) {
				
				var webnav = aContentWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation);
				var docuri = webnav.document.documentURI;

				if (docuri.indexOf('about:') !== 0) {
					console.log('aContentWindow.location.href:', aContentWindow.location.href);
					console.log('aContentWindow.location.hash:', aContentWindow.location.hash);
					
					return this.fhrResponse;
				}
			}
		}
	]
	//// 
}

// link324335445454448
callbackSet.authorizeApp_dropbox.push(callbackSet.allow_dropbox[0]);
callbackSet.authorizeApp_gdrive.push(callbackSet.allow_gdrive[0]);
callbackSet.authorizeApp_imgur.push(callbackSet.allow_imgur[0]); // because going to authorizeApp_imgur goes directly as if allow_imgur if user had previously (non-locally) allowed it (so meaning on their servers) i add in the allow_imgur block to the above, without duplicating copy paste // link324335445454448

var clickSet = {

	//// dropbox
	allow_dropbox: [
		{
			// fhrRequest: { // the allow button as of 02216 when user is logged in
			// 	statusText: 'this is fhrRequest object, this is just for my notes.'
			// },
			exec: function(aContentWindow, aContentDocument) {
				var domEl = aContentDocument.querySelector('.auth-button[name=allow_access]');
				if (domEl) {
					domEl.click();
				}
				return true;
			}
		}
	],
	//// gdrive
	allow_gdrive: [
		{
			// fhrRequest: { // the allow button as of 02216 when user is logged in
			// 	statusText: 'this is fhrRequest object, this is just for my notes.'
			// },
			exec: function(aContentWindow, aContentDocument) {
				var domEl = aContentDocument.getElementById('submit_approve_access');
				if (domEl) {
					var attrDisabled = domEl.getAttribute('disabled'); // default value is a blank string, we want it to not be there, so getAttribute returns null at that time
					if (attrDisabled === null) { // cant check !attrDisabled as (!"") a blank string  is true
						domEl.click();
						return true;
					} else {
						console.warn('btn is disabled!');
					}
				}
			}
		}
	],
	pickAcct_gdrive: [
		{
			exec: function(aContentWindow, aContentDocument) {
				// same algo but modded as block link484443431111110
				var domEl = aContentDocument.getElementById('gaia_loginform');
				if (domEl) { // :maintain-per-website:
					var attrAction = domEl.getAttribute('action');
					if (attrAction && /AccountChooser/i.test(attrAction)) { // .indexOf('/AccountChooser')
						console.log('ok found account chooser');
						console.log('searching for targetUid:', JSON.stringify(gData));
						var acctBtns = domEl.querySelectorAll('button');
						for (var i=0; i<acctBtns.length; i++) {
							
							console.log('total btns:', acctBtns.length, i, acctBtns[i]);
							
							var attrEmail = acctBtns[i].getAttribute('value');
							console.log('attrEmail:', attrEmail);
							if (!attrEmail) {
								console.error('no email found!');
								return;
							}
							// uid is attrEmail
							if (attrEmail == gData.targetUid) {
								var attrDisabled = acctBtns[i].getAttribute('disabled'); // default value is a blank string, we want it to not be there, so getAttribute returns null at that time
								if (attrDisabled === null) { // cant check !attrDisabled as (!"") a blank string  is true
									acctBtns[i].click();
									return true;
								} else {
									console.warn('btn is disabled!');
								}
							}
						}
					}
				}
				
				// var domEl = aContentDocument.getElementById(gData.domElId);
				// if (domEl) {
				// 	domEl.click();
				// }
				// return true;
			}
		}
	],
	//// imgur
	allow_imgur: [
		{
			// fhrRequest: { // the allow button as of 02216 when user is logged in
			// 	statusText: 'this is fhrRequest object, this is just for my notes.'
			// },
			exec: function(aContentWindow, aContentDocument) {
				var domEl = aContentDocument.getElementById('allow');
				if (domEl) {
					domEl.click();
				}
				return true;
			}
		}
	]
}

// END - framescript functionality