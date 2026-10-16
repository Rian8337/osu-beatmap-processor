import { vi } from "vitest";

/**
 * Silences expected error logs and returns the spy, so a test can check that something was logged.
 */
export function silenceConsoleErrors() {
    return vi.spyOn(console, "error").mockImplementation(() => undefined);
}
