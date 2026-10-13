import { container } from "tsyringe";
import { describe, expect, it } from "vitest";
import { Injectable } from "@/server/decorators/injectable";
import { registerInjectables } from "@/server/dependencies/registerInjectables";

const token = Symbol("greeter");

@Injectable(token)
class Greeter {
    greet(): string {
        return "hi";
    }
}

describe("registerInjectables", () => {
    it("registers every @Injectable class as a singleton under its token", () => {
        const child = container.createChildContainer();

        registerInjectables(child);

        const greeter = child.resolve<Greeter>(token);

        expect(greeter).toBeInstanceOf(Greeter);
        expect(child.resolve<Greeter>(token)).toBe(greeter);
        expect(greeter.greet()).toBe("hi");
    });
});
