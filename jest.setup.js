// Import necessary testing libraries
import "@testing-library/jest-dom";

// Mock next/router
jest.mock("next/router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    pathname: "/",
    query: {},
    asPath: "/",
    route: "/",
  }),
}));

// Mock next-auth
jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({
    data: null,
    status: "unauthenticated",
  })),
  signIn: jest.fn(),
  signOut: jest.fn(),
  getSession: jest.fn(),
}));

// Mock Syncfusion components
jest.mock("@syncfusion/ej2-react-schedule", () => ({
  ScheduleComponent: jest.fn(({ children }) => (
    <div data-testid="schedule-component">{children}</div>
  )),
  Day: jest.fn(),
  Week: jest.fn(),
  WorkWeek: jest.fn(),
  Month: jest.fn(),
  Agenda: jest.fn(),
  Inject: jest.fn(),
  ViewsDirective: jest.fn(({ children }) => <div>{children}</div>),
  ViewDirective: jest.fn(),
}));

jest.mock("@syncfusion/ej2-base", () => ({
  registerLicense: jest.fn(),
}));

// LocalStorage mock
const localStorageMock = (function () {
  let store = {};
  return {
    getItem: jest.fn((key) => store[key] || null),
    setItem: jest.fn((key, value) => {
      store[key] = value.toString();
    }),
    removeItem: jest.fn((key) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    getAll: () => store,
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Suppress console errors during test execution
jest.spyOn(console, "error").mockImplementation(() => {});
jest.spyOn(console, "warn").mockImplementation(() => {});
