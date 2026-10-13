import { container, type DependencyContainer } from "tsyringe";

let currentContainer = container;

/**
 * Gets the current dependency injection container.
 */
export function getContainer(): DependencyContainer {
    return currentContainer;
}

/**
 * Sets the current dependency injection container.
 */
export function useContainer(newContainer: DependencyContainer): void {
    currentContainer = newContainer;
}
