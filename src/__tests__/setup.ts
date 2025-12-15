import '@testing-library/jest-dom';

// Mock uuid for deterministic test results
let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// Reset uuid counter before each test
beforeEach(() => {
  uuidCounter = 0;
});
