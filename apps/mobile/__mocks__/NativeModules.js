// __mocks__/NativeModules.js
// Unified NativeModules mock for pnpm monorepo dual-react-version isolation.
// Used by moduleNameMapper to redirect BOTH react@18 and react@19 NativeModules.js
// to this single mock, ensuring the jest-expo preset mock actually applies.

const NativeModules = {
  AlertManager: {
    alertWithArgs: jest.fn(),
  },
  AsyncLocalStorage: {
    multiGet: jest.fn((keys, callback) => process.nextTick(() => callback(null, []))),
    multiSet: jest.fn((entries, callback) => process.nextTick(() => callback(null))),
    multiRemove: jest.fn((keys, callback) => process.nextTick(() => callback(null))),
    multiMerge: jest.fn((entries, callback) => process.nextTick(() => callback(null))),
    clear: jest.fn((callback) => process.nextTick(() => callback(null))),
    getAllKeys: jest.fn((callback) => process.nextTick(() => callback(null, []))),
  },
  DeviceInfo: {
    getConstants() {
      return {
        Dimensions: {
          window: { fontScale: 2, height: 1334, scale: 2, width: 750 },
          screen: { fontScale: 2, height: 1334, scale: 2, width: 750 },
        },
      };
    },
  },
  DevSettings: {
    addMenuItem: jest.fn(),
    reload: jest.fn(),
  },
  ImageLoader: {
    getSize: jest.fn((_url) => Promise.resolve([320, 240])),
    prefetchImage: jest.fn(),
  },
  PlatformConstants: {
    getConstants() {
      return {
        isTesting: true,
        reactNativeVersion: { major: 0, minor: 74, patch: 0, prerelease: undefined },
        osVersion: '16.0',
        systemName: 'iOS',
        interfaceIdiom: 'phone',
        localizedModel: 'iPhone',
        model: 'iPhone',
        forceTouchAvailable: false,
      };
    },
  },
  StatusBarManager: {
    getHeight: jest.fn(),
    setStyle: jest.fn(),
    setHidden: jest.fn(),
    setNetworkActivityIndicatorVisible: jest.fn(),
  },
  Networking: {
    sendRequest: jest.fn(),
    abortRequest: jest.fn(),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  },
  Keyboard: {
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  },
  UIManager: {
    RCTView: {},
    RCTText: {},
    RCTTextInput: {},
    RCTScrollView: {},
    RCTModalHostView: {},
    blur: jest.fn(),
    focus: jest.fn(),
    measure: jest.fn(),
    measureInWindow: jest.fn(),
    measureLayout: jest.fn(),
    createView: jest.fn(),
    updateView: jest.fn(),
    setChildren: jest.fn(),
    manageChildren: jest.fn(),
    findSubviewIn: jest.fn(),
    dispatchViewManagerCommand: jest.fn(),
    getViewManagerConfig: jest.fn(() => ({})),
    hasViewManagerConfig: jest.fn(() => false),
    sendAccessibilityEvent: jest.fn(),
    customBubblingEventTypes: {},
    customDirectEventTypes: {},
  },
};

module.exports = NativeModules;
