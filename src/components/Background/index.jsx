import React, { Component } from 'react';
import {
  storage,
  nativeAPI,
  indexUrl,
  getTab,
  sendNotification,
  openExtensionPage,
  getActiveTab,
} from 'helpers/webext';
import {
  Mode,
  Action,
  defaultBlacklist,
  defaultWhitelist,
  UnblockOptions,
  defaultUnblock,
  isAccessible,
  defaultMode,
  defaultAction,
  defaultIsEnabled,
  addCurrentWebsite,
} from 'helpers/block';
import { defaultSchedule, getTodaySchedule, isScheduleAllowed } from 'helpers/schedule';
import { hasValidProtocol, getValidUrl, getHostname } from 'helpers/url';
import { transformList, transformKeywords } from 'helpers/regex';
import { logger, defaultLogsSettings } from 'helpers/logger';
import { defaultTimerSettings, unactiveTimerRuntimeSettings } from 'helpers/timer';
import { now } from 'helpers/date';
import { translate } from 'helpers/i18n';

const contextMenus = [
  {
    title: translate('blockCurrentDomain'),
    id: 'block_current_domain',
    enabled: false,
    contexts: ['page'],
  },
  {
    title: translate('blockCurrentUrl'),
    id: 'block_current_url',
    enabled: false,
    contexts: ['page'],
  },
  {
    title: translate('settings'),
    id: 'settings',
    enabled: true,
    contexts: ['page'],
  },
  {
    title: translate('blacklistSettings'),
    id: 'blacklist_settings',
    enabled: true,
    contexts: ['page'],
  },
  {
    title: translate('whitelistSettings'),
    id: 'whitelist_settings',
    enabled: true,
    contexts: ['page'],
  },
];

export class Background extends Component {
  constructor(props) {
    super(props);
    // public
    this.blacklist = [];
    this.whitelist = [];
    this.blacklistKeywords = [];
    this.whitelistKeywords = [];
    this.isEnabled = defaultIsEnabled;
    this.mode = defaultMode;
    this.action = defaultAction;
    this.redirectUrl = '';
    this.unblock = defaultUnblock;
    this.schedule = defaultSchedule;
    this.timer = defaultTimerSettings;
    this.enableLogs = defaultLogsSettings.isEnabled;
    // private
    this.hasBeenEnabledOnStartup = false;
    this.tmpAllowed = [];
    this.timerTimeout = null;

    this.init();
  }

  debug = (message, ...params) => {
    //console.log(message, ...params); // uncomment this line to see logs
  };

  //----- Start getters & setters (for public properties)

  setSchedule = (value) => {
    this.schedule = value;
  };

  getSchedule = () => {
    return this.schedule;
  };

  setTimerSettings = (value) => {
    this.timer = value;
  };

  getTimerSettings = () => {
    const ms = this.getTimerRemainingTime();
    return {
      ...this.timer,
      runtime: {
        ...this.timer.runtime,
        remainingDuration: ms > 0 ? ms / 1000 : 0,
      },
    };
  };

  setMode = (value) => {
    this.mode = value;
  };

  getMode = () => {
    return this.mode;
  };

  setIsEnabled = (value) => {
    if (value) {
      this.enable();
    } else {
      this.disable();
    }
  };

  getIsEnabled = () => {
    return this.isEnabled;
  };

  setBlacklist = (blist, tabId = null) => {
    this.blacklist = transformList(blist);
    if (tabId && this.isEnabled) {
      this.checkTabById(tabId, 'setBlacklist');
    }
  };

  getBlacklist = () => {
    return this.blacklist;
  };

  setBlacklistKeywords = (keywords) => {
    this.blacklistKeywords = transformKeywords(keywords);
  };

  getBlacklistKeywords = () => {
    return this.blacklistKeywords;
  };

  setWhitelistKeywords = (keywords) => {
    this.whitelistKeywords = transformKeywords(keywords);
  };

  getWhitelistKeywords = () => {
    return this.whitelistKeywords;
  };

  setWhitelist = (wlist, tabId = null) => {
    this.whitelist = transformList(wlist);
    if (tabId && this.isEnabled) {
      this.checkTabById(tabId, 'setWhitelist');
    }
  };

  getWhitelist = () => {
    return this.whitelist;
  };

  setAction = (value) => {
    this.action = value;
  };

  getAction = () => {
    return this.action;
  };

