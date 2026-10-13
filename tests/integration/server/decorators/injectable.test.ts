import { Injectable } from "@/server/decorators/injectable";
import { container, type InjectionToken } from "tsyringe";
import { describe, expect, it } from "vitest";

describe("Injectable", () => {
    it("records the registration token and the class without registering it", () => {
        const token: InjectionToken<unknown> = Symbol("test");

        @Injectable(token)
        class Example {}

        const classes: unknown = Reflect.getMetadata("classes", globalThis);

        expect(Reflect.getMetadata("registrationToken", Example)).toBe(token);
        expect(classes).toContain(Example);
        expect(container.isRegistered(token)).toBe(false);
    });
});
