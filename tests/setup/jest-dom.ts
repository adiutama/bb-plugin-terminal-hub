// DOM matchers (toHaveTextContent, toHaveAttribute, …) for every test file.
// jest-dom's own vitest entry declares the pre-5 Assertion signature, so the
// matchers are registered and typed here against Vitest 5's Matchers.

import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

expect.extend(matchers);

declare module "vitest" {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends TestingLibraryMatchers<unknown, R> {}
}