  setRedirectUrl = (url) => {
    this.redirectUrl = getValidUrl(url);
  };

  getRedirectUrl = () => {
    return this.redirectUrl;
  };

  setUnblockOnceTimeout = (value) => {
    this.unblock.unblockOnceTimeout = value;
  };

  getUnblockOnceTimeout = () => {
    return this.unblock.unblockOnceTimeout;
  };

  setDisplayNotificationOnTimeout = (value) => {
    this.unblock.displayNotificationOnTimeout = value;
  };

  getDisplayNotificationOnTimeout = () => {
    return this.unblock.displayNotificationOnTimeout;
  };

  setAutoReblockOnTimeout = (value) => {
    this.unblock.autoReblockOnTimeout = value;
  };

  getAutoReblockOnTimeout = () => {
    return this.unblock.autoReblockOnTimeout;
  };

  setLogsSettings = (logs) => {
    this.enableLogs = logs.isEnabled;
    logger.maxLength = logs.maxLength;
  };

  getLogsSettings = () => {
    return {
      isEnabled: this.enableLogs,
      maxLength: logger.maxLength,
    };
  };

  //----- End getters & setters

  init = () => {
    storage
      .get({
        blacklist: defaultBlacklist,
        whitelist: defaultWhitelist,
        blacklistKeywords: [],
        whitelistKeywords: [],
        blackList: null, // for backward compatibility (with v1)
        whiteList: null,
        isEnabled: this.isEnabled,
        mode: this.mode,
        action: this.action,
        timer: this.timer,
        unblock: this.unblock,
        schedule: this.schedule,
        redirectUrl: this.redirectUrl,
        enableLogs: this.enableLogs,
        logsLength: defaultLogsSettings.maxLength,
      })
      .then((items) => {
        this.debug('items:', items);
        //----- Start backward compatibility with v1
        if (items.blackList !== null) {
          items.blacklist = this.removeListDuplicates(
            items.blacklist.concat(items.blackList) // merge current & old list
          );
          storage.remove('blackList'); // remove old list from storage
          storage.set({ blacklist: items.blacklist }); // save merged list
        }
        if (items.whiteList !== null) {
          items.whitelist = this.removeListDuplicates(
            items.whitelist.concat(items.whiteList)
          );
          storage.remove('whiteList');
          storage.set({ whitelist: items.whitelist });
        }
        //----- End backward compatibility with v1
        this.blacklist = transformList(items.blacklist);
        this.whitelist = transformList(items.whitelist);
        this.blacklistKeywords = items.blacklistKeywords;
        this.whitelistKeywords = items.whitelistKeywords;
        this.mode = items.mode;
        this.action = items.action;
        this.timer = { ...this.timer, ...items.timer };
        this.unblock = { ...this.unblock, ...items.unblock }; // merge
        this.schedule = {
          ...this.schedule,
          ...(!items.schedule.time ? items.schedule : {}), // omit old schedule settings in version <= 2.3.0
        };
        this.redirectUrl = getValidUrl(items.redirectUrl);
        this.enableLogs = items.enableLogs;
        logger.maxLength = items.logsLength;
        if (!this.hasBeenEnabledOnStartup && items.isEnabled) {
          this.enable();
        }
        if (!this.isEnabled) {
          this.updateIcon();
        }
        if (this.timer.isEnabled) {
          this.resumeTimer();
        }
      });
    browser.runtime.onStartup.addListener(this.onBrowserStartup);
    browser.runtime.onMessage.addListener(this.handleMessage);
    browser.contextMenus.onClicked.addListener(this.handleContextMenusClick);
    this.initContextMenus();
  };

