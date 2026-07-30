import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Without this, a component mounted in one test stays in the DOM for the next
// one and queries start matching the wrong element.
afterEach(() => {
  cleanup();
});
