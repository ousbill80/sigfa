// jest.setup.afterFramework.js — MOB-001 (setupFilesAfterEnv)
// Runs after the test framework is installed — safe to use afterEach/beforeEach/etc.
//
// NOTE: No global fake-timer setup here.
// Each test file that uses components with Animated (TouchableOpacity) must manage
// timer flushing locally via jest.useFakeTimers() in beforeEach and
// act(() => { jest.runAllTimers(); }) in afterEach.
//
// This file is reserved for future global setup that requires the test framework.