  initContextMenus = async () => {
    const activeTab = await getActiveTab();
    for (const menu of contextMenus) {
      browser.contextMenus.create({
        ...menu,
        enabled: this.isContextMenuEnablable(menu, activeTab),
      });
    }
    browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete') {
        this.updateContextMenus(tab);
      }
    });
    browser.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
      getTab(addedTabId).then((tab) => {
        if (tab) {
          this.updateContextMenus(tab);
        }
      });
    });
    browser.tabs.onActivated.addListener((activeInfo) => {
      getTab(activeInfo.tabId).then((tab) => {
        if (tab) {
          this.updateContextMenus(tab);
        }
      });
    });
    browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
      setTimeout(() => {
        getActiveTab().then((tab) => {
          if (tab) {
            this.updateContextMenus(tab);
          }
        });
      }, 100);
    });
  };

  updateIcon = () => {
    browser.browserAction.setIcon({
      // prettier-ignore
      path: this.isEnabled ? {
        16: 'icons/magnet-16.png',
        32: 'icons/magnet-32.png',
        48: 'icons/magnet-48.png',
        64: 'icons/magnet-64.png',
        128: 'icons/magnet-128.png',
      } : {
        16: 'icons/magnet-grayscale-16.png',
        32: 'icons/magnet-grayscale-32.png',
        48: 'icons/magnet-grayscale-48.png',
        64: 'icons/magnet-grayscale-64.png',
        128: 'icons/magnet-grayscale-128.png',
      },
    });
  };

  removeListDuplicates = (list) => {
    return list.filter((url, index) => list.indexOf(url) === index);
  };

  onBrowserStartup = () => {
    storage
      .get({
        enableOnBrowserStartup: false,
      })
      .then(({ enableOnBrowserStartup }) => {
        if (enableOnBrowserStartup && !this.isEnabled) {
          this.enable('enabled on startup!');
          this.hasBeenEnabledOnStartup = true;
        }
      });
  };

  handleMessage = (request, sender, sendResponse) => {
    this.debug('Handle message:', request);
    let response = null;
    return new Promise((resolve) => {
      switch (request.message) {
        // unblockSenderTab
        case 'unblockSenderTab':
          const { url, option, time = 0 } = request.params[0];
          let timeout = 0;
          switch (option) {
            case UnblockOptions.unblockForWhile:
              timeout = time * 60000; // convert minutes to ms
              break;
            case UnblockOptions.unblockOnce:
            default:
              timeout = this.unblock.unblockOnceTimeout * 1000; // convert seconds to ms
              break;
          }
          this.unblockTab(sender.tab.id, url, timeout);
          response = this.redirectTab(sender.tab.id, url);
          break;
        // redirectSenderTab
        case 'redirectSenderTab':
          response = this.redirectTab(sender.tab.id, ...request.params);
          break;
        // default
        default:
          response = this.isFunction(request.message)
            ? this.executeFunction(request.message, ...request.params)
            : this[request.message];
          break;
      }
      this.debug('response:', response);
      resolve({ response });
    });
  };

  handleContextMenusClick = (info, tab) => {
    switch (info.menuItemId) {
      case 'block_current_domain':
      case 'block_current_url':
        addCurrentWebsite(this.mode, true, info.menuItemId === 'block_current_url');
        break;
      case 'settings':
        openExtensionPage('/settings');
        break;
      case 'blacklist_settings':
        openExtensionPage('/settings?tab=blacklist');
        break;
      case 'whitelist_settings':
        openExtensionPage('/settings?tab=whitelist');
        break;
      default:
        this.debug('unknown context menu action:', info, tab);
        break;
    }
  };

  isContextMenuEnablable = (menu, tab) => {
    switch (menu.id) {
      case 'block_current_domain':
      case 'block_current_url':
        return tab ? isAccessible(tab.url) : false;
      default:
        return true;
    }
  };

  updateContextMenus = (tab) => {
    for (const menu of contextMenus) {
      try {
        browser.contextMenus.update(menu.id, {
          enabled: this.isContextMenuEnablable(menu, tab),
        });
      } catch (error) {
        this.debug(error);
      }
    }
  };

  unblockTab = (tabId, url, timeout) => {
    if (timeout > 0) {
      this.tmpAllowed.push({
        time: timeout,
        startedAt: new Date().getTime(),
        hostname: getHostname(url),
      });

      if (
        this.unblock.displayNotificationOnTimeout ||
        this.unblock.autoReblockOnTimeout
      ) {
        setTimeout(() => {
          if (this.unblock.displayNotificationOnTimeout) {
            const title = translate('appName');
            const message = translate('timeOverFor', url);
            sendNotification(message, title);
          }
          if (this.unblock.autoReblockOnTimeout) {
            this.debug('auto reblock after timeout:', tabId, timeout);
            getTab(tabId).then((tab) => {
              // get latest tab infos (url)
              this.redirectTab(
                tab.id,
                `${indexUrl}#blocked?url=${encodeURIComponent(tab.url)}`
              );
            });
          }
        }, timeout);
      }
    }
  };

  isFunction = (functionName) => {
    return this[functionName] && typeof this[functionName] === 'function';
  };

  executeFunction = (functionName, ...params) => {
    try {
      if (params) {
        return this[functionName](...params);
      } else {
        return this[functionName]();
      }
    } catch (error) {
      this.debug(error);
    }
  };

  handleAction = (data) => {
    switch (this.action) {
      case Action.blockTab:
      case Action.redirectToUrl:
      default:
        return {
          redirectUrl:
            this.action === Action.redirectToUrl && this.redirectUrl.length
              ? this.redirectUrl
              : `${indexUrl}#blocked?url=${encodeURIComponent(data.url)}`,
        };
      case Action.closeTab:
        this.closeTab(data.tabId);
        return {
          redirectUrl: 'javascript:window.close()', // eslint-disable-line
        };
    }
  };

  closeTab = (tabId) => {
    this.debug('closing tab:', tabId);
    nativeAPI.tabs.remove(tabId); // nativeAPI is used to fix weird errors on chrome due to browser-polyfill
  };

  redirectTab = (tabId, redirectUrl) => {
    this.debug('redirecting tab:', tabId, redirectUrl);
    nativeAPI.tabs.update(tabId, {
      url: redirectUrl,
    });
  };

  removeOutdatedTmpAllowed = () => {
    const now = new Date().getTime();
    this.tmpAllowed = this.tmpAllowed.filter((allowed) => {
      if (now > allowed.startedAt + allowed.time) {
        return false;
      } else {
        return true;
      }
    });
  };

  isTmpAllowed = (url) => {
    if (this.tmpAllowed.length) {
      this.removeOutdatedTmpAllowed();
      const hostname = getHostname(url);
      const index = this.tmpAllowed.map((allowed) => allowed.hostname).indexOf(hostname);
      if (index !== -1) {
        this.debug('tmp allowed:', url);
        return true;
      }
    }
    this.debug('not tmp allowed:', url);
    return false;
  };

  isBlacklisted = (url) => {
    if (this.isTmpAllowed(url)) {
      return false;
    }
    for (const rule of this.blacklist) {
      if (rule.test(url)) {
        this.debug('is blacklisted:', url);
        return true;
      }
    }
    for (const rule of this.blacklistKeywords) {
      if (rule.test(url)) {
        this.debug('found blacklisted keyword in:', url);
        return true;
      }
    }
    this.debug('not blacklisted:', url);
    return false;
  };

  isWhitelisted = (url) => {
    if (!isAccessible(url) || this.isTmpAllowed(url)) {
      return true;
    }
    for (const rule of this.whitelist) {
      if (rule.test(url)) {
        this.debug('is whitelisted:', url);
        return true;
      }
    }
    for (const rule of this.whitelistKeywords) {
      if (rule.test(url)) {
        this.debug('found whitelisted keyword in:', url);
        return true;
      }
    }
    this.debug('not whitelisted:', url);
    return false;
  };

  isUrlBlocked = (url) => {
    switch (this.mode) {
      case Mode.blacklist:
        return this.isBlacklisted(url);
      case Mode.whitelist:
        return !this.isWhitelisted(url);
      case Mode.combined:
        return !this.isWhitelisted(url) && this.isBlacklisted(url);
      default:
        return false;
    }
  };

  parseTodaySchedule = () => {
    let isAllowedTime = false;
    let todaySchedule = null;
    if (this.schedule.isEnabled) {
      todaySchedule = getTodaySchedule(this.schedule);
      isAllowedTime = isScheduleAllowed(todaySchedule);
    }
    return {
      isAllowedTime,
      todaySchedule,
    };
  };

  isUrlStillBlocked = (url) => {
    if (!this.isEnabled) {
      return false;
    } else {
      const { isAllowedTime } = this.parseTodaySchedule();
      if (isAllowedTime) {
        return false;
      }
    }
    return this.isUrlBlocked(url);
  };

  getTimerRemainingTime = () => {
    return this.timer.runtime.endDate - now(true);
  };

  isTimerActive = () => {
    return this.timer.isEnabled && this.getTimerRemainingTime() > 0;
  };

  resumeTimer = (debugMessage = 'Timer resumed') => {
    const ms = this.getTimerRemainingTime();
    if (ms > 0) {
      this.enable(debugMessage);
      this.timerTimeout = setTimeout(() => {
        this.disable('Timer completed');
        if (this.timer.displayNotificationOnComplete) {
          const title = translate('appName');
          const message = translate('timerCompleted');
          sendNotification(message, title);
        }
      }, ms);
    }
  };

  startTimer = (duration) => {
    this.timer.runtime = {
      duration,
      endDate: now(true) + duration * 1000,
    };
    storage.set({ timer: this.timer });
    this.resumeTimer('Timer started');
  };

  stopTimer = () => {
    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.disable('Timer stopped');
      this.timer.runtime = unactiveTimerRuntimeSettings;
      storage.set({ timer: this.timer });
    }
  };

  parseUrl = (data, caller) => {
    this.debug('parsing url:', {
      caller: caller,
      data: data,
      mode: this.mode,
      blacklist: this.blacklist,
      whitelist: this.whitelist,
    });
    // Handle schedule
    if (!this.isTimerActive()) {
      const { isAllowedTime, todaySchedule } = this.parseTodaySchedule();
      if (isAllowedTime) {
        this.debug('not in scheduled blocking time:', todaySchedule);
        return;
      }
    }
    // Handle blocking
    const shouldBlock = this.isUrlBlocked(data.url);
    // Log url
    if (this.enableLogs) {
      logger.add({
        url: data.url,
        blocked: shouldBlock,
        date: now(true),
      });
    }
    // Execute action
    if (shouldBlock) {
      return this.handleAction(data);
    }
  };

  onBeforeRequestHandler = (requestDetails) => {
    return this.parseUrl(requestDetails, 'onBeforeRequestHandler'); // redirect will be handled by the event listener
  };

  onUpdatedHandler = (tabId, changeInfo, tab) => {
    if (
      changeInfo.status === 'loading' &&
      changeInfo.url &&
      hasValidProtocol(changeInfo.url)
    ) {
      this.checkTab({ ...changeInfo, tabId: tabId }, 'onUpdatedHandler');
    }
  };

  onReplacedHandler = (addedTabId, removedTabId) => {
    getTab(addedTabId).then((tab) => {
      if (tab) {
        this.checkTab({ url: tab.url, tabId: tab.id }, 'onReplacedHandler');
      }
    });
  };

  checkTab = (data, caller) => {
    const results = this.parseUrl(data, caller);
    if (results && results.redirectUrl) {
      this.redirectTab(data.tabId, results.redirectUrl);
    }
  };

  checkTabById = (tabId, caller) => {
    getTab(tabId).then((tab) => {
      if (tab) {
        this.checkTab({ url: tab.url, tabId }, caller);
      }
    });
  };

  enableEventListeners = () => {
    browser.webRequest.onBeforeRequest.addListener(
      this.onBeforeRequestHandler,
      {
        urls: ['*://*/*'],
        types: ['main_frame', 'sub_frame'],
      },
      ['blocking']
    );
    browser.tabs.onUpdated.addListener(this.onUpdatedHandler);
    browser.tabs.onReplaced.addListener(this.onReplacedHandler);
  };

  disableEventListeners = () => {
    browser.webRequest.onBeforeRequest.removeListener(this.onBeforeRequestHandler);
    browser.tabs.onUpdated.removeListener(this.onUpdatedHandler);
    browser.tabs.onReplaced.removeListener(this.onReplacedHandler);
  };

  checkAllTabs = () => {
    browser.tabs.query({}).then((tabs) => {
      if (tabs.length > 0) {
        for (const tab of tabs) {
          if (this.isEnabled) {
            this.checkTab({ url: tab.url, tabId: tab.id }, 'checkAllTabs');
          } else if (tab.url.startsWith(`${indexUrl}#/blocked?url=`)) {
            browser.tabs.reload(tab.id);
          }
        }
      }
    });
  };

  enable = (debugMessage = 'enabled!') => {
    if (this.isEnabled) {
      this.debug('already enabled!', {
        isEnabled: this.isEnabled,
      });
    } else {
      this.isEnabled = true;
      this.checkAllTabs();
      this.enableEventListeners();
      this.updateIcon();
      this.debug(debugMessage);
    }
  };

  disable = (debugMessage = 'disabled!') => {
    if (this.isEnabled) {
      this.isEnabled = false;
      this.disableEventListeners();
      this.checkAllTabs();
      this.updateIcon();
      this.debug(debugMessage);
    } else {
      this.debug('already disabled!', {
        isEnabled: this.isEnabled,
      });
    }
  };

  render() {
    return <span>Silence is golden!</span>;
  }
}
